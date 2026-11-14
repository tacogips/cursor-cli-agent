import { type ActivityListOptions } from "../activity/manager";
import type { ActivitySignal, SessionActivity } from "../types/activity";
import type { BookmarkFilter, BookmarkRecord, BookmarkSearchOptions, BookmarkSearchResult, CreateBookmarkInput } from "../types/bookmark";
import type { FileHistoryResult, FileIndexRebuildStats, FileSnapshotOptions, SessionDeletedFilesResult, SessionFileSnapshotResult, SessionFileSummary } from "../types/file-intelligence";
import type { GroupProgressSnapshot, GroupRecord } from "../types/group";
import type { QueueItemMode, QueueItemStatus, QueueProgressSnapshot, QueueRecord } from "../types/queue";
import type { CursorSessionRecord } from "../types/session-record";
import type { SessionSearchOptions, SessionSearchResult } from "../types/session-search";
import type { TranscriptSearchOptions, TranscriptSearchResult } from "../types/transcript-search";
import type { CursorAgentSdkOptions } from "./types";
export interface SessionFacade {
    list(options?: {
        readonly limit?: number;
    }): Promise<readonly CursorSessionRecord[]>;
    get(sessionId: string): Promise<CursorSessionRecord | null>;
    refresh(): Promise<readonly CursorSessionRecord[]>;
}
export interface SearchFacade {
    sessions(options: SessionSearchOptions): Promise<SessionSearchResult>;
    transcripts(options: TranscriptSearchOptions): Promise<TranscriptSearchResult>;
}
export interface GroupFacade {
    list(): Promise<readonly GroupRecord[]>;
    get(name: string): Promise<GroupRecord | null>;
    create(name: string): Promise<GroupRecord>;
    addWorkspace(name: string, workspace: string): Promise<GroupRecord>;
    removeWorkspace(name: string, workspace: string): Promise<GroupRecord>;
    delete(name: string): Promise<GroupRecord | null>;
    pause(name: string): Promise<GroupRecord | null>;
    resume(name: string): Promise<GroupRecord | null>;
    progress(name: string): Promise<GroupProgressSnapshot | null>;
}
export interface QueueFacade {
    list(): Promise<readonly QueueRecord[]>;
    get(name: string): Promise<QueueRecord | null>;
    create(name: string, workspace: string): Promise<QueueRecord>;
    addItem(name: string, prompt: string): Promise<QueueRecord>;
    updateItem(name: string, itemId: string, patch: {
        readonly prompt?: string | undefined;
        readonly status?: QueueItemStatus | undefined;
    }): Promise<QueueRecord | null>;
    removeItem(name: string, itemId: string): Promise<QueueRecord>;
    moveItem(name: string, from: number, to: number): Promise<QueueRecord | null>;
    setItemMode(name: string, itemId: string, mode: QueueItemMode): Promise<QueueRecord | null>;
    delete(name: string): Promise<QueueRecord | null>;
    pause(name: string): Promise<QueueRecord | null>;
    resume(name: string): Promise<QueueRecord | null>;
    requestStop(name: string): Promise<QueueRecord | null>;
    progress(name: string): Promise<QueueProgressSnapshot | null>;
}
export interface BookmarkFacade {
    add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
    list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
    show(id: string): Promise<BookmarkRecord | null>;
    delete(id: string): Promise<boolean>;
    search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
export interface FileFacade {
    list(sessionId: string): Promise<SessionFileSummary>;
    snapshots(sessionId: string, options?: FileSnapshotOptions): Promise<SessionFileSnapshotResult>;
    deleted(sessionId: string): Promise<SessionDeletedFilesResult>;
    find(path: string): Promise<FileHistoryResult>;
    rebuild(): Promise<FileIndexRebuildStats>;
}
export interface ActivityFacade {
    get(sessionId: string): Promise<SessionActivity | null>;
    list(options?: ActivityListOptions): Promise<readonly SessionActivity[]>;
    recordSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}
interface FacadeFactoryResult {
    readonly sessions: SessionFacade;
    readonly search: SearchFacade;
    readonly groups: GroupFacade;
    readonly queues: QueueFacade;
    readonly bookmarks: BookmarkFacade;
    readonly files: FileFacade;
    readonly activity: ActivityFacade;
}
export declare function createDomainFacades(options?: CursorAgentSdkOptions): FacadeFactoryResult;
export {};
//# sourceMappingURL=facades.d.ts.map