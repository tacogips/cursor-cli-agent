import type { TranscriptBookmarkLookup } from "../cursor/transcript-bookmark-lookup";
import type { BookmarksStore } from "../persistence/bookmarks-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { BookmarkFilter, BookmarkRecord, BookmarkSearchOptions, BookmarkSearchResult, CreateBookmarkInput } from "../types/bookmark";
export declare class BookmarkInputError extends Error {
    constructor(message: string);
}
export declare class BookmarkNotFoundError extends Error {
    constructor(message: string);
}
export interface BookmarkManager {
    add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
    list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
    show(id: string): Promise<BookmarkRecord | null>;
    delete(id: string): Promise<boolean>;
    search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
export interface BookmarkManagerDependencies {
    readonly sessions: SessionIndexRepository;
    readonly store?: BookmarksStore;
    readonly transcriptLookup?: TranscriptBookmarkLookup;
    readonly now?: () => Date;
    readonly createId?: () => string;
}
export declare function createBookmarkManager(dependencies: BookmarkManagerDependencies): BookmarkManager;
//# sourceMappingURL=manager.d.ts.map