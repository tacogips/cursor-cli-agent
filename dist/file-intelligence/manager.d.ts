import type { FileHistoryResult, FileIndexRebuildStats, FileSnapshotOptions, SessionDeletedFilesResult, SessionFileSnapshotResult, SessionFileSummary } from "../types/file-intelligence";
import type { AiTrackingFileReader } from "../cursor/ai-tracking-reader";
import { type FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import type { SessionIndexRepository } from "../persistence/session-index";
export declare class FileIntelligenceNotFoundError extends Error {
    constructor(message: string);
}
export interface FileIntelligenceService {
    listFiles(sessionId: string): Promise<SessionFileSummary>;
    listSnapshots(sessionId: string, options?: FileSnapshotOptions): Promise<SessionFileSnapshotResult>;
    listDeleted(sessionId: string): Promise<SessionDeletedFilesResult>;
    findFile(path: string): Promise<FileHistoryResult>;
    rebuild(): Promise<FileIndexRebuildStats>;
}
export declare function createFileIntelligenceService(deps: {
    readonly sessions: SessionIndexRepository;
    readonly aiTracking: AiTrackingFileReader;
    readonly index: FileIntelligenceIndex;
}): FileIntelligenceService;
//# sourceMappingURL=manager.d.ts.map