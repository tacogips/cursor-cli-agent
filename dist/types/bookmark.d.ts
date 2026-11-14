export declare const BOOKMARK_TYPES: readonly ["session", "message", "range"];
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
export declare function isBookmarkType(value: string): value is BookmarkType;
export declare function normalizeBookmarkTags(tags: readonly string[] | undefined): readonly string[];
export declare function validateCreateBookmarkInput(input: CreateBookmarkInput): readonly string[];
//# sourceMappingURL=bookmark.d.ts.map