import { describe, expect, test } from "bun:test";

import { createNodeProcessInspector } from "./process";
import type { DaemonMetadata } from "../types/daemon";

function metadata(overrides: Partial<DaemonMetadata> = {}): DaemonMetadata {
  return {
    schemaVersion: 1,
    state: "running",
    pid: 123,
    parentPid: 1,
    marker: "owned-marker",
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

describe("node daemon process inspector", () => {
  test("refuses cmdline-only matches and does not terminate foreign processes", async () => {
    const signaled: Array<NodeJS.Signals | 0> = [];
    const inspector = createNodeProcessInspector({
      signalProcess(_pid, signal) {
        signaled.push(signal);
        return true;
      },
      async readProcField(_pid, field) {
        if (field === "cmdline") {
          return "/bin/bun\0run\0src/bin.ts\0server\0start\0";
        }
        return "PATH=/usr/bin";
      },
    });

    const record = metadata();

    await expect(inspector.matchesOwner(record)).resolves.toBe(false);
    const result = await inspector.terminate(record);

    expect(result).toMatchObject({
      state: "stale",
      stopped: false,
      staleReason: "process owner marker did not match",
    });
    expect(signaled).toEqual([0, 0]);
  });

  test("requires the exact daemon marker in process environment", async () => {
    const inspector = createNodeProcessInspector({
      signalProcess() {
        return true;
      },
      async readProcField(_pid, field) {
        return field === "environ"
          ? "CURORT_CLI_AGENT_DAEMON_MARKER=owned-marker\0"
          : undefined;
      },
    });

    await expect(inspector.matchesOwner(metadata())).resolves.toBe(true);
  });
});
