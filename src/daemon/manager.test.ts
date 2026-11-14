import { describe, expect, test } from "bun:test";

import { isAbsolute } from "node:path";

import {
  buildCliServerArgs,
  createDaemonManager,
  resolveCliServerEntrypoint,
} from "./manager";
import type { DaemonProcessInspector } from "./process";
import type { DaemonReadinessProbe } from "./readiness";
import type {
  DaemonMetadataReadResult,
  DaemonMetadataStore,
} from "../persistence/daemon-metadata-store";
import type { DaemonMetadata } from "../types/daemon";

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
    dataDir: "/tmp/data",
    configDir: "/tmp/config",
    serverMode: "http",
    startedAt: "2026-05-07T00:00:00.000Z",
    auth: { mode: "disabled", tokenConfigured: false },
    ...overrides,
  };
}

function createMemoryStore(
  initial: DaemonMetadataReadResult = { status: "missing" },
): DaemonMetadataStore & { readonly writes: DaemonMetadata[] } {
  let current = initial;
  const writes: DaemonMetadata[] = [];
  return {
    writes,
    async read() {
      return current;
    },
    async write(value) {
      writes.push(value);
      current = { status: "valid", metadata: value };
    },
    async remove() {
      current = { status: "missing" };
    },
  };
}

function createProcessInspector(options: {
  readonly alive?: boolean;
  readonly owned?: boolean;
  readonly terminateState?: "stopped" | "failed";
}): DaemonProcessInspector {
  return {
    async isAlive() {
      return options.alive ?? true;
    },
    async matchesOwner() {
      return options.owned ?? true;
    },
    async terminate(value) {
      if (options.terminateState === "failed") {
        return {
          state: "failed",
          stopped: false,
          metadata: value,
          reason: "timeout",
        };
      }
      return { state: "stopped", stopped: true, metadata: value };
    },
  };
}

function createReadinessProbe(ready: boolean): DaemonReadinessProbe {
  return {
    async waitUntilReady() {
      return ready
        ? { ready: true, statusCode: 200 }
        : { ready: false, reason: "timeout" };
    },
  };
}

describe("daemon manager", () => {
  test("spawns the daemon server through the executable source entrypoint", () => {
    expect(
      buildCliServerArgs({
        host: "127.0.0.1",
        port: 0,
        token: "secret",
        marker: "marker",
        cliEntrypoint: "/repo/src/bin.ts",
      }),
    ).toEqual([
      "run",
      "/repo/src/bin.ts",
      "server",
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--json",
      "--token",
      "secret",
    ]);
  });

  test("resolves an absolute source entrypoint for non-repository daemon cwd", () => {
    const entrypoint = resolveCliServerEntrypoint();

    expect(isAbsolute(entrypoint)).toBe(true);
    expect(entrypoint.endsWith("/src/bin.ts")).toBe(true);
  });

  test("starts server, writes starting metadata, then promotes to running", async () => {
    const store = createMemoryStore();
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({}),
      readinessProbe: createReadinessProbe(true),
      now: () => new Date("2026-05-07T00:00:00.000Z"),
      async spawnServer(options) {
        expect(options.port).toBe(0);
        return {
          pid: 999,
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 5544,
          baseUrl: "http://127.0.0.1:5544",
          async terminate() {},
        };
      },
    });

    const result = await manager.start({ port: 0 });

    expect(result.state).toBe("running");
    expect(result.metadata?.port).toBe(5544);
    expect(store.writes.map((write) => write.state)).toEqual([
      "starting",
      "running",
    ]);
  });

  test("removes missing-pid stale metadata before start", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({ pid: 321 }),
    });
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({ alive: false }),
      readinessProbe: createReadinessProbe(true),
      async spawnServer() {
        return {
          pid: 999,
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 4000,
          baseUrl: "http://127.0.0.1:4000",
          async terminate() {},
        };
      },
    });

    const result = await manager.start();

    expect(result.state).toBe("running");
    expect(result.metadata?.pid).toBe(999);
  });

  test("fails readiness and terminates spawned process", async () => {
    const store = createMemoryStore();
    let terminated = false;
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({}),
      readinessProbe: createReadinessProbe(false),
      async spawnServer() {
        return {
          pid: 999,
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 4000,
          baseUrl: "http://127.0.0.1:4000",
          async terminate() {
            terminated = true;
          },
        };
      },
    });

    const result = await manager.start();

    expect(result.state).toBe("failed");
    expect(terminated).toBe(true);
    expect(store.writes.at(-1)?.state).toBe("failed");
  });

  test("reports auth-enabled running metadata as stale when token health fails", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({
        auth: { mode: "required", tokenConfigured: true },
      }),
    });
    let observedToken: string | undefined;
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({}),
      readinessProbe: {
        async waitUntilReady(options) {
          observedToken = options.token;
          return { ready: false, reason: "unauthorized", statusCode: 401 };
        },
      },
    });

    const result = await manager.status({ token: "runtime-token" });

    expect(observedToken).toBe("runtime-token");
    expect(result).toMatchObject({
      state: "stale",
      staleReason: "health probe failed: unauthorized",
    });
  });

  test("terminates alive failed metadata before retrying start", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({ state: "failed", pid: 777 }),
    });
    let terminateCount = 0;
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: {
        async isAlive() {
          return true;
        },
        async matchesOwner() {
          return true;
        },
        async terminate(value) {
          terminateCount += 1;
          return { state: "stopped", stopped: true, metadata: value };
        },
      },
      readinessProbe: createReadinessProbe(true),
      async spawnServer() {
        return {
          pid: 999,
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 4000,
          baseUrl: "http://127.0.0.1:4000",
          async terminate() {},
        };
      },
    });

    const result = await manager.start();

    expect(result.state).toBe("running");
    expect(result.metadata?.pid).toBe(999);
    expect(terminateCount).toBe(1);
  });

  test("refuses alive stopping metadata when termination times out", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({ state: "stopping", pid: 778 }),
    });
    let spawnCount = 0;
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({ terminateState: "failed" }),
      readinessProbe: createReadinessProbe(true),
      async spawnServer() {
        spawnCount += 1;
        return {
          pid: 999,
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 4000,
          baseUrl: "http://127.0.0.1:4000",
          async terminate() {},
        };
      },
    });

    const result = await manager.start();

    expect(result).toMatchObject({
      state: "failed",
      staleReason: "timeout",
    });
    expect(spawnCount).toBe(0);
  });

  test("stops only owned running processes and removes metadata", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({ pid: 888 }),
    });
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({ owned: true }),
    });

    const result = await manager.stop();

    expect(result).toMatchObject({ state: "stopped", stopped: true });
    await expect(store.read()).resolves.toEqual({ status: "missing" });
  });

  test("refuses to stop foreign PID owner", async () => {
    const store = createMemoryStore({
      status: "valid",
      metadata: metadata({ pid: 888 }),
    });
    const manager = createDaemonManager({
      store,
      lifecycleLogPath: "/tmp/cursor-daemon-manager-test.log",
      processInspector: createProcessInspector({ owned: false }),
    });

    const result = await manager.stop();

    expect(result).toMatchObject({
      state: "stale",
      stopped: false,
      staleReason: "process owner marker did not match",
    });
  });
});
