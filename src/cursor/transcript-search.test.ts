import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createTranscriptSearchService } from "./transcript-search";
import { SessionIndexRepository } from "../persistence/session-index";
import type { CursorSessionRecord } from "../types/session-record";

let testDir: string;
let repo: SessionIndexRepository;

function record(
  overrides: Partial<CursorSessionRecord> &
    Pick<CursorSessionRecord, "recordId">,
): CursorSessionRecord {
  return {
    identityState: "transcript_only",
    workspaceSlug: "workspace-alpha",
    workspacePath: resolve("/tmp/workspace-alpha"),
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    source: "headless",
    status: "completed",
    ...overrides,
  };
}

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

async function writeTranscript(
  name: string,
  lines: readonly string[],
): Promise<string> {
  const transcriptPath = join(testDir, `${name}.jsonl`);
  await writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");
  return transcriptPath;
}

describe("transcript full-text search", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-transcript-search-"));
    repo = new SessionIndexRepository(join(testDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    await rm(testDir, { recursive: true, force: true });
  });

  test("matches transcript text case-insensitively with role filters", async () => {
    const transcriptPath = await writeTranscript("alpha", [
      transcriptLine("user", "<user_query>\nFind alpha NEEDLE\n</user_query>"),
      transcriptLine("assistant", "assistant needle response"),
    ]);
    repo.upsert(
      record({
        recordId: "rec-alpha",
        localSessionId: "local-alpha",
        cursorChatId: "chat-alpha",
        transcriptPath,
      }),
    );

    const service = createTranscriptSearchService(repo);
    const all = await service.search({ query: "needle", limit: 20, offset: 0 });
    const assistant = await service.search({
      query: "needle",
      role: "assistant",
      limit: 20,
      offset: 0,
    });

    expect(all.total).toBe(2);
    expect(all.hits[0]?.recordId).toBe("rec-alpha");
    expect(all.hits[0]?.localSessionId).toBe("local-alpha");
    expect(all.hits[0]?.cursorChatId).toBe("chat-alpha");
    expect(all.hits[0]?.messageId).toBe("event-0-user");
    expect(all.hits[0]?.provenance).toBe("transcript");
    expect(assistant.total).toBe(1);
    expect(assistant.hits[0]?.role).toBe("assistant");
  });

  test("orders candidates deterministically and paginates after matching", async () => {
    const older = await writeTranscript("older", [
      transcriptLine("assistant", "needle in older"),
    ]);
    const sameTimeB = await writeTranscript("same-b", [
      transcriptLine("assistant", "needle in b"),
    ]);
    const sameTimeA = await writeTranscript("same-a", [
      transcriptLine("assistant", "needle in a"),
    ]);
    repo.upsert(
      record({
        recordId: "rec-older",
        transcriptPath: older,
        updatedAt: "2026-05-05T10:00:00.000Z",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-b",
        transcriptPath: sameTimeB,
        updatedAt: "2026-05-05T12:00:00.000Z",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-a",
        transcriptPath: sameTimeA,
        updatedAt: "2026-05-05T12:00:00.000Z",
      }),
    );

    const result = await createTranscriptSearchService(repo).search({
      query: "needle",
      limit: 2,
      offset: 1,
    });

    expect(result.total).toBe(3);
    expect(result.hits.map((hit) => hit.recordId)).toEqual([
      "rec-b",
      "rec-older",
    ]);
  });

  test("resolves session filters by record, local session, and cursor chat ids", async () => {
    const transcriptPath = await writeTranscript("session-filter", [
      transcriptLine("assistant", "filtered needle"),
    ]);
    repo.upsert(
      record({
        recordId: "rec-filter",
        localSessionId: "local-filter",
        cursorChatId: "chat-filter",
        transcriptPath,
      }),
    );
    const service = createTranscriptSearchService(repo);

    for (const sessionId of ["rec-filter", "local-filter", "chat-filter"]) {
      const result = await service.search({
        query: "needle",
        sessionId,
        limit: 20,
        offset: 0,
      });
      expect(result.hits[0]?.recordId).toBe("rec-filter");
    }
  });

  test("enforces scan budgets and excludes pending chat-only records", async () => {
    const transcriptPath = await writeTranscript("budget", [
      transcriptLine("assistant", "first needle"),
      transcriptLine("assistant", "second needle"),
    ]);
    const secondTranscriptPath = await writeTranscript("budget-second", [
      transcriptLine("assistant", "third needle"),
    ]);
    repo.upsert(record({ recordId: "rec-budget", transcriptPath }));
    repo.upsert(
      record({
        recordId: "rec-budget-second",
        transcriptPath: secondTranscriptPath,
        updatedAt: "2026-05-04T00:00:00.000Z",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-pending",
        cursorChatId: "chat-pending",
        identityState: "chat_only",
        status: "pending",
      }),
    );
    const service = createTranscriptSearchService(repo);

    const maxEvents = await service.search({
      query: "needle",
      limit: 20,
      offset: 0,
      maxEvents: 1,
    });
    const maxBytes = await service.search({
      query: "needle",
      limit: 20,
      offset: 0,
      maxBytes: 5,
    });
    const maxSessions = await service.search({
      query: "needle",
      limit: 20,
      offset: 0,
      maxSessions: 1,
    });
    const pending = await service.search({
      query: "needle",
      sessionId: "chat-pending",
      limit: 20,
      offset: 0,
    });

    expect(maxEvents.total).toBe(1);
    expect(maxEvents.scannedEvents).toBe(1);
    expect(maxEvents.truncated).toBe(true);
    expect(maxBytes.total).toBe(0);
    expect(maxBytes.truncated).toBe(true);
    expect(maxSessions.scannedSessions).toBe(1);
    expect(maxSessions.truncated).toBe(true);
    expect(pending.total).toBe(0);
    expect(pending.scannedSessions).toBe(0);
  });

  test("counts malformed transcript rows toward event budgets without aborting", async () => {
    const transcriptPath = await writeTranscript("malformed-budget", [
      "{not json",
      transcriptLine("assistant", "needle after malformed row"),
    ]);
    repo.upsert(record({ recordId: "rec-malformed", transcriptPath }));

    const budgeted = await createTranscriptSearchService(repo).search({
      query: "needle",
      limit: 20,
      offset: 0,
      maxEvents: 1,
    });
    const unbudgeted = await createTranscriptSearchService(repo).search({
      query: "needle",
      limit: 20,
      offset: 0,
    });

    expect(budgeted.total).toBe(0);
    expect(budgeted.scannedEvents).toBe(1);
    expect(budgeted.truncated).toBe(true);
    expect(unbudgeted.total).toBe(1);
    expect(unbudgeted.scannedEvents).toBe(2);
  });

  test("counts malformed and unknown-role rows toward scan counters", async () => {
    const unknownRole = JSON.stringify({
      role: "unknown",
      message: { content: [{ type: "text", text: "ignored" }] },
    });
    const transcriptPath = await writeTranscript("scan-counters", [
      "{not json",
      unknownRole,
    ]);
    repo.upsert(record({ recordId: "rec-scan-counters", transcriptPath }));

    const result = await createTranscriptSearchService(repo).search({
      query: "needle",
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(0);
    expect(result.scannedEvents).toBe(2);
    expect(result.scannedBytes).toBeGreaterThan(0);
  });

  test("returns empty results for no-match searches", async () => {
    const transcriptPath = await writeTranscript("no-match", [
      transcriptLine("assistant", "nothing relevant"),
    ]);
    repo.upsert(record({ recordId: "rec-no-match", transcriptPath }));

    const result = await createTranscriptSearchService(repo).search({
      query: "needle",
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
    expect(result.scannedEvents).toBe(1);
  });

  test("surfaces timeout state when the deadline is exceeded", async () => {
    const transcriptPath = await writeTranscript("timeout", [
      transcriptLine("assistant", "needle"),
    ]);
    repo.upsert(record({ recordId: "rec-timeout", transcriptPath }));
    const now = spyOn(Date, "now");
    now.mockImplementationOnce(() => 1_000);
    now.mockImplementation(() => 1_001);
    try {
      const result = await createTranscriptSearchService(repo).search({
        query: "needle",
        limit: 20,
        offset: 0,
        timeoutMs: 1,
      });

      expect(result.timedOut).toBe(true);
      expect(result.scannedSessions).toBe(0);
    } finally {
      now.mockRestore();
    }
  });

  test("rejects blank queries and malformed pagination", async () => {
    const service = createTranscriptSearchService(repo);

    await expect(
      service.search({ query: "   ", limit: 20, offset: 0 }),
    ).rejects.toThrow("query must not be empty");
    await expect(
      service.search({ query: "needle", limit: 0, offset: 0 }),
    ).rejects.toThrow("limit must be a positive integer");
    await expect(
      service.search({ query: "needle", limit: 20, offset: -1 }),
    ).rejects.toThrow("offset must be a non-negative integer");
  });
});
