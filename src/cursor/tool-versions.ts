import { spawn } from "node:child_process";

import pkg from "../../package.json" with { type: "json" };

import type {
  ToolCommandRunOptions,
  ToolCommandRunResult,
  ToolVersionCommandRunner,
  ToolVersionInfo,
  ToolVersionOptions,
  ToolVersionReport,
} from "../types/tool-versions";

const DEFAULT_VERSION_TIMEOUT_MS = 5000;

function normalizeTimeout(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_VERSION_TIMEOUT_MS;
}

function firstLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/)[0] ?? null;
}

function failureMessage(result: ToolCommandRunResult): string {
  if (result.timedOut) {
    return "version command timed out";
  }
  if (result.error !== undefined && result.error.length > 0) {
    return result.error;
  }
  const reason =
    result.signal !== null
      ? `signal ${result.signal}`
      : `exit code ${String(result.exitCode ?? "unknown")}`;
  const details = firstLine(result.stderr) ?? firstLine(result.stdout);
  return details === null
    ? `version command failed (${reason})`
    : `version command failed (${reason}): ${details}`;
}

function resolveSpawnEnv(
  provided: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  if (provided === undefined) {
    return { ...process.env };
  }
  const env: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(provided)) {
    if (v !== undefined) {
      env[k] = v;
    }
  }
  return env;
}

export async function defaultToolCommandRunner(
  command: string,
  args: readonly string[],
  options: ToolCommandRunOptions,
): Promise<ToolCommandRunResult> {
  return await new Promise<ToolCommandRunResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: resolveSpawnEnv(options.env),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: ToolCommandRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: unknown) => {
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (exitCode, signal) => {
      settle({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: true,
        error: `command timed out after ${options.timeoutMs}ms`,
      });
    }, options.timeoutMs);
  });
}

export async function readToolVersion(
  name: string,
  command: string,
  options: ToolVersionOptions = {},
): Promise<ToolVersionInfo> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const runner: ToolVersionCommandRunner =
    options.commandRunner ?? defaultToolCommandRunner;
  const result = await runner(command, ["--version"], { timeoutMs });
  if (result.exitCode === 0 && !result.timedOut && result.error === undefined) {
    const version = firstLine(result.stdout);
    if (version !== null) {
      return {
        name,
        command,
        version,
        status: "available",
        checkedAt,
      };
    }
    return {
      name,
      command,
      version: null,
      status: "unavailable",
      error: "version command succeeded but produced no output",
      checkedAt,
    };
  }
  return {
    name,
    command,
    version: null,
    status: "unavailable",
    error: failureMessage(result),
    checkedAt,
  };
}

export async function getToolVersions(
  options: ToolVersionOptions = {},
): Promise<ToolVersionReport> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const tools: ToolVersionInfo[] = [];
  tools.push(
    await readToolVersion(
      "cursor-agent",
      options.cursorAgentBinary ?? "cursor-agent",
      options,
    ),
  );
  if (options.includeGit === true) {
    tools.push(
      await readToolVersion("git", options.gitBinary ?? "git", options),
    );
  }
  if (options.includeBun === true) {
    tools.push(
      await readToolVersion("bun", options.bunBinary ?? "bun", options),
    );
  }
  return {
    packageVersion: pkg.version,
    tools,
    checkedAt,
  };
}
