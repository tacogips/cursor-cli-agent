import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { SessionIndexRepository } from "../persistence/session-index";
import type { ActivityManager } from "../activity/manager";
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

    const activity: ActivityManager = {
      getSessionActivity: async () => null,
      listActivity: async () => [
        {
          recordId: "activity:rec-1",
          localSessionId: "local-1",
          status: "completed",
          updatedAt: "2026-05-06T02:00:00.000Z",
          signals: [
            {
              source: "index",
              status: "completed",
              observedAt: "2026-05-06T02:00:00.000Z",
            },
          ],
          provenance: "derived",
        },
      ],
      recordSignal: async () => {},
    };

    const report = await createUsageStatsManager({
      sessions: repo,
      activity,
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
    expect(report.completenessNotes).toContain(
      "token totals are unknown because no repository-owned usage event store exists",
    );
    repo.close();
  });

  test("reports missing optional activity source without false token totals", async () => {
    const repo = await createRepo();
    const report = await createUsageStatsManager({ sessions: repo }).stats({
      recentDays: 1,
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(report.totalSessions).toBe(0);
    expect(report.completenessNotes).toContain(
      "activity manager unavailable; activity counts omitted",
    );
    expect(report.completenessNotes).toContain(
      "token totals are unknown because no repository-owned usage event store exists",
    );
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

    const report = await createUsageStatsManager({ sessions: repo }).stats({
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
    repo.close();
  });
});
