import { readFile } from "node:fs/promises";

import type {
  DaemonMetadata,
  DaemonStopOptions,
  DaemonStopResult,
} from "../types/daemon";

export interface DaemonProcessInspector {
  isAlive(pid: number): Promise<boolean>;
  matchesOwner(metadata: DaemonMetadata): Promise<boolean>;
  terminate(
    metadata: DaemonMetadata,
    options?: DaemonStopOptions,
  ): Promise<DaemonStopResult>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function signalProcess(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }
    throw error;
  }
}

type SignalProcess = typeof signalProcess;

async function readProcField(
  pid: number,
  field: "cmdline" | "environ",
): Promise<string | undefined> {
  try {
    const raw = await readFile(`/proc/${pid}/${field}`);
    return raw.toString("utf8");
  } catch {
    return undefined;
  }
}

type ReadProcField = typeof readProcField;
type Sleep = typeof sleep;

export interface NodeProcessInspectorDeps {
  readonly signalProcess?: SignalProcess;
  readonly readProcField?: ReadProcField;
  readonly sleep?: Sleep;
}

export function createNodeProcessInspector(
  deps: NodeProcessInspectorDeps = {},
): DaemonProcessInspector {
  const signal = deps.signalProcess ?? signalProcess;
  const readProc = deps.readProcField ?? readProcField;
  const wait = deps.sleep ?? sleep;
  return {
    async isAlive(pid: number): Promise<boolean> {
      if (!Number.isInteger(pid) || pid <= 0) {
        return false;
      }
      return signal(pid, 0);
    },
    async matchesOwner(metadata: DaemonMetadata): Promise<boolean> {
      if (!(await this.isAlive(metadata.pid))) {
        return false;
      }
      const environ = await readProc(metadata.pid, "environ");
      return (
        environ !== undefined &&
        environ
          .split("\0")
          .includes(`CURORT_CLI_AGENT_DAEMON_MARKER=${metadata.marker}`)
      );
    },
    async terminate(
      metadata: DaemonMetadata,
      options: DaemonStopOptions = {},
    ): Promise<DaemonStopResult> {
      if (!(await this.matchesOwner(metadata))) {
        return {
          state: "stale",
          stopped: false,
          metadata,
          staleReason: "process owner marker did not match",
        };
      }
      if (!(await this.isAlive(metadata.pid))) {
        return { state: "stopped", stopped: true, metadata };
      }
      signal(metadata.pid, "SIGTERM");
      const deadline = Date.now() + (options.timeoutMs ?? 5000);
      while (Date.now() < deadline) {
        if (!(await this.isAlive(metadata.pid))) {
          return { state: "stopped", stopped: true, metadata };
        }
        await wait(25);
      }
      return {
        state: "failed",
        stopped: false,
        metadata,
        reason: "process did not exit before timeout",
      };
    },
  };
}
