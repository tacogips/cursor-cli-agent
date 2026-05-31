export type RepositoryAnalyticsProvenance = "ai_tracking" | "file_intelligence" | "git" | "index" | "missing_ai_tracking" | "missing_scored_commits" | "missing_file_intelligence" | "missing_rows" | "unknown";
export interface ScoredCommitAnalytics {
    readonly commitHash: string;
    readonly branchName?: string;
    readonly commitMessage?: string;
    readonly commitDate?: string;
    readonly composerLinesAdded?: number;
    readonly composerLinesDeleted?: number;
    readonly v1AiPercentage?: number;
    readonly v2AiPercentage?: number;
    readonly provenance: RepositoryAnalyticsProvenance;
    readonly completenessNotes: readonly string[];
}
export interface RepositoryAnalyticsSummary {
    readonly totalCommits: number;
    readonly scoredCommits: number;
    readonly totalComposerLines: number;
    readonly weightedV1AiPercentage?: number;
    readonly weightedV2AiPercentage?: number;
    readonly updatedAt?: string;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export interface RepositorySessionAnalytics {
    readonly sessionId: string;
    readonly recordId: string;
    readonly conversationId?: string;
    readonly workspacePath?: string;
    readonly touchedFiles: number;
    readonly deletedFiles: number;
    readonly snapshots: number;
    readonly unknownFiles: number;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export interface RepositoryFileAnalytics {
    readonly path: string;
    readonly sessions: number;
    readonly touchedCount: number;
    readonly deletedCount: number;
    readonly snapshotCount: number;
    readonly firstObservedAt?: string;
    readonly lastObservedAt?: string;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
}
export interface RepositoryAnalyticsRebuildStats {
    readonly indexedCommits: number;
    readonly indexedSessions: number;
    readonly indexedFiles: number;
    readonly skippedRows: number;
    readonly updatedAt: string;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export interface RepositoryCommitListOptions {
    readonly limit?: number;
}
export interface RepositoryCommitListResult {
    readonly commits: readonly ScoredCommitAnalytics[];
    readonly totalCommits: number;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export interface RepositorySessionAnalyticsOptions {
    readonly limit?: number;
}
export interface RepositorySessionAnalyticsResult {
    readonly sessions: readonly RepositorySessionAnalytics[];
    readonly totalSessions: number;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export interface RepositoryFileAnalyticsOptions {
    readonly limit?: number;
}
export interface RepositoryFileAnalyticsResult {
    readonly files: readonly RepositoryFileAnalytics[];
    readonly totalFiles: number;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
//# sourceMappingURL=repository-analytics.d.ts.map