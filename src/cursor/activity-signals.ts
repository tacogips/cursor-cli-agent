import type { AgentEvent } from "../types/agent-event";
import type { ActivitySignal } from "../types/activity";

export interface ActivitySignalClassifier {
  classifyStreamEvent(event: AgentEvent): ActivitySignal | null;
  classifyProcessResult(
    exitCode: number | null,
    stderr?: string,
    stdout?: string,
  ): ActivitySignal | null;
}

const TRUST_PATTERNS = [
  /workspace trust required/i,
  /workspace trust/i,
  /trust.*required/i,
  /approval required/i,
  /requires approval/i,
  /approve.*workspace/i,
];

const INPUT_PATTERNS = [
  /waiting for (user )?input/i,
  /interactive prompt/i,
  /please respond/i,
  /requires (user )?input/i,
  /clarification required/i,
];

function nowIso(): string {
  return new Date().toISOString();
}

function matchPattern(
  text: string,
  patterns: readonly RegExp[],
): string | undefined {
  return patterns.find((pattern) => pattern.test(text))?.source;
}

export function classifyTextSignal(
  text: string,
  source: "stderr" | "stdout",
): ActivitySignal | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const trust = matchPattern(trimmed, TRUST_PATTERNS);
  if (trust !== undefined) {
    return {
      source,
      status: "waiting_trust",
      observedAt: nowIso(),
      detail: `matched ${trust}`,
    };
  }
  const input = matchPattern(trimmed, INPUT_PATTERNS);
  if (input !== undefined) {
    return {
      source,
      status: "waiting_input",
      observedAt: nowIso(),
      detail: `matched ${input}`,
    };
  }
  return null;
}

export function createActivitySignalClassifier(): ActivitySignalClassifier {
  return {
    classifyStreamEvent(event: AgentEvent): ActivitySignal | null {
      const observedAt = nowIso();
      switch (event.type) {
        case "session.started":
          return {
            source: "stream",
            status: "running",
            observedAt,
            detail: `started in ${event.cwd}`,
          };
        case "session.thinking":
        case "session.assistant_message":
        case "session.user_message":
          return {
            source: "stream",
            status: "running",
            observedAt,
            detail: event.type,
          };
        case "session.completed":
          return {
            source: "stream",
            status: "completed",
            observedAt,
            detail: "stream completed",
          };
        case "session.error":
          return {
            source: "stream",
            status: "failed",
            observedAt,
            detail: event.message,
          };
        case "session.pending":
        case "session.materialized":
          return null;
      }
    },

    classifyProcessResult(
      exitCode: number | null,
      stderr?: string,
      stdout?: string,
    ): ActivitySignal | null {
      const stderrSignal =
        stderr === undefined ? null : classifyTextSignal(stderr, "stderr");
      if (stderrSignal !== null) {
        return stderrSignal;
      }
      const stdoutSignal =
        stdout === undefined ? null : classifyTextSignal(stdout, "stdout");
      if (stdoutSignal !== null) {
        return stdoutSignal;
      }
      if (exitCode === null) {
        return {
          source: "process",
          status: "failed",
          observedAt: nowIso(),
          detail: "process closed without an exit code",
        };
      }
      if (exitCode === 0) {
        return {
          source: "process",
          status: "completed",
          observedAt: nowIso(),
          detail: "process exited with code 0",
        };
      }
      return {
        source: "process",
        status: "failed",
        observedAt: nowIso(),
        detail: `process exited with code ${exitCode}`,
      };
    },
  };
}
