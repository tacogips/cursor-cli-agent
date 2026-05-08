import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createReplayForkStore } from "./session-replay-forks-store";

describe("session-replay-forks-store", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function setup(): { path: string } {
    const d = dir!;
    return { path: join(d, "forks.json") };
  }

  test("records and lists by source id", async () => {
    dir = await mkdtemp(join(tmpdir(), "rfork-"));
    const { path } = setup();
    const store = createReplayForkStore(path);
    const row = {
      replayForkId: "fork-1",
      sourceRecordId: "src-1",
      promptHash: "abc",
      createdAt: "2026-05-08T00:00:00.000Z",
      semantics: "replay_not_native_fork" as const,
    };
    await store.record(row);
    expect(await store.findByReplayForkId("fork-1")).toEqual(row);
    expect((await store.listForSource("src-1")).length).toBe(1);
  });

  test("corrupt JSON returns empty list and undefined for unknown id", async () => {
    dir = await mkdtemp(join(tmpdir(), "rfork-"));
    const { path } = setup();
    await writeFile(path, "not-valid-json", "utf8");
    const store = createReplayForkStore(path);
    expect((await store.listForSource("any")).length).toBe(0);
    expect(await store.findByReplayForkId("any")).toBeUndefined();
  });

  test("findByReplayForkId returns undefined for unknown id", async () => {
    dir = await mkdtemp(join(tmpdir(), "rfork-"));
    const { path } = setup();
    const store = createReplayForkStore(path);
    const row = {
      replayForkId: "fork-x",
      sourceRecordId: "src-x",
      promptHash: "def",
      createdAt: "2026-05-08T00:00:00.000Z",
      semantics: "replay_not_native_fork" as const,
    };
    await store.record(row);
    expect(await store.findByReplayForkId("fork-not-exist")).toBeUndefined();
  });

  test("listForSource returns empty list for unrelated source", async () => {
    dir = await mkdtemp(join(tmpdir(), "rfork-"));
    const { path } = setup();
    const store = createReplayForkStore(path);
    const row = {
      replayForkId: "fork-2",
      sourceRecordId: "src-a",
      promptHash: "ghi",
      createdAt: "2026-05-08T00:00:00.000Z",
      semantics: "replay_not_native_fork" as const,
    };
    await store.record(row);
    expect((await store.listForSource("src-unrelated")).length).toBe(0);
  });

  test("record upserts by replayForkId: no duplicate in listForSource and newer record wins", async () => {
    dir = await mkdtemp(join(tmpdir(), "rfork-"));
    const { path } = setup();
    const store = createReplayForkStore(path);
    const row1 = {
      replayForkId: "fork-upsert",
      sourceRecordId: "src-u",
      promptHash: "hash1",
      createdAt: "2026-05-01T00:00:00.000Z",
      semantics: "replay_not_native_fork" as const,
    };
    const row2 = {
      ...row1,
      promptHash: "hash2",
      createdAt: "2026-05-08T00:00:00.000Z",
    };
    await store.record(row1);
    await store.record(row2);
    const results = await store.listForSource("src-u");
    expect(results.length).toBe(1);
    expect(results[0]?.promptHash).toBe("hash2");
    expect(results[0]?.createdAt).toBe("2026-05-08T00:00:00.000Z");
  });
});
