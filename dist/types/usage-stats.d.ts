import type { ActivityStatus } from "./activity";
import type { SessionStatus } from "./session-record";
import type { UsageTokenTotals } from "./usage-event";
export interface UsageStatsOptions {
    readonly recentDays?: number;
    readonly now?: Date;
    readonly includeAiTracking?: boolean;
    readonly workspacePath?: string;
    readonly sessionId?: string;
}
export interface DailyUsageActivity {
    readonly date: string;
    readonly sessionCount: number;
    readonly activitySignalCount: number;
}
export interface UsageDailyTokenActivity {
    readonly date: string;
    readonly tokensByModel: Record<string, number>;
}
/**
 * Counts scoped to filtered sessions (`UsageStatsOptions`) and persisted usage-event evidence.
 *
 * When `UsageEventStore.listEvents` fails, callers may omit evidence for that run:
 * aggregates zero these counts (instead of implying all headless sessions lack usage),
 * attach a completeness note, and often keep {@link UsageStatsReport.usageProvenance}
 * `"repository_usage_events"` when a store was wired.
 */
export interface UsageEvidenceCoverage {
    readonly sessionsWithUsageEvents: number;
    readonly knownSessionsWithoutUsageEvents: number;
    readonly wrapperStartedSessionsWithoutUsageEvents: number;
}
export interface UsageStatsReport {
    readonly totalSessions: number;
    readonly statusCounts: Partial<Record<SessionStatus, number>>;
    readonly activityStatusCounts: Partial<Record<ActivityStatus, number>>;
    readonly firstSessionDate: string | null;
    readonly lastComputedDate: string;
    readonly models: Record<string, number>;
    readonly recentDailyActivity: readonly DailyUsageActivity[];
    readonly completenessNotes: readonly string[];
    readonly usageTokens: UsageTokenTotals;
    /** Count of distinct persisted usage rows' `sessionId` (stream-local id), not merge keys. */
    readonly usageSessionsObserved: number;
    readonly usageTokensByModel: Record<string, UsageTokenTotals>;
    readonly usageRecentDailyActivity: readonly UsageDailyTokenActivity[];
    readonly usageEvidenceCoverage: UsageEvidenceCoverage;
    readonly usageProvenance: "repository_usage_events" | "unavailable";
}
//# sourceMappingURL=usage-stats.d.ts.map