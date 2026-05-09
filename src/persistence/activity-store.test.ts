import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createActivityStore } from "./activity-store";

let testDir: string;

describe("activity signal store", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-activity-store-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("appends, reads, and prunes derived signals by session id", async () => {
    const store = createActivityStore(join(testDir, "activity.json"));

    await store.appendSignal("session-1", {
      source: "stream",
      status: "running",
      observedAt: "2026-05-05T00:00:00.000Z",
      detail: "started",
    });
    await store.appendSignal("session-1", {
      source: "process",
      status: "completed",
      observedAt: "2026-05-05T00:01:00.000Z",
    });

    const signals = await store.getSignals("session-1");
    expect(signals.map((signal) => signal.status)).toEqual([
      "running",
      "completed",
    ]);

    const pruned = await store.pruneSignals("2026-05-05T00:00:30.000Z");
    expect(pruned).toBe(1);
    expect(
      (await store.getSignals("session-1")).map((signal) => signal.status),
    ).toEqual(["completed"]);
  });

  test("treats missing and corrupt cache files as empty", async () => {
    const path = join(testDir, "corrupt.json");
    const store = createActivityStore(path);
    expect(await store.getSignals("missing")).toEqual([]);

    await writeFile(path, "{not json", "utf8");
    expect(await store.getSignals("missing")).toEqual([]);
  });
});
