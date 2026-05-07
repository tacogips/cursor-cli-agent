import type { ActivityStatus } from "./activity";
import type { SessionStatus } from "./session-record";

export interface UsageStatsOptions {
  readonly recentDays?: number;
  readonly now?: Date;
  readonly includeAiTracking?: boolean;
}

export interface DailyUsageActivity {
  readonly date: string;
  readonly sessionCount: number;
  readonly activitySignalCount: number;
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
}
