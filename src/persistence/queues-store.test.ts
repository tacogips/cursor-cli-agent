import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  addQueueItem,
  createQueue,
  deleteQueue,
  getQueue,
  listQueues,
  moveQueueItem,
  pauseQueue,
  removeQueueItem,
  requestQueueStop,
  resumeQueue,
  updateQueueItem,
  updateQueueRun,
} from "./queues-store";

const previousDataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];

let testDir: string;

function queuesPath(): string {
  return join(testDir, "data", "queues.json");
}

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURORT_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
}

describe("queues store lifecycle persistence", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-queues-store-"));
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = join(testDir, "data");
    await mkdir(join(testDir, "data"), { recursive: true });
  });

  afterEach(async () => {
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("loads legacy queues as active pending auto records", async () => {
    await writeFile(
      queuesPath(),
      JSON.stringify({
        queues: [
          {
            name: "legacy",
            workspace: "/tmp/a",
            items: [
              {
                id: "item-1",
                prompt: "hello",
                createdAt: "2026-05-06T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const queue = await getQueue("legacy");

    expect(queue?.lifecycleState).toBe("active");
    expect(queue?.items[0]?.status).toBe("pending");
    expect(queue?.items[0]?.mode).toBe("auto");
  });

  test("persists pause, resume, delete, stop, item updates, moves, and runs", async () => {
    await createQueue("jobs", "/tmp/a");
    await addQueueItem("jobs", "first");
    await addQueueItem("jobs", "second");
    const itemId = (await getQueue("jobs"))?.items[0]?.id ?? "";
    expect(itemId.length).toBeGreaterThan(0);

    const paused = await pauseQueue("jobs");
    expect(paused?.lifecycleState).toBe("paused");

    const resumed = await resumeQueue("jobs");
    expect(resumed?.lifecycleState).toBe("active");

    const modeUpdated = await updateQueueItem("jobs", itemId, {
      mode: "manual",
      status: "skipped",
    });
    expect(modeUpdated?.items[0]?.mode).toBe("manual");
    expect(modeUpdated?.items[0]?.status).toBe("skipped");

    const moved = await moveQueueItem("jobs", 0, 1);
    expect(moved?.items[1]?.id).toBe(itemId);

    const currentItemId = itemId;
    const run = {
      id: "run-1",
      status: "running" as const,
      startedAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      currentItemId,
      completedItemIds: [],
      failedItemIds: [],
      pendingItemIds: [currentItemId],
    };
    const updatedRun = await updateQueueRun("jobs", { lastRun: run });
    expect(updatedRun?.lastRun?.status).toBe("running");

    const stopped = await requestQueueStop("jobs");
    expect(stopped?.lifecycleState).toBe("stopped");
    expect(stopped?.stopRequestedAt).toBeDefined();

    const deleted = await deleteQueue("jobs");
    expect(deleted?.name).toBe("jobs");
    expect(await listQueues()).toEqual([]);
  });

  test("preserves remove behavior with canonical fields", async () => {
    await createQueue("jobs", "/tmp/a");
    await addQueueItem("jobs", "first");
    const itemId = (await getQueue("jobs"))?.items[0]?.id ?? "";

    const removed = await removeQueueItem("jobs", itemId);

    expect(removed.items).toEqual([]);
    expect(removed.lifecycleState).toBe("active");
  });

  test("tolerates corrupt lifecycle, item, and run statuses without rewriting", async () => {
    await writeFile(
      queuesPath(),
      JSON.stringify({
        queues: [
          {
            name: "corrupt",
            workspace: "/tmp/a",
            lifecycleState: "archived",
            items: [{ id: "item-1", prompt: "x", status: "mystery" }],
            lastRun: {
              id: "run-corrupt",
              status: "not-a-status",
              startedAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
          },
        ],
      }),
      "utf8",
    );

    const queue = await getQueue("corrupt");

    expect(queue?.lifecycleState).toBe("active");
    expect(queue?.items[0]?.status).toBe("pending");
    expect(queue?.lastRun).toBeUndefined();
    const raw = await readFile(queuesPath(), "utf8");
    expect(raw).toContain("not-a-status");
  });
});
