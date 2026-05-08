import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { SessionIndexRepository } from "../persistence/session-index";
import {
  createUsageEventStore,
  type UsageEventStore,
} from "../persistence/usage-event-store";
import type { ActivityManager } from "../activity/manager";
import type { UsageEventRecord } from "../types/usage-event";
import { createUsageStatsManager } from "./manager";

let testDir: string | undefined;

afterEach(async () => {
  if (testDir !== undefined) {
    await rm(testDir, { recursive: true, force: true });
    testDir = undefined;
  }
});

async function createRepo(): Promise<SessionIndexRepository> {
  testDir = await mkdtemp(join(tmpdir(), "curort-usage-stats-"));
  return new SessionIndexRepository(join(testDir, "state.db"));
}

describe("usage stats manager", () => {
  test("aggregates sessions, models, activity status, and recent daily buckets", async () => {
    const repo = await createRepo();
    repo.upsert({
      recordId: "rec-1",
      localSessionId: "local-1",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-06T01:00:00.000Z",
      updatedAt: "2026-05-06T02:00:00.000Z",
      source: "headless",
      status: "completed",
      model: "gpt-test",
    });
    repo.upsert({
      recordId: "rec-2",
      localSessionId: "local-2",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-07T01:00:00.000Z",
      updatedAt: "2026-05-07T02:00:00.000Z",
      source: "headless",
      status: "failed",
    });

    const completedActivityForLocal1 = {
      recordId: "activity:rec-1",
      localSessionId: "local-1",
      status: "completed" as const,
      updatedAt: "2026-05-06T02:00:00.000Z",
      signals: [
        {
          source: "index" as const,
          status: "completed" as const,
          observedAt: "2026-05-06T02:00:00.000Z",
        },
      ],
      provenance: "derived" as const,
    };

    const activity: ActivityManager = {
      getSessionActivity: async (sessionId: string) => {
        if (sessionId === "local-1" || sessionId === "rec-1") {
          return completedActivityForLocal1;
        }
        return null;
      },
      listActivity: async () => [],
      recordSignal: async () => {},
    };

    const usagePath = join(testDir!, "usage-events.json");
    const usageStore = createUsageEventStore(usagePath);
    const sampleEv: UsageEventRecord = {
      eventId: "u1",
      sessionId: "local-1",
      recordId: "rec-1",
      model: "gpt-test",
      observedAt: "2026-05-06T02:30:00.000Z",
      source: "stream_result",
      provenance: "repository_usage_events",
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 5,
    };
    await usageStore.upsertEvent(sampleEv);

    const report = await createUsageStatsManager({
      sessions: repo,
      activity,
      usageEvents: usageStore,
    }).stats({
      recentDays: 2,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(report.totalSessions).toBe(2);
    expect(report.statusCounts).toEqual({ failed: 1, completed: 1 });
    expect(report.activityStatusCounts).toEqual({ completed: 1 });
    expect(report.firstSessionDate).toBe("2026-05-06");
    expect(report.models).toEqual({ "gpt-test": 1 });
    expect(report.recentDailyActivity).toEqual([
      {
        date: "2026-05-06",
        sessionCount: 1,
        activitySignalCount: 1,
      },
      {
        date: "2026-05-07",
        sessionCount: 1,
        activitySignalCount: 0,
      },
    ]);
    expect(report.usageTokens.totalTokens).toBe(5);
    expect(report.usageSessionsObserved).toBe(1);
    expect(report.usageEvidenceCoverage.sessionsWithUsageEvents).toBe(1);
    expect(report.usageEvidenceCoverage.knownSessionsWithoutUsageEvents).toBe(
      1,
    );
    expect(
      report.usageEvidenceCoverage.wrapperStartedSessionsWithoutUsageEvents,
    ).toBe(1);
    expect(report.usageProvenance).toBe("repository_usage_events");
    expect(
      report.usageRecentDailyActivity.find((d) => d.date === "2026-05-06")
        ?.tokensByModel["gpt-test"],
    ).toBe(5);
    repo.close();
  });

  test("scopes activity aggregation to session and workspace filters", async () => {
    const repo = await createRepo();
    repo.upsert({
      recordId: "rec-a",
      localSessionId: "local-a",
      identityState: "transcript_only",
      workspaceSlug: "proj-a",
      workspacePath: "/tmp/proj-a",
      createdAt: "2026-05-07T01:00:00.000Z",
      updatedAt: "2026-05-07T02:00:00.000Z",
      source: "headless",
      status: "completed",
    });
    repo.upsert({
      recordId: "rec-b",
      localSessionId: "local-b",
      identityState: "transcript_only",
      workspaceSlug: "proj-b",
      workspacePath: "/tmp/proj-b",
      createdAt: "2026-05-07T03:00:00.000Z",
      updatedAt: "2026-05-07T04:00:00.000Z",
      source: "headless",
      status: "completed",
    });

    const signalA = "2026-05-07T02:00:00.000Z";
    const signalB = "2026-05-07T04:00:00.000Z";

    const activity: ActivityManager = {
      getSessionActivity: async (sessionId: string) => {
        if (sessionId === "local-a" || sessionId === "rec-a") {
          return {
            recordId: "activity:rec-a",
            localSessionId: "local-a",
            status: "completed",
            updatedAt: signalA,
            signals: [
              {
                source: "index",
                status: "completed",
                observedAt: signalA,
              },
            ],
            provenance: "derived",
          };
        }
        if (sessionId === "local-b" || sessionId === "rec-b") {
          return {
            recordId: "activity:rec-b",
            localSessionId: "local-b",
            status: "completed",
            updatedAt: signalB,
            signals: [
              {
                source: "index",
                status: "completed",
                observedAt: signalB,
              },
            ],
            provenance: "derived",
          };
        }
        return null;
      },
      listActivity: async () => [],
      recordSignal: async () => {},
    };

    const usagePath = join(testDir!, "usage-events.json");
    const usageStore = createUsageEventStore(usagePath);

    const bySession = await createUsageStatsManager({
      sessions: repo,
      activity,
      usageEvents: usageStore,
    }).stats({
      sessionId: "local-b",
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(bySession.totalSessions).toBe(1);
    expect(bySession.activityStatusCounts).toEqual({ completed: 1 });
    expect(bySession.recentDailyActivity[0]?.activitySignalCount).toBe(1);

    const byWorkspace = await createUsageStatsManager({
      sessions: repo,
      activity,
      usageEvents: usageStore,
    }).stats({
      workspacePath: "/tmp/proj-a",
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(byWorkspace.totalSessions).toBe(1);
    expect(byWorkspace.activityStatusCounts).toEqual({ completed: 1 });
    expect(byWorkspace.recentDailyActivity[0]?.activitySignalCount).toBe(1);

    repo.close();
  });

  test("reports missing optional activity source without false token totals", async () => {
    const repo = await createRepo();
    const usagePath = join(testDir!, "usage-events.json");
    const usageStore = createUsageEventStore(usagePath);
    const report = await createUsageStatsManager({
      sessions: repo,
      usageEvents: usageStore,
    }).stats({
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(report.totalSessions).toBe(0);
    expect(report.completenessNotes).toContain(
      "activity manager unavailable; activity counts omitted",
    );
    expect(report.usageTokens.totalTokens).toBe(0);
    repo.close();
  });

  test("counts sessions updated inside the recent window", async () => {
    const repo = await createRepo();
    repo.upsert({
      recordId: "rec-recent-update",
      localSessionId: "local-recent-update",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-05-07T02:00:00.000Z",
      source: "headless",
      status: "completed",
    });

    const usagePath = join(testDir!, "usage-events.json");
    const usageStore = createUsageEventStore(usagePath);

    const report = await createUsageStatsManager({
      sessions: repo,
      usageEvents: usageStore,
    }).stats({
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(report.firstSessionDate).toBe("2026-04-01");
    expect(report.recentDailyActivity).toEqual([
      {
        date: "2026-05-07",
        sessionCount: 1,
        activitySignalCount: 0,
      },
    ]);
    expect(report.usageRecentDailyActivity).toEqual([
      {
        date: "2026-05-07",
        tokensByModel: {},
      },
    ]);
    repo.close();
  });

  test("omitting usage store surfaces explicit completeness note", async () => {
    const repo = await createRepo();
    const report = await createUsageStatsManager({ sessions: repo }).stats({
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });
    expect(
      report.completenessNotes.some((n) => n.includes("usage event store")),
    ).toBe(true);
    expect(report.usageProvenance).toBe("unavailable");
    repo.close();
  });

  test("usage store listEvents failure is non-fatal and clears coverage", async () => {
    const repo = await createRepo();
    repo.upsert({
      recordId: "rec-fail",
      localSessionId: "local-fail",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-07T01:00:00.000Z",
      updatedAt: "2026-05-07T02:00:00.000Z",
      source: "headless",
      status: "completed",
    });

    const failingStore: UsageEventStore = {
      listEvents: async () => {
        throw new Error("simulated usage store read failure");
      },
      upsertEvent: async () => {},
      upsertEvents: async () => {},
    };

    const report = await createUsageStatsManager({
      sessions: repo,
      usageEvents: failingStore,
    }).stats({
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(report.totalSessions).toBe(1);
    expect(report.usageTokens.totalTokens).toBe(0);
    expect(report.usageSessionsObserved).toBe(0);
    expect(
      report.completenessNotes.some((n) =>
        n.includes("usage event store read failed"),
      ),
    ).toBe(true);
    expect(report.usageEvidenceCoverage).toEqual({
      sessionsWithUsageEvents: 0,
      knownSessionsWithoutUsageEvents: 0,
      wrapperStartedSessionsWithoutUsageEvents: 0,
    });
    expect(report.usageProvenance).toBe("repository_usage_events");
    repo.close();
  });
});
