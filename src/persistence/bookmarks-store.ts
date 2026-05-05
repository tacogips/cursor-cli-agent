import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { bookmarksJsonPath } from "../config/paths";
import type {
  BookmarkFilter,
  BookmarkRecord,
  BookmarkSearchHit,
  BookmarkSearchOptions,
  BookmarkSearchResult,
  BookmarkType,
} from "../types/bookmark";
import { isBookmarkType } from "../types/bookmark";

interface FileShape {
  readonly bookmarks: readonly BookmarkRecord[];
}

export interface BookmarksStore {
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  get(id: string): Promise<BookmarkRecord | null>;
  save(record: BookmarkRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  search(
    query: string,
    options?: BookmarkSearchOptions,
  ): Promise<BookmarkSearchResult>;
}

export { bookmarksJsonPath };

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isBookmarkRecord(value: unknown): value is BookmarkRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const type = record["type"];
  const tags = record["tags"];
  return (
    typeof record["id"] === "string" &&
    typeof type === "string" &&
    isBookmarkType(type) &&
    typeof record["sessionId"] === "string" &&
    typeof record["name"] === "string" &&
    Array.isArray(tags) &&
    tags.every((tag) => typeof tag === "string") &&
    typeof record["createdAt"] === "string" &&
    typeof record["updatedAt"] === "string"
  );
}

async function load(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { bookmarks: [] };
    }
    const bookmarks = (parsed as Record<string, unknown>)["bookmarks"];
    if (!Array.isArray(bookmarks)) {
      return { bookmarks: [] };
    }
    return { bookmarks: bookmarks.filter(isBookmarkRecord) };
  } catch {
    return { bookmarks: [] };
  }
}

async function saveFile(path: string, data: FileShape): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

function matchesFilter(
  bookmark: BookmarkRecord,
  filter: BookmarkFilter | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (
    filter.sessionId !== undefined &&
    bookmark.sessionId !== filter.sessionId
  ) {
    return false;
  }
  if (filter.type !== undefined && bookmark.type !== filter.type) {
    return false;
  }
  if (filter.tag !== undefined && !bookmark.tags.includes(filter.tag)) {
    return false;
  }
  return true;
}

function compareBookmarks(a: BookmarkRecord, b: BookmarkRecord): number {
  const updated = b.updatedAt.localeCompare(a.updatedAt);
  if (updated !== 0) {
    return updated;
  }
  return a.id.localeCompare(b.id);
}

function scoreBookmark(
  bookmark: BookmarkRecord,
  normalizedQuery: string,
): number {
  let score = 0;
  const fields: ReadonlyArray<readonly [string | undefined, number]> = [
    [bookmark.name, 5],
    [bookmark.description, 3],
    [bookmark.sessionId, 2],
    [bookmark.messageId, 2],
    [bookmark.fromMessageId, 2],
    [bookmark.toMessageId, 2],
    [bookmark.excerpt?.displayText, 2],
    [bookmark.excerpt?.rawText, 1],
  ];
  for (const [value, weight] of fields) {
    if (value?.toLowerCase().includes(normalizedQuery) === true) {
      score += weight;
    }
  }
  for (const tag of bookmark.tags) {
    if (tag.toLowerCase().includes(normalizedQuery)) {
      score += 1;
    }
  }
  return score;
}

function sortedHits(
  hits: readonly BookmarkSearchHit[],
): readonly BookmarkSearchHit[] {
  return [...hits].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return compareBookmarks(a.bookmark, b.bookmark);
  });
}

function trimBookmark(record: BookmarkRecord): BookmarkRecord {
  const messageId = optionalString(record.messageId);
  const fromMessageId = optionalString(record.fromMessageId);
  const toMessageId = optionalString(record.toMessageId);
  const description = optionalString(record.description);
  return {
    id: record.id,
    type: record.type as BookmarkType,
    sessionId: record.sessionId,
    ...(messageId !== undefined ? { messageId } : {}),
    ...(fromMessageId !== undefined ? { fromMessageId } : {}),
    ...(toMessageId !== undefined ? { toMessageId } : {}),
    name: record.name,
    ...(description !== undefined ? { description } : {}),
    tags: [...record.tags],
    ...(record.excerpt !== undefined ? { excerpt: record.excerpt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createBookmarksStore(
  path = bookmarksJsonPath(),
): BookmarksStore {
  return {
    async list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]> {
      const data = await load(path);
      return data.bookmarks
        .filter((bookmark) => matchesFilter(bookmark, filter))
        .sort(compareBookmarks);
    },

    async get(id: string): Promise<BookmarkRecord | null> {
      const data = await load(path);
      return data.bookmarks.find((bookmark) => bookmark.id === id) ?? null;
    },

    async save(record: BookmarkRecord): Promise<void> {
      const data = await load(path);
      const next = data.bookmarks.filter(
        (bookmark) => bookmark.id !== record.id,
      );
      await saveFile(path, { bookmarks: [...next, trimBookmark(record)] });
    },

    async delete(id: string): Promise<boolean> {
      const data = await load(path);
      const next = data.bookmarks.filter((bookmark) => bookmark.id !== id);
      if (next.length === data.bookmarks.length) {
        return false;
      }
      await saveFile(path, { bookmarks: next });
      return true;
    },

    async search(
      query: string,
      options?: BookmarkSearchOptions,
    ): Promise<BookmarkSearchResult> {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery.length === 0) {
        return { query, hits: [], total: 0 };
      }
      const data = await load(path);
      const hits = sortedHits(
        data.bookmarks.flatMap((bookmark) => {
          const score = scoreBookmark(bookmark, normalizedQuery);
          return score > 0 ? [{ bookmark, score }] : [];
        }),
      );
      const limited =
        options?.limit === undefined ? hits : hits.slice(0, options.limit);
      return {
        query,
        hits: limited,
        total: hits.length,
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      };
    },
  };
}
