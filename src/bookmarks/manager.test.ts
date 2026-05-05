import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  BookmarkInputError,
  BookmarkNotFoundError,
  createBookmarkManager,
} from "./manager";
import { createTranscriptBookmarkLookup } from "../cursor/transcript-bookmark-lookup";
import { createBookmarksStore } from "../persistence/bookmarks-store";
import { SessionIndexRepository } from "../persistence/session-index";
import type { CursorSessionRecord } from "../types/session-record";

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

describe("bookmark manager", () => {
  test("creates session, message, and range bookmarks with excerpts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-bookmark-manager-"));
    const repo = new SessionIndexRepository(join(dir, "state.db"));
    try {
      const transcriptPath = join(dir, "session.jsonl");
      await writeFile(
        transcriptPath,
        [
          transcriptLine("user", "<user_query>\nBookmark alpha\n</user_query>"),
          transcriptLine("assistant", "Assistant beta"),
        ].join("\n"),
        "utf8",
      );
      repo.upsert(
        record({
          recordId: "rec-linked",
          localSessionId: "local-linked",
          cursorChatId: "chat-linked",
          identityState: "linked",
          transcriptPath,
        }),
      );
      const manager = createBookmarkManager({
        sessions: repo,
        store: createBookmarksStore(join(dir, "bookmarks.json")),
        transcriptLookup: createTranscriptBookmarkLookup(),
        now: () => new Date("2026-05-05T03:00:00.000Z"),
        createId: (() => {
          let id = 0;
          return () => `bookmark-${(id += 1)}`;
        })(),
      });

      const session = await manager.add({
        type: "session",
        sessionId: "chat-linked",
        name: "Session bookmark",
        tags: ["b", "a", "a"],
      });
      const message = await manager.add({
        type: "message",
        sessionId: "local-linked",
        messageId: "event-0-user",
        name: "Message bookmark",
      });
      const range = await manager.add({
        type: "range",
        sessionId: "rec-linked",
        fromMessageId: "event-0-user",
        toMessageId: "event-1-assistant",
        name: "Range bookmark",
      });

      expect(session.tags).toEqual(["a", "b"]);
      expect(message.excerpt?.displayText).toBe("Bookmark alpha");
      expect(message.excerpt?.rawText).toContain("user_query");
      expect(range.excerpt?.displayText).toContain("Assistant beta");
      expect((await manager.search("Assistant")).total).toBe(1);
    } finally {
      repo.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects transcript targets for pending chat-only sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-bookmark-manager-"));
    const repo = new SessionIndexRepository(join(dir, "state.db"));
    try {
      repo.upsert(
        record({
          recordId: "rec-pending",
          cursorChatId: "chat-pending",
          identityState: "chat_only",
          status: "pending",
        }),
      );
      const manager = createBookmarkManager({
        sessions: repo,
        store: createBookmarksStore(join(dir, "bookmarks.json")),
      });

      await expect(
        manager.add({
          type: "session",
          sessionId: "chat-pending",
          name: "Pending session",
        }),
      ).resolves.toMatchObject({ sessionId: "chat-pending" });
      await expect(
        manager.add({
          type: "message",
          sessionId: "chat-pending",
          messageId: "event-0-user",
          name: "Pending message",
        }),
      ).rejects.toBeInstanceOf(BookmarkInputError);
      await expect(
        manager.add({
          type: "message",
          sessionId: "missing",
          messageId: "event-0-user",
          name: "Missing session",
        }),
      ).rejects.toBeInstanceOf(BookmarkNotFoundError);
    } finally {
      repo.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
