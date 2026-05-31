import type { AiTrackingAnalyticsReader } from "../cursor/ai-tracking-reader";
import type { FileIntelligenceService } from "../file-intelligence";
import type { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import type { RepositoryAnalyticsIndex } from "../persistence/repository-analytics-index";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { RepositoryAnalyticsRebuildStats, RepositoryAnalyticsSummary, RepositoryCommitListOptions, RepositoryCommitListResult, RepositoryFileAnalyticsOptions, RepositoryFileAnalyticsResult, RepositorySessionAnalyticsOptions, RepositorySessionAnalyticsResult } from "../types/repository-analytics";
export interface RepositoryAnalyticsService {
    getSummary(): Promise<RepositoryAnalyticsSummary>;
    listCommits(options?: RepositoryCommitListOptions): Promise<RepositoryCommitListResult>;
    listSessions(options?: RepositorySessionAnalyticsOptions): Promise<RepositorySessionAnalyticsResult>;
    listFiles(options?: RepositoryFileAnalyticsOptions): Promise<RepositoryFileAnalyticsResult>;
    rebuild(): Promise<RepositoryAnalyticsRebuildStats>;
}
export declare function createRepositoryAnalyticsService(deps: {
    readonly sessions: SessionIndexRepository;
    readonly aiTracking: AiTrackingAnalyticsReader;
    readonly fileIntelligence: FileIntelligenceService;
    readonly fileIndex: FileIntelligenceIndex;
    readonly analyticsIndex: RepositoryAnalyticsIndex;
}): RepositoryAnalyticsService;
//# sourceMappingURL=manager.d.ts.map