import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createBookmarksStore } from "./bookmarks-store";
import type { BookmarkRecord } from "../types/bookmark";

function bookmark(overrides: Partial<BookmarkRecord>): BookmarkRecord {
  return {
    id: "bookmark-1",
    type: "session",
    sessionId: "session-1",
    name: "Alpha bookmark",
    tags: ["alpha"],
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("bookmarks store", () => {
  test("treats missing files as empty and supports CRUD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-bookmarks-store-"));
    const path = join(dir, "bookmarks.json");
    try {
      const store = createBookmarksStore(path);
      expect(await store.list()).toEqual([]);

      await store.save(bookmark({ id: "session-bookmark" }));
      await store.save(
        bookmark({
          id: "message-bookmark",
          type: "message",
          messageId: "event-0-user",
          name: "Needle message",
          tags: ["needle"],
          excerpt: { rawText: "raw needle", displayText: "display needle" },
          updatedAt: "2026-05-05T01:00:00.000Z",
        }),
      );

      expect((await store.list()).map((record) => record.id)).toEqual([
        "message-bookmark",
        "session-bookmark",
      ]);
      expect(await store.get("session-bookmark")).toMatchObject({
        id: "session-bookmark",
      });
      expect(await store.delete("session-bookmark")).toBe(true);
      expect(await store.delete("missing")).toBe(false);
      expect(await store.get("session-bookmark")).toBeNull();

      const raw = await readFile(path, "utf8");
      expect(JSON.parse(raw)).toMatchObject({
        bookmarks: [{ id: "message-bookmark" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("searches metadata and excerpts with deterministic scores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-bookmarks-store-"));
    const path = join(dir, "bookmarks.json");
    try {
      const store = createBookmarksStore(path);
      await store.save(
        bookmark({
          id: "older",
          name: "Shared",
          description: "needle description",
        }),
      );
      await store.save(
        bookmark({
          id: "newer",
          name: "Shared needle",
          updatedAt: "2026-05-05T01:00:00.000Z",
        }),
      );

      const result = await store.search("needle", { limit: 1 });

      expect(result.total).toBe(2);
      expect(result.limit).toBe(1);
      expect(result.hits.map((hit) => hit.bookmark.id)).toEqual(["newer"]);
      expect(result.hits[0]?.score).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
