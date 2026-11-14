import { describe, expect, test } from "bun:test";

import { deriveGroupProgressSnapshot } from "./progress";
import type { SessionActivity } from "../types/activity";
import type { GroupRecord } from "../types/group";

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

function groupWithRun(): GroupRecord {
  return {
    name: "team",
    workspaces: ["/tmp/running", "/tmp/waiting", "/tmp/done", "/tmp/idle"],
    lifecycleState: "active",
    lastRun: {
      id: "run-1",
      status: "running",
      startedAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      workspaces: [
        {
          workspace: "/tmp/running",
          localSessionId: "running",
          status: "pending",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        {
          workspace: "/tmp/waiting",
          cursorChatId: "waiting",
          status: "running",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        {
          workspace: "/tmp/done",
          localSessionId: "done",
          status: "running",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        {
          workspace: "/tmp/idle",
          localSessionId: "idle",
          status: "pending",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
      ],
    },
  };
}

describe("group progress derivation", () => {
  test("returns stable no-run snapshots", async () => {
    const snapshot = await deriveGroupProgressSnapshot(
      { name: "empty", workspaces: [], lifecycleState: "active" },
      {
        getActivity: async () => null,
        now: () => "2026-05-06T00:00:00.000Z",
      },
    );

    expect(snapshot.provenance).toBe("group-store+activity");
    expect(snapshot.run).toBeUndefined();
    expect(snapshot.totals).toEqual({
      pending: 0,
      running: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    });
  });

  test("maps activity statuses and idle fallback into totals", async () => {
    const snapshot = await deriveGroupProgressSnapshot(groupWithRun(), {
      getActivity: async (sessionId) => {
        if (sessionId === "running") {
          return activity("running");
        }
        if (sessionId === "waiting") {
          return activity("waiting_input");
        }
        if (sessionId === "done") {
          return activity("completed");
        }
        if (sessionId === "idle") {
          return activity("idle");
        }
        return null;
      },
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals).toEqual({
      pending: 0,
      running: 1,
      waiting: 1,
      completed: 1,
      failed: 0,
      unknown: 1,
    });
    expect(
      snapshot.run?.workspaces.map((workspace) => workspace.status),
    ).toEqual(["running", "waiting", "completed", "unknown"]);
  });

  test("preserves persisted status when activity is missing", async () => {
    const snapshot = await deriveGroupProgressSnapshot(groupWithRun(), {
      getActivity: async () => null,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals.pending).toBe(2);
    expect(snapshot.totals.running).toBe(2);
  });

  test("maps failed activity", async () => {
    const group = groupWithRun();
    const snapshot = await deriveGroupProgressSnapshot(group, {
      getActivity: async () => activity("failed"),
      now: () => "2026-05-06T00:00:00.000Z",
    });

    expect(snapshot.totals.failed).toBe(4);
  });
});
