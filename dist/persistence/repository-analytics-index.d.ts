import type { RepositoryAnalyticsProvenance, RepositoryAnalyticsRebuildStats, RepositoryAnalyticsSummary, RepositoryCommitListOptions, RepositoryCommitListResult, RepositoryFileAnalytics, RepositoryFileAnalyticsOptions, RepositoryFileAnalyticsResult, RepositorySessionAnalytics, RepositorySessionAnalyticsOptions, RepositorySessionAnalyticsResult, ScoredCommitAnalytics } from "../types/repository-analytics";
export interface RepositoryAnalyticsRebuildInput {
    readonly commits: readonly ScoredCommitAnalytics[];
    readonly sessions: readonly RepositorySessionAnalytics[];
    readonly files: readonly RepositoryFileAnalytics[];
    readonly skippedRows: number;
    readonly provenance: readonly RepositoryAnalyticsProvenance[];
    readonly completenessNotes: readonly string[];
}
export declare class RepositoryAnalyticsIndex {
    private readonly db;
    constructor(dbPath: string);
    close(): void;
    rebuild(input: RepositoryAnalyticsRebuildInput): RepositoryAnalyticsRebuildStats;
    getSummary(): RepositoryAnalyticsSummary;
    listCommits(options?: RepositoryCommitListOptions): RepositoryCommitListResult;
    listSessions(options?: RepositorySessionAnalyticsOptions): RepositorySessionAnalyticsResult;
    listFiles(options?: RepositoryFileAnalyticsOptions): RepositoryFileAnalyticsResult;
}
//# sourceMappingURL=repository-analytics-index.d.ts.map