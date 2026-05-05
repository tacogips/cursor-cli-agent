export const BOOKMARK_TYPES = ["session", "message", "range"] as const;

export type BookmarkType = (typeof BOOKMARK_TYPES)[number];

export interface BookmarkExcerpt {
  readonly rawText: string;
  readonly displayText: string;
}

export interface BookmarkRecord {
  readonly id: string;
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly fromMessageId?: string;
  readonly toMessageId?: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly excerpt?: BookmarkExcerpt;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBookmarkInput {
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly fromMessageId?: string;
  readonly toMessageId?: string;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface BookmarkFilter {
  readonly sessionId?: string;
  readonly type?: BookmarkType;
  readonly tag?: string;
}

export interface BookmarkSearchOptions {
  readonly limit?: number;
}

export interface BookmarkSearchHit {
  readonly bookmark: BookmarkRecord;
  readonly score: number;
}

export interface BookmarkSearchResult {
  readonly query: string;
  readonly hits: readonly BookmarkSearchHit[];
  readonly total: number;
  readonly limit?: number;
}

export function isBookmarkType(value: string): value is BookmarkType {
  return value === "session" || value === "message" || value === "range";
}

export function normalizeBookmarkTags(
  tags: readonly string[] | undefined,
): readonly string[] {
  if (tags === undefined) {
    return [];
  }
  const normalized = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (tag.length > 0) {
      normalized.add(tag);
    }
  }
  return [...normalized].sort((a, b) => a.localeCompare(b));
}

export function validateCreateBookmarkInput(
  input: CreateBookmarkInput,
): readonly string[] {
  const errors: string[] = [];
  if (input.sessionId.trim().length === 0) {
    errors.push("sessionId is required");
  }
  if (input.name.trim().length === 0) {
    errors.push("name is required");
  }

  switch (input.type) {
    case "session":
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for session bookmarks");
      }
      if (
        input.fromMessageId !== undefined ||
        input.toMessageId !== undefined
      ) {
        errors.push("range fields are not allowed for session bookmarks");
      }
      break;
    case "message":
      if (
        input.messageId === undefined ||
        input.messageId.trim().length === 0
      ) {
        errors.push("messageId is required for message bookmarks");
      }
      if (
        input.fromMessageId !== undefined ||
        input.toMessageId !== undefined
      ) {
        errors.push("range fields are not allowed for message bookmarks");
      }
      break;
    case "range":
      if (
        input.fromMessageId === undefined ||
        input.fromMessageId.trim().length === 0
      ) {
        errors.push("fromMessageId is required for range bookmarks");
      }
      if (
        input.toMessageId === undefined ||
        input.toMessageId.trim().length === 0
      ) {
        errors.push("toMessageId is required for range bookmarks");
      }
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for range bookmarks");
      }
      break;
  }
  return errors;
}
