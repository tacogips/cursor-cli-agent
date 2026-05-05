import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createActivityManager } from "./manager";
import {
  createActivityStore,
  type ActivityStore,
} from "../persistence/activity-store";
import { SessionIndexRepository } from "../persistence/session-index";

let testDir: string;
let repo: SessionIndexRepository;

describe("activity manager", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-activity-manager-"));
    repo = new SessionIndexRepository(join(testDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    await rm(testDir, { recursive: true, force: true });
  });

  test("derives completed activity with index and transcript provenance", async () => {
    const transcriptPath = join(testDir, "session.jsonl");
    await writeFile(transcriptPath, "{}\n", "utf8");
    repo.upsert({
      recordId: "rec-completed",
      localSessionId: "local-completed",
      cursorChatId: "chat-completed",
      identityState: "linked",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      transcriptPath,
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:10:00.000Z",
      source: "headless",
      status: "completed",
    });

    const manager = createActivityManager({
      sessions: repo,
      store: createActivityStore(join(testDir, "signals.json")),
    });

    const activity = await manager.getSessionActivity("chat-completed");
    expect(activity?.recordId).toBe("activity:rec-completed");
    expect(activity?.status).toBe("completed");
    expect(activity?.provenance).toBe("derived");
    expect(activity?.signals.map((signal) => signal.source)).toContain("index");
    expect(activity?.signals.map((signal) => signal.source)).toContain(
      "transcript",
    );
  });

  test("prefers waiting and failed signals over index fallback with tie breaker", async () => {
    repo.upsert({
      recordId: "rec-failed",
      localSessionId: "local-failed",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
      source: "headless",
      status: "unknown",
    });
    const store = createActivityStore(join(testDir, "signals.json"));
    await store.appendSignal("local-failed", {
      source: "stream",
      status: "waiting_input",
      observedAt: "2026-05-05T00:01:00.000Z",
    });
    await store.appendSignal("local-failed", {
      source: "stream",
      status: "failed",
      observedAt: "2026-05-05T00:01:00.000Z",
    });

    const activity = await createActivityManager({
      sessions: repo,
      store,
    }).getSessionActivity("local-failed");

    expect(activity?.status).toBe("failed");
    expect(activity?.updatedAt).toBe("2026-05-05T00:01:00.000Z");
  });

  test("later completed signal overrides stale running signal", async () => {
    repo.upsert({
      recordId: "rec-completed-after-running",
      localSessionId: "local-completed-after-running",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
      source: "headless",
      status: "unknown",
    });
    const store = createActivityStore(join(testDir, "signals.json"));
    await store.appendSignal("local-completed-after-running", {
      source: "stream",
      status: "running",
      observedAt: "2026-05-05T00:01:00.000Z",
    });
    await store.appendSignal("local-completed-after-running", {
      source: "process",
      status: "completed",
      observedAt: "2026-05-05T00:03:00.000Z",
    });

    const activity = await createActivityManager({
      sessions: repo,
      store,
    }).getSessionActivity("local-completed-after-running");

    expect(activity?.status).toBe("completed");
    expect(activity?.updatedAt).toBe("2026-05-05T00:03:00.000Z");
  });

  test("later failed signal overrides stale running signal", async () => {
    repo.upsert({
      recordId: "rec-failed-after-running",
      localSessionId: "local-failed-after-running",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
      source: "headless",
      status: "unknown",
    });
    const store = createActivityStore(join(testDir, "signals.json"));
    await store.appendSignal("local-failed-after-running", {
      source: "process",
      status: "running",
      observedAt: "2026-05-05T00:01:00.000Z",
    });
    await store.appendSignal("local-failed-after-running", {
      source: "process",
      status: "failed",
      observedAt: "2026-05-05T00:03:00.000Z",
    });

    const activity = await createActivityManager({
      sessions: repo,
      store,
    }).getSessionActivity("local-failed-after-running");

    expect(activity?.status).toBe("failed");
    expect(activity?.updatedAt).toBe("2026-05-05T00:03:00.000Z");
  });

  test("later index terminal status overrides stale cached dynamic signal", async () => {
    repo.upsert({
      recordId: "rec-index-after-stale-dynamic",
      localSessionId: "local-index-after-stale-dynamic",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:10:00.000Z",
      source: "headless",
      status: "completed",
    });
    const store = createActivityStore(join(testDir, "signals.json"));
    await store.appendSignal("local-index-after-stale-dynamic", {
      source: "process",
      status: "running",
      observedAt: "2026-05-05T00:01:00.000Z",
    });

    const activity = await createActivityManager({
      sessions: repo,
      store,
    }).getSessionActivity("local-index-after-stale-dynamic");

    expect(activity?.status).toBe("completed");
    expect(activity?.updatedAt).toBe("2026-05-05T00:10:00.000Z");
  });

  test("lists, filters, limits, and returns null for unknown sessions", async () => {
    repo.upsert({
      recordId: "rec-idle",
      cursorChatId: "chat-idle",
      identityState: "chat_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
      source: "create-chat",
      status: "pending",
    });
    repo.upsert({
      recordId: "rec-running",
      localSessionId: "local-running",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
      source: "headless",
      status: "active",
    });

    const manager = createActivityManager({
      sessions: repo,
      store: createActivityStore(join(testDir, "signals.json")),
    });

    expect(await manager.getSessionActivity("missing")).toBeNull();
    const running = await manager.listActivity({
      status: "running",
      limit: 1,
    });
    expect(running).toHaveLength(1);
    expect(running[0]?.localSessionId).toBe("local-running");
  });

  test("treats signal cache read and write failures as best-effort", async () => {
    repo.upsert({
      recordId: "rec-cache-failure",
      localSessionId: "local-cache-failure",
      identityState: "transcript_only",
      workspaceSlug: "tmp-activity",
      workspacePath: resolve("/tmp/activity"),
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
      source: "headless",
      status: "completed",
    });
    const failingStore: ActivityStore = {
      async getSignals(): Promise<readonly []> {
        throw new Error("cache read failed");
      },
      async appendSignal(): Promise<void> {
        throw new Error("cache write failed");
      },
      async pruneSignals(): Promise<number> {
        throw new Error("cache prune failed");
      },
    };
    const manager = createActivityManager({
      sessions: repo,
      store: failingStore,
    });

    await expect(
      manager.recordSignal("local-cache-failure", {
        source: "process",
        status: "running",
        observedAt: "2026-05-05T00:02:00.000Z",
      }),
    ).resolves.toBeUndefined();
    const activity = await manager.getSessionActivity("local-cache-failure");

    expect(activity?.status).toBe("completed");
    expect(activity?.signals.map((signal) => signal.source)).toEqual(["index"]);
  });
});
