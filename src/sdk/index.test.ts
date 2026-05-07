import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCursorAgentSdk } from "./index";

let testDir: string;

describe("public SDK facade", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-sdk-"));
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
});
