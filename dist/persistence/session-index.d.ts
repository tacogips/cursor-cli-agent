import type { CursorSessionRecord } from "../types/session-record";
import type { SessionSearchOptions, SessionSearchResult } from "../types/session-search";
export declare class SessionIndexRepository {
    private readonly db;
    private readonly projectsRoot;
    constructor(dbPath: string, options?: {
        readonly cursorProjectsRoot?: string;
    });
    close(): void;
    upsert(record: CursorSessionRecord): void;
    findByRecordId(recordId: string): CursorSessionRecord | undefined;
    findByLocalSessionId(id: string): CursorSessionRecord | undefined;
    findByCursorChatId(id: string): CursorSessionRecord | undefined;
    /**
     * Resolve a session id that may be either local transcript id or Cursor chat id.
     */
    resolveSessionKey(key: string): CursorSessionRecord | undefined;
    listSessions(limit: number): CursorSessionRecord[];
    listSessionsForWorkspace(workspacePath: string, limit: number): CursorSessionRecord[];
    listTranscriptBackedSessions(): CursorSessionRecord[];
    searchSessions(options: SessionSearchOptions): SessionSearchResult;
    /**
     * When a pending chat-only row exists, attach transcript id and paths after materialization.
     */
    insertPendingChatRecord(cursorChatId: string, workspacePath: string): CursorSessionRecord;
    /**
     * Scan Cursor transcript files and upsert imported sessions (`transcript_only`).
     */
    importTranscriptsFromFilesystem(): Promise<number>;
}
//# sourceMappingURL=session-index.d.ts.map