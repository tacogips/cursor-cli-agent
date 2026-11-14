import { defaultToolCommandRunner, readToolVersion } from "./tool-versions";
import type {
  ModelAvailabilityOptions,
  ModelAvailabilityReport,
  ModelReachabilityInfo,
} from "../types/model-availability";
import type {
  ToolVersionCommandRunner,
  ToolVersionInfo,
} from "../types/tool-versions";

const DEFAULT_MODEL_PROBE_TIMEOUT_MS = 15000;
const MODEL_PROBE_PROMPT = "Reply with exactly OK.";

function normalizeTimeout(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_MODEL_PROBE_TIMEOUT_MS;
}

function firstLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/)[0] ?? null;
}

function summarizeProbeFailure(
  stdout: string,
  stderr: string,
  fallback: string | undefined,
): string {
  const line = firstLine(stderr) ?? firstLine(stdout);
  if (line !== null) {
    return line;
  }
  return fallback ?? "model probe failed";
}

function classifyFailure(message: string): string {
  if (
    /auth|login|credential|billing|quota|trust|workspace|not\s+enabled/i.test(
      message,
    )
  ) {
    return `probe failure: ${message}`;
  }
  return message;
}

async function runModelProbe(
  model: string,
  binary: string,
  runner: ToolVersionCommandRunner,
  options: ModelAvailabilityOptions,
): Promise<ModelReachabilityInfo> {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const result = await runner(
    binary,
    [
      "--print",
      "--output-format",
      "text",
      "--model",
      model,
      "--",
      MODEL_PROBE_PROMPT,
    ],
    {
      timeoutMs,
      ...(options.workspace !== undefined ? { cwd: options.workspace } : {}),
    },
  );
  if (result.exitCode === 0 && !result.timedOut && result.error === undefined) {
    const output = firstLine(result.stdout);
    return {
      status: "available",
      probed: true,
      ...(output !== null ? { output } : {}),
    };
  }
  const failure = summarizeProbeFailure(
    result.stdout,
    result.stderr,
    result.error,
  );
  return {
    status: "unavailable",
    probed: true,
    error: result.timedOut
      ? `probe timed out after ${timeoutMs}ms`
      : classifyFailure(failure),
  };
}

export async function checkModelAvailability(
  options: ModelAvailabilityOptions,
): Promise<ModelAvailabilityReport> {
  const model = options.model.trim();
  if (model.length === 0) {
    throw new Error("model is required");
  }
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const runner = options.commandRunner ?? defaultToolCommandRunner;
  const cursorAgentBinary = options.cursorAgentBinary ?? "cursor-agent";
  const binary: ToolVersionInfo = await readToolVersion(
    "cursor-agent",
    cursorAgentBinary,
    {
      now,
      commandRunner: runner,
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    },
  );
  const reachability =
    options.probe === true
      ? await runModelProbe(model, cursorAgentBinary, runner, options)
      : ({
          status: "not_checked",
          probed: false,
        } satisfies ModelReachabilityInfo);
  return {
    model,
    binary,
    auth: {
      status: "unknown",
      detail:
        "Cursor has no stable local auth-status API; auth was not inferred.",
      provenance: "not_available",
    },
    modelReachability: reachability,
    checkedAt,
  };
}
