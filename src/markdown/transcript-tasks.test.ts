import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SessionIndexRepository } from "../persistence/session-index";
import {
  createTranscriptMarkdownTaskExtractor,
  MarkdownTaskNotFoundError,
} from "./transcript-tasks";

let testDir: string;
let repo: SessionIndexRepository;

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

describe("createTranscriptMarkdownTaskExtractor", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-cli-markdown-"));
    await mkdir(join(testDir, "data"), { recursive: true });
    repo = new SessionIndexRepository(join(testDir, "data", "state.db"));
  });

  afterEach(async () => {
    repo.close();
    await rm(testDir, { recursive: true, force: true });
  });

  test("extracts assistant markdown tasks and supports filters", async () => {
    const transcriptPath = join(testDir, "markdown.jsonl");
    await writeFile(
      transcriptPath,
      [
        transcriptLine("user", "Ignore me"),
        transcriptLine(
          "assistant",
          ["# Plan", "- [ ] first", "- [x] second"].join("\n"),
        ),
        transcriptLine("assistant", "## Later\n* [ ] third"),
      ].join("\n"),
      "utf8",
    );

    repo.upsert({
      recordId: "rec-markdown",
      localSessionId: "local-markdown",
      cursorChatId: "chat-markdown",
      identityState: "linked",
      workspaceSlug: "tmp-markdown",
      workspacePath: resolve("/tmp/markdown-workspace"),
      transcriptPath,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T01:00:00.000Z",
      source: "headless",
      status: "completed",
    });

    const extractor = createTranscriptMarkdownTaskExtractor(repo);
    const all = await extractor.extract({ sessionId: "chat-markdown" });
    expect(all.sessionId).toBe("local-markdown");
    expect(all.sections).toHaveLength(2);
    expect(all.tasks.map((task) => task.messageId)).toEqual([
      "event-1-assistant",
      "event-1-assistant",
      "event-2-assistant",
    ]);
    expect(all.totalTasks).toBe(3);

    const filtered = await extractor.extract({
      sessionId: "chat-markdown",
      messageId: "event-1-assistant",
      checked: true,
    });
    expect(filtered.messageId).toBe("event-1-assistant");
    expect(filtered.tasks).toHaveLength(1);
    expect(filtered.tasks[0]).toEqual(
      expect.objectContaining({
        text: "second",
        checked: true,
        lineNumber: 3,
      }),
    );
  });

  test("returns an empty result for chat-only records", async () => {
    repo.upsert({
      recordId: "rec-pending",
      cursorChatId: "chat-pending",
      identityState: "chat_only",
      workspaceSlug: "tmp-pending",
      workspacePath: resolve("/tmp/pending-workspace"),
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T01:00:00.000Z",
      source: "create-chat",
      status: "pending",
    });

    const extractor = createTranscriptMarkdownTaskExtractor(repo);
    const result = await extractor.extract({ sessionId: "chat-pending" });
    expect(result.tasks).toEqual([]);
    expect(result.sections).toEqual([]);
    expect(result.totalTasks).toBe(0);
  });

  test("throws for unknown sessions", async () => {
    const extractor = createTranscriptMarkdownTaskExtractor(repo);
    await expect(
      extractor.extract({ sessionId: "missing-session" }),
    ).rejects.toBeInstanceOf(MarkdownTaskNotFoundError);
  });
});
