import type { ActivityManager } from "../activity/manager";
import { loadAiTrackingEnrichment } from "../cursor/ai-tracking-reader";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { ActivityStatus, SessionActivity } from "../types/activity";
import type { UsageStatsOptions, UsageStatsReport } from "../types/usage-stats";
import type {
  CursorSessionRecord,
  SessionStatus,
} from "../types/session-record";

const DEFAULT_RECENT_DAYS = 14;

export interface UsageStatsManagerOptions {
  readonly sessions: SessionIndexRepository;
  readonly activity?: ActivityManager;
}

interface MutableDailyUsageActivity {
  readonly date: string;
  sessionCount: number;
  activitySignalCount: number;
}

function normalizeRecentDays(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_RECENT_DAYS;
}

function dateKey(value: string | Date): string | null {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function increment<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
): void {
  record[key] = (record[key] ?? 0) + 1;
}

function makeRecentDays(
  now: Date,
  recentDays: number,
): MutableDailyUsageActivity[] {
  const lastDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const firstDay = lastDay - (recentDays - 1) * 86400000;
  const days: MutableDailyUsageActivity[] = [];
  for (let index = 0; index < recentDays; index += 1) {
    days.push({
      date: new Date(firstDay + index * 86400000).toISOString().slice(0, 10),
      sessionCount: 0,
      activitySignalCount: 0,
    });
  }
  return days;
}

function aggregateSession(
  record: CursorSessionRecord,
  statusCounts: Partial<Record<SessionStatus, number>>,
  models: Record<string, number>,
  dailyByDate: Map<string, MutableDailyUsageActivity>,
): string | null {
  increment(statusCounts, record.status);
  if (record.model !== undefined && record.model.length > 0) {
    models[record.model] = (models[record.model] ?? 0) + 1;
  }
  const firstSessionDate =
    dateKey(record.createdAt) ?? dateKey(record.updatedAt);
  const activeDates = new Set(
    [dateKey(record.createdAt), dateKey(record.updatedAt)].filter(
      (date): date is string => date !== null,
    ),
  );
  for (const activeDate of activeDates) {
    const daily = dailyByDate.get(activeDate);
    if (daily !== undefined) {
      daily.sessionCount += 1;
    }
  }
  return firstSessionDate;
}

function conversationId(record: CursorSessionRecord): string | undefined {
  return record.localSessionId ?? record.cursorChatId;
}

function addOptionalAiTrackingModel(
  record: CursorSessionRecord,
  models: Record<string, number>,
): boolean {
  if (record.model !== undefined) {
    return false;
  }
  const id = conversationId(record);
  if (id === undefined) {
    return false;
  }
  const enrichment = loadAiTrackingEnrichment(id);
  const model = enrichment?.summary?.model;
  if (model === undefined || model.length === 0) {
    return false;
  }
  models[model] = (models[model] ?? 0) + 1;
  return true;
}

function aggregateActivity(
  activity: SessionActivity,
  activityStatusCounts: Partial<Record<ActivityStatus, number>>,
  dailyByDate: Map<string, MutableDailyUsageActivity>,
): void {
  increment(activityStatusCounts, activity.status);
  for (const signal of activity.signals) {
    const signalDate = dateKey(signal.observedAt);
    if (signalDate === null) {
      continue;
    }
    const daily = dailyByDate.get(signalDate);
    if (daily !== undefined) {
      daily.activitySignalCount += 1;
    }
  }
}

export function createUsageStatsManager(
  managerOptions: UsageStatsManagerOptions,
): {
  stats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
} {
  return {
    async stats(options: UsageStatsOptions = {}): Promise<UsageStatsReport> {
      const now = options.now ?? new Date();
      const recentDays = normalizeRecentDays(options.recentDays);
      const recentDailyActivity = makeRecentDays(now, recentDays);
      const dailyByDate = new Map(
        recentDailyActivity.map((daily) => [daily.date, daily]),
      );
      const sessions = managerOptions.sessions.listSessions(100000);
      const statusCounts: Partial<Record<SessionStatus, number>> = {};
      const activityStatusCounts: Partial<Record<ActivityStatus, number>> = {};
      const models: Record<string, number> = {};
      let firstSessionDate: string | null = null;
      let aiTrackingModelCount = 0;

      for (const record of sessions) {
        const sessionDate = aggregateSession(
          record,
          statusCounts,
          models,
          dailyByDate,
        );
        if (
          options.includeAiTracking === true &&
          addOptionalAiTrackingModel(record, models)
        ) {
          aiTrackingModelCount += 1;
        }
        if (
          sessionDate !== null &&
          (firstSessionDate === null || sessionDate < firstSessionDate)
        ) {
          firstSessionDate = sessionDate;
        }
      }

      const completenessNotes: string[] = [];
      if (managerOptions.activity === undefined) {
        completenessNotes.push(
          "activity manager unavailable; activity counts omitted",
        );
      } else {
        try {
          const activities = await managerOptions.activity.listActivity({
            limit: 100000,
          });
          for (const activity of activities) {
            aggregateActivity(activity, activityStatusCounts, dailyByDate);
          }
        } catch {
          completenessNotes.push(
            "activity store unavailable; activity counts may be incomplete",
          );
        }
      }

      if (options.includeAiTracking === true) {
        completenessNotes.push(
          aiTrackingModelCount > 0
            ? `ai-tracking enrichment added ${aiTrackingModelCount} model count(s)`
            : "ai-tracking enrichment requested but no additional model rows were available",
        );
      } else {
        completenessNotes.push("ai-tracking enrichment was not requested");
      }
      completenessNotes.push(
        "token totals are unknown because no repository-owned usage event store exists",
      );

      return {
        totalSessions: sessions.length,
        statusCounts,
        activityStatusCounts,
        firstSessionDate,
        lastComputedDate: dateKey(now) ?? now.toISOString(),
        models,
        recentDailyActivity,
        completenessNotes,
      };
    },
  };
}
