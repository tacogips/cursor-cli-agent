import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createFileDaemonMetadataStore } from "./daemon-metadata-store";
import type { DaemonMetadata } from "../types/daemon";

let testDir: string;
let metadataPath: string;

function metadata(overrides: Partial<DaemonMetadata> = {}): DaemonMetadata {
  return {
    schemaVersion: 1,
    state: "running",
    pid: 123,
    parentPid: 1,
    marker: "marker",
    commandPath: "/bin/bun",
    host: "127.0.0.1",
    port: 4321,
    baseUrl: "http://127.0.0.1:4321",
    dataDir: join(testDir, "data"),
    configDir: join(testDir, "config"),
    serverMode: "http",
    startedAt: "2026-05-07T00:00:00.000Z",
    auth: { mode: "disabled", tokenConfigured: false },
    ...overrides,
  };
}

describe("daemon metadata store", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-daemon-store-"));
    metadataPath = join(testDir, "config", "daemon.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("reads missing metadata as missing", async () => {
    const store = createFileDaemonMetadataStore({ path: metadataPath });
    await expect(store.read()).resolves.toEqual({ status: "missing" });
  });

  test("writes and reads valid metadata atomically", async () => {
    const store = createFileDaemonMetadataStore({ path: metadataPath });
    const value = metadata({ state: "starting", port: 0 });
    await store.write(value);

    await expect(store.read()).resolves.toEqual({
      status: "valid",
      metadata: value,
    });
  });

  test("reports malformed metadata without throwing", async () => {
    await mkdir(join(testDir, "config"), { recursive: true });
    await writeFile(metadataPath, "{not-json", "utf8");
    const store = createFileDaemonMetadataStore({ path: metadataPath });

    const read = await store.read();
    expect(read.status).toBe("malformed");
  });

  test("removes metadata", async () => {
    const store = createFileDaemonMetadataStore({ path: metadataPath });
    await store.write(metadata());
    await store.remove();

    await expect(store.read()).resolves.toEqual({ status: "missing" });
  });
});
