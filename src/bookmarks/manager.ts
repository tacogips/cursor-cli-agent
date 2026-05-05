import { randomUUID } from "node:crypto";

import type { TranscriptBookmarkLookup } from "../cursor/transcript-bookmark-lookup";
import { createTranscriptBookmarkLookup } from "../cursor/transcript-bookmark-lookup";
import type { BookmarksStore } from "../persistence/bookmarks-store";
import { createBookmarksStore } from "../persistence/bookmarks-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import type {
  BookmarkFilter,
  BookmarkRecord,
  BookmarkSearchOptions,
  BookmarkSearchResult,
  CreateBookmarkInput,
} from "../types/bookmark";
import {
  normalizeBookmarkTags,
  validateCreateBookmarkInput,
} from "../types/bookmark";

export class BookmarkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookmarkInputError";
  }
}

export class BookmarkNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookmarkNotFoundError";
  }
}

export interface BookmarkManager {
  add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  show(id: string): Promise<BookmarkRecord | null>;
  delete(id: string): Promise<boolean>;
  search(
    query: string,
    options?: BookmarkSearchOptions,
  ): Promise<BookmarkSearchResult>;
}

export interface BookmarkManagerDependencies {
  readonly sessions: SessionIndexRepository;
  readonly store?: BookmarksStore;
  readonly transcriptLookup?: TranscriptBookmarkLookup;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function combinedRangeExcerpt(
  messages: Awaited<ReturnType<TranscriptBookmarkLookup["findRange"]>>,
): { readonly rawText: string; readonly displayText: string } {
  return {
    rawText: messages.map((message) => message.rawText).join("\n"),
    displayText: messages.map((message) => message.displayText).join("\n"),
  };
}

function bookmarkSessionIdFor(session: {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
}): string {
  return session.localSessionId ?? session.cursorChatId ?? session.recordId;
}

export function createBookmarkManager(
  dependencies: BookmarkManagerDependencies,
): BookmarkManager {
  const store = dependencies.store ?? createBookmarksStore();
  const transcriptLookup =
    dependencies.transcriptLookup ?? createTranscriptBookmarkLookup();
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;

  return {
    async add(input: CreateBookmarkInput): Promise<BookmarkRecord> {
      const validationErrors = validateCreateBookmarkInput(input);
      if (validationErrors.length > 0) {
        throw new BookmarkInputError(validationErrors.join("; "));
      }

      const session = dependencies.sessions.resolveSessionKey(input.sessionId);
      if (session === undefined) {
        throw new BookmarkNotFoundError("session not found");
      }

      let excerpt:
        | { readonly rawText: string; readonly displayText: string }
        | undefined;
      if (input.type !== "session") {
        if (
          session.identityState === "chat_only" ||
          session.transcriptPath === undefined
        ) {
          throw new BookmarkInputError(
            "message and range bookmarks require a transcript-backed session",
          );
        }
        if (input.type === "message") {
          const messageId = input.messageId;
          if (messageId === undefined) {
            throw new BookmarkInputError(
              "messageId is required for message bookmarks",
            );
          }
          const message = await transcriptLookup.findMessage(
            session.transcriptPath,
            messageId,
          );
          if (message === null) {
            throw new BookmarkNotFoundError("message not found");
          }
          excerpt = {
            rawText: message.rawText,
            displayText: message.displayText,
          };
        } else {
          const fromMessageId = input.fromMessageId;
          const toMessageId = input.toMessageId;
          if (fromMessageId === undefined || toMessageId === undefined) {
            throw new BookmarkInputError(
              "fromMessageId and toMessageId are required for range bookmarks",
            );
          }
          const messages = await transcriptLookup.findRange(
            session.transcriptPath,
            fromMessageId,
            toMessageId,
          );
          if (messages.length === 0) {
            throw new BookmarkNotFoundError("range not found");
          }
          excerpt = combinedRangeExcerpt(messages);
        }
      }

      const timestamp = now().toISOString();
      const messageId = optionalTrimmed(input.messageId);
      const fromMessageId = optionalTrimmed(input.fromMessageId);
      const toMessageId = optionalTrimmed(input.toMessageId);
      const description = optionalTrimmed(input.description);
      const record: BookmarkRecord = {
        id: createId(),
        type: input.type,
        sessionId: bookmarkSessionIdFor(session),
        ...(messageId !== undefined ? { messageId } : {}),
        ...(fromMessageId !== undefined ? { fromMessageId } : {}),
        ...(toMessageId !== undefined ? { toMessageId } : {}),
        name: input.name.trim(),
        ...(description !== undefined ? { description } : {}),
        tags: normalizeBookmarkTags(input.tags),
        ...(excerpt !== undefined ? { excerpt } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await store.save(record);
      return record;
    },

    list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]> {
      if (filter?.sessionId === undefined) {
        return store.list(filter);
      }
      const session = dependencies.sessions.resolveSessionKey(filter.sessionId);
      const sessionId =
        session === undefined
          ? filter.sessionId
          : bookmarkSessionIdFor(session);
      return store.list({ ...filter, sessionId });
    },

    show(id: string): Promise<BookmarkRecord | null> {
      return store.get(id);
    },

    delete(id: string): Promise<boolean> {
      return store.delete(id);
    },

    search(
      query: string,
      options?: BookmarkSearchOptions,
    ): Promise<BookmarkSearchResult> {
      return store.search(query, options);
    },
  };
}
