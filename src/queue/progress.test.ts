import { describe, expect, test } from "bun:test";

import { deriveQueueProgressSnapshot } from "./progress";
import type { SessionActivity } from "../types/activity";
import type { QueueRecord } from "../types/queue";

function activity(status: SessionActivity["status"]): SessionActivity {
  return {
    recordId: `activity-${status}`,
    status,
    updatedAt: `2026-05-06T00:0${status.length % 10}:00.000Z`,
    signals: [
      {
        source: "index",
        status,
        observedAt: `2026-05-06T00:0${status.length % 10}:00.000Z`,
      },
    ],
    provenance: "derived",
  };
}

function queueWithRun(): QueueRecord {
  return {
    name: "jobs",
    workspace: "/tmp/jobs",
    lifecycleState: "active",
    lastRun: {
      id: "run-1",
      status: "running",
      startedAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      currentItemId: "running",
      completedItemIds: [],
      failedItemIds: [],
      pendingItemIds: ["running", "waiting", "done", "manual"],
    },
    items: [
      {
        id: "running",
        prompt: "run",
        status: "pending",
        mode: "auto",
        createdAt: "2026-05-06T00:00:00.000Z",
        localSessionId: "running",
      },
      {
        id: "waiting",
        prompt: "wait",
        status: "running",
        mode: "auto",
        createdAt: "2026-05-06T00:00:00.000Z",
        cursorChatId: "waiting",
      },
      {
        id: "done",
        prompt: "done",
        status: "running",
        mode: "auto",
        createdAt: "2026-05-06T00:00:00.000Z",
        localSessionId: "done",
      },
      {
        id: "manual",
        prompt: "manual",
        status: "pending",
        mode: "manual",
        createdAt: "2026-05-06T00:00:00.000Z",
      },
      {
        id: "skipped",
        prompt: "skip",
        status: "skipped",
        mode: "auto",
        createdAt: "2026-05-06T00:00:00.000Z",
      },
    ],
  };
}

describe("queue progress derivation", () => {
  test("returns stable no-run snapshots", async () => {
    const snapshot = await deriveQueueProgressSnapshot(
      {
        name: "empty",
        workspace: "/tmp/empty",
        lifecycleState: "active",
        items: [],
      },
      {
        getActivity: async () => null,
        now: () => "2026-05-06T00:00:00.000Z",
      },
    );

    expect(snapshot.provenance).toBe("queue-store+activity");
    expect(snapshot.run).toBeUndefined();
    expect(snapshot.totals).toEqual({
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      manual: 0,
    });
  });

  test("maps activity statuses and manual totals", async () => {
    const snapshot = await deriveQueueProgressSnapshot(queueWithRun(), {
      getActivity: async (sessionId) => {
        if (sessionId === "running") {
          return activity("running");
        }
        if (sessionId === "waiting") {
          return activity("waiting_trust");
        }
        if (sessionId === "done") {
          return activity("completed");
        }
        return null;
      },
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals).toEqual({
      pending: 1,
      running: 2,
      completed: 1,
      failed: 0,
      skipped: 1,
      manual: 1,
    });
  });

  test("preserves persisted status when activity is missing", async () => {
    const snapshot = await deriveQueueProgressSnapshot(queueWithRun(), {
      getActivity: async () => null,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals.pending).toBe(2);
    expect(snapshot.totals.running).toBe(2);
  });

  test("maps failed activity", async () => {
    const snapshot = await deriveQueueProgressSnapshot(queueWithRun(), {
      getActivity: async () => activity("failed"),
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals.failed).toBe(3);
    expect(snapshot.totals.manual).toBe(1);
  });
});
