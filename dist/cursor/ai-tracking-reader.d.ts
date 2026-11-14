import type { AiCodeTouchRow, AiConversationEnrichment, AiDeletedFileRow, AiTrackedFileRef } from "../types/ai-enrichment";
import type { FileIntelligenceProvenance } from "../types/file-intelligence";
import type { RepositoryAnalyticsProvenance, ScoredCommitAnalytics } from "../types/repository-analytics";
export interface AiTrackingReadResult<T> {
    readonly rows: readonly T[];
    readonly provenance: FileIntelligenceProvenance;
}
export interface AiTrackingFileReader {
    listCodeTouches(conversationId: string): AiTrackingReadResult<AiCodeTouchRow>;
    listTrackedSnapshots(conversationId: string, options?: {
        readonly includeContent?: boolean;
    }): AiTrackingReadResult<AiTrackedFileRef>;
    listDeletedFiles(conversationId: string): AiTrackingReadResult<AiDeletedFileRow>;
    listConversationFileRefs(conversationIds: readonly string[]): AiTrackingReadResult<AiTrackingConversationFileRef>;
}
export interface AiTrackingConversationFileRef {
    readonly conversationId: string;
    readonly path: string;
    readonly operation: "touched" | "deleted" | "snapshot";
    readonly observedAt?: number;
    readonly model?: string;
}
export interface ScoredCommitReadOptions {
    readonly limit?: number;
}
export interface AiTrackingScoredCommitResult {
    readonly rows: readonly ScoredCommitAnalytics[];
    readonly provenance: RepositoryAnalyticsProvenance;
    readonly completenessNotes: readonly string[];
}
export interface AiTrackingAnalyticsReader {
    listScoredCommits(options?: ScoredCommitReadOptions): AiTrackingScoredCommitResult;
}
/**
 * Load optional per-conversation metadata from the local ai-tracking database.
 * Returns undefined if the DB is missing, unreadable, or has no rows for this id.
 */
export declare function loadAiTrackingEnrichment(conversationId: string, dbPath?: string): AiConversationEnrichment | undefined;
export declare function createAiTrackingFileReader(dbPath?: string): AiTrackingFileReader;
export declare function createAiTrackingAnalyticsReader(dbPath?: string): AiTrackingAnalyticsReader;
//# sourceMappingURL=ai-tracking-reader.d.ts.map