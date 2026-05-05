import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SessionIndexRepository } from "./session-index";
import type { CursorSessionRecord } from "../types/session-record";

let testDir: string;
let repo: SessionIndexRepository;
const previousCursorHome = process.env["CURORT_CLI_AGENT_CURSOR_HOME"];

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

describe("SessionIndexRepository session metadata search", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-session-search-"));
    repo = new SessionIndexRepository(join(testDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    if (previousCursorHome === undefined) {
      delete process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
    } else {
      process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test("rejects empty queries before searching", () => {
    expect(() =>
      repo.searchSessions({ query: "   ", limit: 20, offset: 0 }),
    ).toThrow("query must not be empty");
  });

  test("rejects non-integer pagination at the repository boundary", () => {
    expect(() =>
      repo.searchSessions({ query: "needle", limit: 1.5, offset: 0 }),
    ).toThrow("limit must be a positive integer");
    expect(() =>
      repo.searchSessions({ query: "needle", limit: 20, offset: 0.5 }),
    ).toThrow("offset must be a non-negative integer");
  });

  test("matches indexed metadata case-insensitively and reports match fields", () => {
    repo.upsert(
      record({
        recordId: "rec-alpha",
        localSessionId: "local-alpha",
        firstUserText: "Investigate Session Search behavior",
        model: "claude-sonnet",
        mode: "plan",
      }),
    );

    const result = repo.searchSessions({
      query: "session search",
      limit: 20,
      offset: 0,
    });

    expect(result.provenance).toBe("index");
    expect(result.total).toBe(1);
    expect(result.sessions[0]?.recordId).toBe("rec-alpha");
    expect(result.sessions[0]?.matchFields).toContain("firstUserText");
    expect(result.sessions[0]?.provenance).toBe("index");
  });

  test("applies workspace, model, mode, and status filters exactly", () => {
    const workspace = resolve("/tmp/workspace-filter");
    repo.upsert(
      record({
        recordId: "rec-match",
        localSessionId: "local-match",
        workspaceSlug: "tmp-workspace-filter",
        workspacePath: workspace,
        model: "gpt-5.4",
        mode: "ask",
        status: "pending",
        source: "create-chat",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-model-miss",
        localSessionId: "local-model-miss",
        workspaceSlug: "tmp-workspace-filter",
        workspacePath: workspace,
        model: "gpt-5.3",
        mode: "ask",
        status: "pending",
        source: "create-chat",
      }),
    );

    const result = repo.searchSessions({
      query: "create-chat",
      filters: {
        workspace,
        model: "gpt-5.4",
        mode: "ask",
        status: "pending",
      },
      limit: 20,
      offset: 0,
    });

    expect(result.filters.workspace).toBe(workspace);
    expect(result.sessions.map((session) => session.recordId)).toEqual([
      "rec-match",
    ]);
    expect(result.sessions[0]?.matchFields).toContain("source");
  });

  test("orders deterministically and paginates after matching", () => {
    repo.upsert(
      record({
        recordId: "rec-b",
        localSessionId: "local-b",
        updatedAt: "2026-05-05T12:00:00.000Z",
        firstUserText: "needle",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-a",
        localSessionId: "local-a",
        updatedAt: "2026-05-05T12:00:00.000Z",
        firstUserText: "needle",
      }),
    );
    repo.upsert(
      record({
        recordId: "rec-newest",
        localSessionId: "local-newest",
        updatedAt: "2026-05-05T13:00:00.000Z",
        firstUserText: "needle",
      }),
    );

    const result = repo.searchSessions({
      query: "needle",
      limit: 2,
      offset: 1,
    });

    expect(result.total).toBe(3);
    expect(result.sessions.map((session) => session.recordId)).toEqual([
      "rec-a",
      "rec-b",
    ]);
  });

  test("keeps pending chat-only records searchable before materialization", () => {
    repo.upsert(
      record({
        recordId: "rec-pending",
        cursorChatId: "chat-pending-search",
        identityState: "chat_only",
        workspaceSlug: "tmp-pending-workspace",
        workspacePath: resolve("/tmp/pending-workspace"),
        source: "create-chat",
        status: "pending",
      }),
    );

    const byChatId = repo.searchSessions({
      query: "chat-pending",
      limit: 20,
      offset: 0,
    });
    const byStatus = repo.searchSessions({
      query: "pending",
      filters: { status: "pending" },
      limit: 20,
      offset: 0,
    });

    expect(byChatId.sessions[0]?.identityState).toBe("chat_only");
    expect(byChatId.sessions[0]?.matchFields).toContain("cursorChatId");
    expect(byStatus.sessions[0]?.recordId).toBe("rec-pending");
  });

  test("imports nested Cursor transcript files from observed local layout", async () => {
    const cursorHome = join(testDir, "cursor");
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = cursorHome;
    const transcriptDir = join(
      cursorHome,
      "projects",
      "workspace-nested",
      "agent-transcripts",
      "session-nested",
    );
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      join(transcriptDir, "session-nested.jsonl"),
      `${JSON.stringify({
        role: "user",
        message: {
          content: [
            { type: "text", text: "<user_query>\nNested\n</user_query>" },
          ],
        },
      })}\n`,
      "utf8",
    );

    const imported = await repo.importTranscriptsFromFilesystem();
    const record = repo.findByLocalSessionId("session-nested");

    expect(imported).toBe(1);
    expect(record?.workspaceSlug).toBe("workspace-nested");
    expect(record?.transcriptPath).toContain(
      join("agent-transcripts", "session-nested", "session-nested.jsonl"),
    );
    expect(record?.firstUserText).toBe("Nested");
  });
});
