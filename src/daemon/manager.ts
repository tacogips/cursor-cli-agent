import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  daemonLifecycleLogPath,
  getConfigDir,
  getDataDir,
} from "../config/paths";
import { createFileDaemonMetadataStore } from "../persistence/daemon-metadata-store";
import type {
  DaemonMetadataReadResult,
  DaemonMetadataStore,
} from "../persistence/daemon-metadata-store";
import { resolveHttpServerConfig } from "../server";
import type {
  DaemonMetadata,
  DaemonStartOptions,
  DaemonStartResult,
  DaemonStatusOptions,
  DaemonStatusResult,
  DaemonStopOptions,
  DaemonStopResult,
} from "../types/daemon";
import {
  createNodeProcessInspector,
  type DaemonProcessInspector,
} from "./process";
import {
  createHttpDaemonReadinessProbe,
  type DaemonReadinessProbe,
} from "./readiness";

export interface DaemonManager {
  start(options?: DaemonStartOptions): Promise<DaemonStartResult>;
  stop(options?: DaemonStopOptions): Promise<DaemonStopResult>;
  status(options?: DaemonStatusOptions): Promise<DaemonStatusResult>;
}

export interface DaemonManagerDeps {
  readonly store?: DaemonMetadataStore;
  readonly processInspector?: DaemonProcessInspector;
  readonly readinessProbe?: DaemonReadinessProbe;
  readonly spawnServer?: SpawnServer;
  readonly lifecycleLogPath?: string;
  readonly now?: () => Date;
}

export interface SpawnedDaemonServer {
  readonly pid: number;
  readonly commandPath: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  terminate(): Promise<void>;
}

export type SpawnServer = (
  options: SpawnServerOptions,
) => Promise<SpawnedDaemonServer>;

export interface SpawnServerOptions {
  readonly host: string;
  readonly port: number;
  readonly token?: string;
  readonly marker: string;
  readonly cliEntrypoint?: string;
}

export function buildCliServerArgs(options: SpawnServerOptions): string[] {
  const args = [
    "run",
    options.cliEntrypoint ?? resolveCliServerEntrypoint(),
    "server",
    "start",
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--json",
  ];
  if (options.token !== undefined) {
    args.push("--token", options.token);
  }
  return args;
}

function isBinEntrypoint(path: string): boolean {
  return /(?:^|[/\\])bin\.(?:ts|js)$/.test(path);
}

export function resolveCliServerEntrypoint(): string {
  const argvEntrypoint = process.argv[1];
  if (argvEntrypoint !== undefined && isBinEntrypoint(argvEntrypoint)) {
    return resolve(argvEntrypoint);
  }

  const sourceEntrypoint = fileURLToPath(new URL("../bin.ts", import.meta.url));
  if (existsSync(sourceEntrypoint)) {
    return sourceEntrypoint;
  }

  return fileURLToPath(new URL("../bin.js", import.meta.url));
}

interface ServerStdoutResult {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

function isServerStdoutResult(value: unknown): value is ServerStdoutResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["host"] === "string" &&
    typeof record["port"] === "number" &&
    typeof record["url"] === "string"
  );
}

async function waitForServerStdout(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): Promise<ServerStdoutResult> {
  return await new Promise<ServerStdoutResult>((resolveReady, rejectReady) => {
    let buffer = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectReady(new Error("server did not report readiness before timeout"));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isServerStdoutResult(parsed)) {
            cleanup();
            resolveReady(parsed);
            return;
          }
        } catch {
          continue;
        }
      }
    };
    const onStderr = (chunk: Buffer): void => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        stderr = `${stderr}${stderr.length > 0 ? "\n" : ""}${text}`;
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      rejectReady(
        new Error(
          `server exited before readiness: ${code ?? "signal"}${stderr.length > 0 ? `: ${stderr}` : ""}`,
        ),
      );
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

