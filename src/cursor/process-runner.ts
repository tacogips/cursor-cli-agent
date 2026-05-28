import { spawn } from "node:child_process";
import { once } from "node:events";

function streamLines(
  proc: ReturnType<typeof spawn>,
  onLine: (line: string) => void,
  onStdoutChunk?: (chunk: string) => void,
): Promise<void> {
  let buffer = "";
  return new Promise<void>((resolve, reject) => {
    proc.stdout?.on("data", (d: Buffer) => {
      const chunk = d.toString("utf8");
      onStdoutChunk?.(chunk);
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        onLine(line);
        idx = buffer.indexOf("\n");
      }
    });
    proc.on("close", () => {
      if (buffer.trim().length > 0) {
        onLine(buffer);
      }
      resolve();
    });
    proc.on("error", reject);
  });
}

export interface PromptImageArgv {
  readonly flag: string;
  readonly paths: readonly string[];
}

export interface HeadlessRunOptions {
  readonly workspace: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly cursorBinary?: string;
  readonly model?: string;
  readonly effort?: CursorAgentEffort;
  readonly mode?: "default" | "plan" | "ask";
  readonly trust?: boolean;
  readonly force?: boolean;
  readonly yolo?: boolean;
  readonly streamPartialOutput?: boolean;
  /** Matches `cursor-agent --sandbox <enabled|disabled>`. */
  readonly sandbox?: "enabled" | "disabled";
  readonly approveMcps?: boolean;
  /** `true` emits `--worktree` with generated name; a string sets the worktree name. */
  readonly worktree?: true | string;
  readonly worktreeBase?: string;
  readonly skipWorktreeSetup?: boolean;
  /** Repeated `<flag> <path>` fragments appended before worktree passthrough tokens. */
  readonly promptImages?: PromptImageArgv;
}

export type CursorAgentEffort = "low" | "medium" | "high" | "xhigh";

export type CursorAgentExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

export interface CursorAgentStreamingProcess {
  readonly done: Promise<CursorAgentExit>;
  readonly pid?: number;
  cancel(): Promise<void>;
  interrupt(): Promise<void>;
}

function appendPromptImageArgs(
  args: string[],
  opts: Pick<HeadlessRunOptions, "promptImages">,
): void {
  const img = opts.promptImages;
  if (img === undefined || img.paths.length === 0) {
    return;
  }
  for (const p of img.paths) {
    args.push(img.flag, p);
  }
}

function appendWorktreeArgs(
  args: string[],
  opts: Pick<
    HeadlessRunOptions,
    "worktree" | "worktreeBase" | "skipWorktreeSetup"
  >,
): void {
  if (opts.worktree !== undefined) {
    if (opts.worktree === true) {
      args.push("--worktree");
    } else {
      args.push("--worktree", opts.worktree);
    }
  }
  if (opts.worktreeBase !== undefined && opts.worktreeBase.length > 0) {
    args.push("--worktree-base", opts.worktreeBase);
  }
  if (opts.skipWorktreeSetup === true) {
    args.push("--skip-worktree-setup");
  }
}

const CURSOR_EFFORT_TOKENS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function toCursorEffortToken(effort: CursorAgentEffort): string {
  return effort;
}

export function resolveModelForEffort(
  model: string | undefined,
  effort: CursorAgentEffort | undefined,
): string | undefined {
  if (model === undefined || effort === undefined) {
    return model;
  }

  const requested = toCursorEffortToken(effort);
  const fastSuffix = model.endsWith("-fast") ? "-fast" : "";
  const base =
    fastSuffix.length > 0 ? model.slice(0, -fastSuffix.length) : model;
  if (base.endsWith("-extra-high")) {
    const prefix = base.slice(0, -"extra-high".length);
    return `${prefix}${requested}${fastSuffix}`;
  }

  const tokens = base.split("-");
  const last = tokens.at(-1);
  if (last !== undefined && CURSOR_EFFORT_TOKENS.has(last)) {
    tokens[tokens.length - 1] = requested;
    return `${tokens.join("-")}${fastSuffix}`;
  }

  if (requested === "medium") {
    return model;
  }

  return `${base}-${requested}${fastSuffix}`;
}

function buildHeadlessArgs(opts: HeadlessRunOptions): string[] {
  const args = ["--print", "--output-format", "stream-json"];
  const model = resolveModelForEffort(opts.model, opts.effort);
  if (model !== undefined) {
    args.push("--model", model);
  }
  if (opts.mode !== undefined && opts.mode !== "default") {
    args.push("--mode", opts.mode);
  }
  if (opts.trust === true) {
    args.push("--trust");
  }
  if (opts.force === true) {
    args.push("--force");
  }
  if (opts.yolo === true) {
    args.push("--yolo");
  }
  if (opts.streamPartialOutput === true) {
    args.push("--stream-partial-output");
  }
  if (opts.sandbox !== undefined) {
    args.push("--sandbox", opts.sandbox);
  }
  if (opts.approveMcps === true) {
    args.push("--approve-mcps");
  }
  appendPromptImageArgs(args, opts);
  appendWorktreeArgs(args, opts);
  args.push("--", buildPromptWithSystemPrompt(opts.prompt, opts.systemPrompt));
  return args;
}

