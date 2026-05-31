import type { FileHistoryEntry, FileHistoryResult, FileIndexRebuildStats, FileIndexStats, FileIntelligenceOperation, FileIntelligencePathRef, FileIntelligenceProvenance } from "../types/file-intelligence";
export interface FileIndexEntryInput {
    readonly sessionId: string;
    readonly recordId: string;
    readonly conversationId?: string;
    readonly rawPath: string;
    readonly normalizedPath: string;
    readonly pathKind: FileIntelligencePathRef["pathKind"];
    readonly operation: FileIntelligenceOperation;
    readonly observedAt?: string;
    readonly model?: string;
    readonly provenance: FileIntelligenceProvenance;
}
export interface FileIndexRebuildInput {
    readonly entries: readonly FileIndexEntryInput[];
    readonly indexedSessions: number;
    readonly skippedSessions: number;
    readonly provenance: FileIntelligenceProvenance;
}
export declare class FileIntelligenceIndex {
    private readonly db;
    constructor(dbPath: string);
    close(): void;
    rebuild(input: FileIndexRebuildInput): FileIndexRebuildStats;
    findByPath(path: string): FileHistoryResult;
    listEntries(limit?: number): readonly FileHistoryEntry[];
    getStats(): FileIndexStats;
}
export declare function normalizeIndexPath(path: string): string;
//# sourceMappingURL=file-intelligence-index.d.ts.map