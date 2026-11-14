import { resolve } from "node:path";

import type { ActivityManager } from "../activity/manager";
import { workspaceSlugFromPath } from "../config/paths";
import { loadAiTrackingEnrichment } from "../cursor/ai-tracking-reader";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { UsageEventStore } from "../persistence/usage-event-store";
import type { ActivityStatus, SessionActivity } from "../types/activity";
import type { UsageEventRecord, UsageTokenTotals } from "../types/usage-event";
import type {
  UsageDailyTokenActivity,
  UsageEvidenceCoverage,
  UsageStatsOptions,
  UsageStatsReport,
} from "../types/usage-stats";
import type {
  CursorSessionRecord,
  SessionStatus,
} from "../types/session-record";

const DEFAULT_RECENT_DAYS = 14;

export interface UsageStatsManagerOptions {
  readonly sessions: SessionIndexRepository;
  readonly activity?: ActivityManager;
  readonly usageEvents?: UsageEventStore;
}

interface MutableDailyUsageActivity {
  readonly date: string;
  sessionCount: number;
  activitySignalCount: number;
}

interface MutableUsageDaily {
  readonly date: string;
  tokensByModel: Record<string, number>;
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

/** UTC calendar days ending at `now`'s date, oldest first (shared by session activity and usage token buckets). */
function recentDateKeys(now: Date, recentDays: number): readonly string[] {
  const lastDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const firstDay = lastDay - (recentDays - 1) * 86400000;
  const keys: string[] = [];
  for (let index = 0; index < recentDays; index += 1) {
    keys.push(new Date(firstDay + index * 86400000).toISOString().slice(0, 10));
  }
  return keys;
}

function makeRecentDays(
  now: Date,
  recentDays: number,
): MutableDailyUsageActivity[] {
  return recentDateKeys(now, recentDays).map((date) => ({
    date,
    sessionCount: 0,
    activitySignalCount: 0,
  }));
}

function makeUsageRecentDays(
  now: Date,
  recentDays: number,
): MutableUsageDaily[] {
  return recentDateKeys(now, recentDays).map((date) => ({
    date,
    tokensByModel: {},
  }));
}

function emptyUsageTotals(): UsageTokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function addUsageTotals(
  a: UsageTokenTotals,
  b: UsageTokenTotals,
): UsageTokenTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function sessionMatchesFilters(
  record: CursorSessionRecord,
  options: UsageStatsOptions,
): boolean {
  if (options.sessionId !== undefined && options.sessionId.length > 0) {
    const id = options.sessionId;
    if (
      record.recordId !== id &&
      record.localSessionId !== id &&
      record.cursorChatId !== id
    ) {
      return false;
    }
  }
  if (options.workspacePath !== undefined && options.workspacePath.length > 0) {
    const abs = resolve(options.workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const recordPath =
      record.workspacePath !== undefined
        ? resolve(record.workspacePath)
        : undefined;
    if (recordPath !== abs && record.workspaceSlug !== slug) {
      return false;
    }
  }
  return true;
}

function sessionKeys(record: CursorSessionRecord): ReadonlySet<string> {
  return new Set(
    [record.recordId, record.localSessionId, record.cursorChatId].filter(
      (x): x is string => x !== undefined && x.length > 0,
    ),
  );
}

function sessionHasUsageEvent(
  record: CursorSessionRecord,
  events: readonly {
    readonly sessionId: string;
    readonly recordId?: string;
    readonly cursorChatId?: string;
  }[],
): boolean {
  const keys = sessionKeys(record);
  return events.some(
    (e) =>
      keys.has(e.sessionId) ||
      (e.recordId !== undefined && keys.has(e.recordId)) ||
      (e.cursorChatId !== undefined && keys.has(e.cursorChatId)),
  );
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
      const allSessions = managerOptions.sessions.listSessions(100000);
      const scopedSessions = allSessions.filter((r) =>
        sessionMatchesFilters(r, options),
      );

      let usageEventsReadFailed = false;
      let usageEvents: readonly UsageEventRecord[] = [];
      if (managerOptions.usageEvents !== undefined) {
        try {
          usageEvents = await managerOptions.usageEvents.listEvents({
            ...(options.sessionId !== undefined && options.sessionId.length > 0
              ? { sessionId: options.sessionId }
              : {}),
            ...(options.workspacePath !== undefined &&
            options.workspacePath.length > 0
              ? { workspacePath: options.workspacePath }
              : {}),
          });
        } catch {
          usageEventsReadFailed = true;
          usageEvents = [];
        }
      }

      const usageRecentMutable = makeUsageRecentDays(now, recentDays);
      const usageDailyByDate = new Map(
        usageRecentMutable.map((d) => [d.date, d]),
      );

      let usageTokens = emptyUsageTotals();
      const usageTokensByModel: Record<string, UsageTokenTotals> = {};
      const usageSessionIds = new Set<string>();

      for (const ev of usageEvents) {
        usageTokens = addUsageTotals(usageTokens, ev);
        usageSessionIds.add(ev.sessionId);
        const prevModel = usageTokensByModel[ev.model] ?? emptyUsageTotals();
        usageTokensByModel[ev.model] = addUsageTotals(prevModel, ev);

        const dk = dateKey(ev.observedAt);
        if (dk !== null) {
          const bucket = usageDailyByDate.get(dk);
          if (bucket !== undefined) {
            bucket.tokensByModel[ev.model] =
              (bucket.tokensByModel[ev.model] ?? 0) + ev.totalTokens;
          }
        }
      }

      const usageEvidenceCoverage: UsageEvidenceCoverage = (() => {
        if (usageEventsReadFailed) {
          return {
            sessionsWithUsageEvents: 0,
            knownSessionsWithoutUsageEvents: 0,
            wrapperStartedSessionsWithoutUsageEvents: 0,
          };
        }
        let sessionsWithUsageEvents = 0;
        let wrapperStartedSessionsWithoutUsageEvents = 0;
        for (const record of scopedSessions) {
          const has = sessionHasUsageEvent(record, usageEvents);
          if (has) {
            sessionsWithUsageEvents += 1;
          } else if (record.source === "headless") {
            wrapperStartedSessionsWithoutUsageEvents += 1;
          }
        }
        const knownSessionsWithoutUsageEvents =
          scopedSessions.length - sessionsWithUsageEvents;
        return {
          sessionsWithUsageEvents,
          knownSessionsWithoutUsageEvents,
          wrapperStartedSessionsWithoutUsageEvents,
        };
      })();

      const statusCounts: Partial<Record<SessionStatus, number>> = {};
      const activityStatusCounts: Partial<Record<ActivityStatus, number>> = {};
      const models: Record<string, number> = {};
      let firstSessionDate: string | null = null;
      let aiTrackingModelCount = 0;

      for (const record of scopedSessions) {
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
        const activityManager = managerOptions.activity;
        try {
          const activities = await Promise.all(
            scopedSessions.map((record) => {
              const id =
                record.localSessionId ?? record.cursorChatId ?? record.recordId;
              return activityManager.getSessionActivity(id);
            }),
          );
          for (const activity of activities) {
            if (activity !== null) {
              aggregateActivity(activity, activityStatusCounts, dailyByDate);
            }
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

      if (managerOptions.usageEvents === undefined) {
        completenessNotes.push(
          "usage event store unavailable; token totals omit persisted wrapper captures",
        );
      } else if (usageEventsReadFailed) {
        completenessNotes.push(
          "usage event store read failed; token totals and usage coverage omitted for this run",
        );
      } else if (
        usageEvidenceCoverage.wrapperStartedSessionsWithoutUsageEvents > 0
      ) {
        completenessNotes.push(
          `${usageEvidenceCoverage.wrapperStartedSessionsWithoutUsageEvents} headless session(s) in scope have no persisted usage events yet`,
        );
      }

      const usageRecentDailyActivity: readonly UsageDailyTokenActivity[] =
        usageRecentMutable.map((d) => ({
          date: d.date,
          tokensByModel: { ...d.tokensByModel },
        }));

      return {
        totalSessions: scopedSessions.length,
        statusCounts,
        activityStatusCounts,
        firstSessionDate,
        lastComputedDate: dateKey(now) ?? now.toISOString(),
        models,
        recentDailyActivity,
        completenessNotes,
        usageTokens,
        usageSessionsObserved: usageSessionIds.size,
        usageTokensByModel,
        usageRecentDailyActivity,
        usageEvidenceCoverage,
        usageProvenance:
          managerOptions.usageEvents === undefined
            ? "unavailable"
            : "repository_usage_events",
      };
    },
  };
}