function buildPromptWithSystemPrompt(
  prompt: string,
  systemPrompt: string | undefined,
): string {
  if (systemPrompt === undefined || systemPrompt.trim().length === 0) {
    return prompt;
  }
  return `${systemPrompt}\n\n${prompt}`;
}

/**
 * Run `cursor-agent create-chat` and return the chat id from stdout.
 */
export async function createChat(
  workspace: string,
): Promise<{ chatId: string; stderr: string }> {
  const proc = spawn("cursor-agent", ["create-chat"], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const chunks: Buffer[] = [];
  proc.stdout?.on("data", (d: Buffer) => {
    chunks.push(d);
  });
  const [exitCode] = (await once(proc, "close")) as [number | null];
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim().length > 0
        ? stderr.trim()
        : `create-chat exited with code ${exitCode}`,
    );
  }
  let out = "";
  for (const c of chunks) {
    out += c.toString("utf8");
  }
  out = out.trim();
  const line =
    out
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .at(-1) ?? out;
  if (line.length === 0) {
    throw new Error("create-chat returned empty stdout");
  }
  return { chatId: line.trim(), stderr };
}

/**
 * Run a headless session and invoke `onLine` for each stdout line (NDJSON stream).
 */
export async function runHeadlessStreaming(
  opts: HeadlessRunOptions,
  onLine: (line: string) => void,
): Promise<CursorAgentExit> {
  return startHeadlessStreaming(opts, onLine).done;
}

function controlledProcess(
  proc: ReturnType<typeof spawn>,
  done: Promise<CursorAgentExit>,
): CursorAgentStreamingProcess {
  const control: CursorAgentStreamingProcess = {
    done,
    ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
    async cancel(): Promise<void> {
      if (proc.killed) {
        return;
      }
      proc.kill("SIGTERM");
    },
    async interrupt(): Promise<void> {
      if (proc.killed) {
        return;
      }
      proc.kill("SIGINT");
    },
  };
  return control;
}

export function startHeadlessStreaming(
  opts: HeadlessRunOptions,
  onLine: (line: string) => void,
): CursorAgentStreamingProcess {
  const args = buildHeadlessArgs(opts);
  const proc = spawn(opts.cursorBinary ?? "cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine, (chunk) => {
    stdout += chunk;
  });
  const done = (async (): Promise<CursorAgentExit> => {
    const [code, signal] = (await once(proc, "close")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    await linesDone;
    return { code, signal, stdout, stderr };
  })();
  return controlledProcess(proc, done);
}

export interface ResumeRunOptions extends Omit<HeadlessRunOptions, "prompt"> {
  readonly sessionOrChatId: string;
  readonly prompt?: string;
}

function buildResumeArgs(opts: ResumeRunOptions): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--resume",
    opts.sessionOrChatId,
  ];
  const model = resolveModelForEffort(opts.model, opts.effort);
  if (model !== undefined) {
    args.push("--model", model);
  }
  if (opts.mode !== undefined && opts.mode !== "default") {
    args.push("--mode", opts.mode);
  }
  if (opts.trust === true) {
    args.push("--trust");
  }
  if (opts.force === true) {
    args.push("--force");
  }
  if (opts.yolo === true) {
    args.push("--yolo");
  }
  if (opts.streamPartialOutput === true) {
    args.push("--stream-partial-output");
  }
  if (opts.sandbox !== undefined) {
    args.push("--sandbox", opts.sandbox);
  }
  if (opts.approveMcps === true) {
    args.push("--approve-mcps");
  }
  appendPromptImageArgs(args, opts);
  appendWorktreeArgs(args, opts);
  if (opts.prompt !== undefined && opts.prompt.length > 0) {
    args.push("--", buildPromptWithSystemPrompt(opts.prompt, opts.systemPrompt));
  }
  return args;
}

export async function resumeStreaming(
  opts: ResumeRunOptions,
  onLine: (line: string) => void,
): Promise<CursorAgentExit> {
  return startResumeStreaming(opts, onLine).done;
}

export function startResumeStreaming(
  opts: ResumeRunOptions,
  onLine: (line: string) => void,
): CursorAgentStreamingProcess {
  const args = buildResumeArgs(opts);
  const proc = spawn(opts.cursorBinary ?? "cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine, (chunk) => {
    stdout += chunk;
  });
  const done = (async (): Promise<CursorAgentExit> => {
    const [code, signal] = (await once(proc, "close")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    await linesDone;
    return { code, signal, stdout, stderr };
  })();
  return controlledProcess(proc, done);
}

export function isTrustFailureMessage(text: string): boolean {
  return text.includes("Workspace Trust Required");
}
