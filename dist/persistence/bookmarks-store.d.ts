import { bookmarksJsonPath } from "../config/paths";
import type { BookmarkFilter, BookmarkRecord, BookmarkSearchOptions, BookmarkSearchResult } from "../types/bookmark";
export interface BookmarksStore {
    list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
    get(id: string): Promise<BookmarkRecord | null>;
    save(record: BookmarkRecord): Promise<void>;
    delete(id: string): Promise<boolean>;
    search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
export { bookmarksJsonPath };
export declare function createBookmarksStore(path?: string): BookmarksStore;
//# sourceMappingURL=bookmarks-store.d.ts.map