export async function spawnCliServer(
  options: SpawnServerOptions,
): Promise<SpawnedDaemonServer> {
  const args = buildCliServerArgs(options);
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      CURSOR_CLI_AGENT_DAEMON_MARKER: options.marker,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid === undefined) {
    throw new Error("failed to spawn daemon server process");
  }
  const pid = child.pid;
  const ready = await waitForServerStdout(child, 5000);
  child.unref();
  return {
    pid,
    commandPath: process.execPath,
    host: ready.host,
    port: ready.port,
    baseUrl: ready.url,
    async terminate(): Promise<void> {
      process.kill(pid, "SIGTERM");
    },
  };
}

function metadataWithCheck(
  metadata: DaemonMetadata,
  now: Date,
): DaemonMetadata {
  return {
    ...metadata,
    lastCheckedAt: now.toISOString(),
  };
}

async function appendLifecycleLog(
  path: string,
  event: {
    readonly event: string;
    readonly at: string;
    readonly state?: string;
    readonly pid?: number;
    readonly baseUrl?: string;
    readonly reason?: string;
  },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

export function createDaemonManager(
  deps: DaemonManagerDeps = {},
): DaemonManager {
  const store = deps.store ?? createFileDaemonMetadataStore();
  const processInspector =
    deps.processInspector ?? createNodeProcessInspector();
  const readinessProbe =
    deps.readinessProbe ?? createHttpDaemonReadinessProbe();
  const spawnServer = deps.spawnServer ?? spawnCliServer;
  const lifecycleLogPath = deps.lifecycleLogPath ?? daemonLifecycleLogPath();
  const now = deps.now ?? (() => new Date());

  async function statusFromRead(
    read: DaemonMetadataReadResult,
    options: DaemonStatusOptions = {},
  ): Promise<DaemonStatusResult> {
    if (read.status === "missing") {
      return { state: "stopped" };
    }
    if (read.status === "malformed") {
      return { state: "stale", staleReason: read.diagnostic };
    }
    const metadata = metadataWithCheck(read.metadata, now());
    if (!(await processInspector.isAlive(metadata.pid))) {
      return {
        state: "stale",
        metadata,
        staleReason: "process is not running",
      };
    }
    if (!(await processInspector.matchesOwner(metadata))) {
      return {
        state: "stale",
        metadata,
        staleReason: "process owner marker did not match",
      };
    }
    if (options.checkReadiness !== false && metadata.state === "running") {
      const token =
        metadata.auth.mode === "required"
          ? (options.token ?? process.env["CURSOR_CLI_AGENT_SERVER_TOKEN"])
          : undefined;
      const readiness = await readinessProbe.waitUntilReady({
        baseUrl: metadata.baseUrl,
        ...(token !== undefined ? { token } : {}),
        timeoutMs: 500,
        intervalMs: 50,
      });
      if (!readiness.ready) {
        return {
          state: "stale",
          metadata,
          staleReason: `health probe failed: ${readiness.reason}`,
        };
      }
    }
    return { state: metadata.state, metadata };
  }

  return {
    async status(
      options: DaemonStatusOptions = {},
    ): Promise<DaemonStatusResult> {
      return await statusFromRead(await store.read(), options);
    },
    async start(options: DaemonStartOptions = {}): Promise<DaemonStartResult> {
      const existing = await statusFromRead(await store.read());
      if (existing.state === "running" || existing.state === "starting") {
        return {
          state: "failed",
          ...(existing.metadata !== undefined
            ? { metadata: existing.metadata }
            : {}),
          staleReason: "daemon is already running",
        };
      }
      if (
        (existing.state === "failed" || existing.state === "stopping") &&
        existing.metadata !== undefined
      ) {
        const stopped = await processInspector.terminate(existing.metadata, {
          ...(options.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
        });
        if (stopped.state !== "stopped" || !stopped.stopped) {
          return {
            state: "failed",
            metadata: existing.metadata,
            staleReason:
              stopped.state === "stale" ? stopped.staleReason : stopped.reason,
          };
        }
        await store.remove();
      }
      if (existing.state === "stale") {
        if (existing.metadata !== undefined) {
          const alive = await processInspector.isAlive(existing.metadata.pid);
          const owned =
            alive && (await processInspector.matchesOwner(existing.metadata));
          if (alive && owned) {
            return {
              state: "failed",
              metadata: existing.metadata,
              staleReason: "owned process is stale but still running",
            };
          }
        }
        await store.remove();
      }
      const config = resolveHttpServerConfig({
        ...(options.host !== undefined ? { host: options.host } : {}),
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.token !== undefined ? { token: options.token } : {}),
      });
      const marker = `cursor-cli-agent-daemon-${randomUUID()}`;
      const spawned = await spawnServer({
        host: config.host,
        port: config.port,
        ...(config.token !== undefined ? { token: config.token } : {}),
        marker,
      });
      const startedAt = now().toISOString();
      const starting: DaemonMetadata = {
        schemaVersion: 1,
        state: "starting",
        pid: spawned.pid,
        parentPid: process.pid,
        marker,
        commandPath: spawned.commandPath,
        host: spawned.host,
        port: spawned.port,
        baseUrl: spawned.baseUrl,
        dataDir: getDataDir(),
        configDir: getConfigDir(),
        serverMode: "http",
        startedAt,
        auth: {
          mode: config.token === undefined ? "disabled" : "required",
          tokenConfigured: config.token !== undefined,
        },
      };
      await store.write(starting);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.starting",
        at: starting.startedAt,
        state: starting.state,
        pid: starting.pid,
        baseUrl: starting.baseUrl,
      });
      const readiness = await readinessProbe.waitUntilReady({
        baseUrl: spawned.baseUrl,
        ...(config.token !== undefined ? { token: config.token } : {}),
        timeoutMs: options.timeoutMs ?? 5000,
        intervalMs: options.intervalMs ?? 100,
      });
      if (!readiness.ready) {
        await spawned.terminate();
        const failedAt = now().toISOString();
        const failed: DaemonMetadata = {
          ...starting,
          state: "failed",
          lastCheckedAt: failedAt,
        };
        await store.write(failed);
        await appendLifecycleLog(lifecycleLogPath, {
          event: "daemon.failed",
          at: failedAt,
          state: failed.state,
          pid: failed.pid,
          baseUrl: failed.baseUrl,
          reason: readiness.reason,
        });
        return { state: "failed", metadata: failed, readiness };
      }
      const runningAt = now().toISOString();
      const running: DaemonMetadata = {
        ...starting,
        state: "running",
        lastCheckedAt: runningAt,
      };
      await store.write(running);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.running",
        at: runningAt,
        state: running.state,
        pid: running.pid,
        baseUrl: running.baseUrl,
      });
      return { state: "running", metadata: running, readiness };
    },
    async stop(options: DaemonStopOptions = {}): Promise<DaemonStopResult> {
      const read = await store.read();
      if (read.status === "missing") {
        return { state: "stopped", stopped: false, reason: "not_running" };
      }
      if (read.status === "malformed") {
        await store.remove();
        return {
          state: "stale",
          stopped: false,
          staleReason: read.diagnostic,
        };
      }
      const metadata = read.metadata;
      if (!(await processInspector.isAlive(metadata.pid))) {
        await store.remove();
        return { state: "stopped", stopped: true, metadata };
      }
      if (!(await processInspector.matchesOwner(metadata))) {
        return {
          state: "stale",
          stopped: false,
          metadata,
          staleReason: "process owner marker did not match",
        };
      }
      const stoppingAt = now().toISOString();
      const stopping: DaemonMetadata = {
        ...metadata,
        state: "stopping",
        lastCheckedAt: stoppingAt,
      };
      await store.write(stopping);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.stopping",
        at: stoppingAt,
        state: stopping.state,
        pid: stopping.pid,
        baseUrl: stopping.baseUrl,
      });
      const stopped = await processInspector.terminate(stopping, options);
      if (stopped.state === "stopped" && stopped.stopped) {
        await store.remove();
        await appendLifecycleLog(lifecycleLogPath, {
          event: "daemon.stopped",
          at: now().toISOString(),
          state: "stopped",
          pid: stopping.pid,
          baseUrl: stopping.baseUrl,
        });
      }
      return stopped;
    },
  };
}
