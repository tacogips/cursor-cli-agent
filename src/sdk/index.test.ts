import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCursorAgentSdk } from "./index";
import { SessionIndexRepository } from "../persistence/session-index";
import { createUsageEventStore } from "../persistence/usage-event-store";

let testDir: string;

describe("public SDK facade", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-sdk-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("creates an import-safe SDK with state-root scoped group and queue facades", async () => {
    const sdk = createCursorAgentSdk({
      stateRoot: testDir,
      cursorHome: join(testDir, "cursor"),
      now: () => new Date("2026-05-07T00:00:00.000Z"),
    });

    await sdk.groups.create("g1");
    await sdk.groups.addWorkspace("g1", "/tmp/workspace");
    await sdk.queues.create("q1", "/tmp/workspace");

    expect((await sdk.groups.get("g1"))?.workspaces).toEqual([
      "/tmp/workspace",
    ]);
    expect((await sdk.queues.get("q1"))?.workspace).toContain("/tmp/workspace");
    expect(await sdk.sessions.list({ limit: 10 })).toEqual([]);
  });

  test("root module import exposes runCli without executing CLI startup", async () => {
    const root = await import("../index");
    expect(typeof root.runCli).toBe("function");
    expect(typeof root.createCursorAgentSdk).toBe("function");
  });

  test("tools facade uses injected command runner and activity manager defaults", async () => {
    const sdk = createCursorAgentSdk({
      stateRoot: testDir,
      cursorHome: join(testDir, "cursor"),
      commandRunner: async (command) => ({
        exitCode: 0,
        signal: null,
        stdout: `${command} injected\n`,
        stderr: "",
        timedOut: false,
      }),
      activityManager: {
        getSessionActivity: async () => null,
        listActivity: async () => [
          {
            recordId: "activity:injected",
            status: "completed",
            updatedAt: "2026-05-07T00:00:00.000Z",
            signals: [
              {
                source: "index",
                status: "completed",
                observedAt: "2026-05-07T00:00:00.000Z",
              },
            ],
            provenance: "derived",
          },
        ],
        recordSignal: async () => {},
      },
    });

    await expect(sdk.tools.versions()).resolves.toMatchObject({
      tools: [
        {
          name: "cursor-agent",
          version: "cursor-agent injected",
          status: "available",
        },
      ],
    });
    await expect(
      sdk.tools.checkModel({ model: "test-model", probe: true }),
    ).resolves.toMatchObject({
      modelReachability: {
        status: "available",
        probed: true,
        output: "cursor-agent injected",
      },
    });
    await expect(sdk.tools.usageStats()).resolves.toMatchObject({
      activityStatusCounts: {},
    });
  });

  test("tools facade uses injected session repository from public SDK options", async () => {
    const sessionRepository = new SessionIndexRepository(
      join(testDir, "injected-state.db"),
      { cursorProjectsRoot: join(testDir, "cursor", "projects") },
    );
    sessionRepository.upsert({
      recordId: "sdk-injected-session",
      localSessionId: "sdk-local",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T01:00:00.000Z",
      source: "headless",
      status: "completed",
      model: "sdk-model",
    });
    try {
      const sdk = createCursorAgentSdk({
        stateRoot: testDir,
        cursorHome: join(testDir, "cursor"),
        sessionRepository,
        now: () => new Date("2026-05-07T00:00:00.000Z"),
      });

      await expect(sdk.tools.usageStats()).resolves.toMatchObject({
        totalSessions: 1,
        models: {
          "sdk-model": 1,
        },
      });
    } finally {
      sessionRepository.close();
    }
  });

  test("tools facade uses injected clock for usage stats defaults", async () => {
    const sdk = createCursorAgentSdk({
      stateRoot: testDir,
      cursorHome: join(testDir, "cursor"),
      now: () => new Date("2000-01-02T00:00:00.000Z"),
    });

    await expect(
      sdk.tools.usageStats({ recentDays: 1 }),
    ).resolves.toMatchObject({
      lastComputedDate: "2000-01-02",
      recentDailyActivity: [
        {
          date: "2000-01-02",
        },
      ],
    });
  });

  test("tools facade uses injected usage event store for token totals", async () => {
    const sessionRepository = new SessionIndexRepository(
      join(testDir, "injected-state.db"),
      { cursorProjectsRoot: join(testDir, "cursor", "projects") },
    );
    sessionRepository.upsert({
      recordId: "rec-u",
      localSessionId: "local-u",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-06T01:00:00.000Z",
      updatedAt: "2026-05-06T02:00:00.000Z",
      source: "headless",
      status: "completed",
      model: "gpt-test",
    });
    const usageEventStore = createUsageEventStore(
      join(testDir, "usage-events-test.json"),
    );
    await usageEventStore.upsertEvent({
      eventId: "ev-1",
      sessionId: "local-u",
      recordId: "rec-u",
      model: "gpt-test",
      observedAt: "2026-05-06T02:30:00.000Z",
      source: "stream_result",
      provenance: "repository_usage_events",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    });
    try {
      const sdk = createCursorAgentSdk({
        stateRoot: testDir,
        cursorHome: join(testDir, "cursor"),
        sessionRepository,
        usageEventStore,
        now: () => new Date("2026-05-06T12:00:00.000Z"),
      });

      await expect(
        sdk.tools.usageStats({ recentDays: 1 }),
      ).resolves.toMatchObject({
        usageTokens: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
        usageSessionsObserved: 1,
        usageProvenance: "repository_usage_events",
        usageEvidenceCoverage: {
          sessionsWithUsageEvents: 1,
          knownSessionsWithoutUsageEvents: 0,
          wrapperStartedSessionsWithoutUsageEvents: 0,
        },
      });
    } finally {
      sessionRepository.close();
    }
  });
});
