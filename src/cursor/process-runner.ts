import { spawn } from "node:child_process";
import { once } from "node:events";

function streamLines(
  proc: ReturnType<typeof spawn>,
  onLine: (line: string) => void,
): Promise<void> {
  let buffer = "";
  return new Promise<void>((resolve, reject) => {
    proc.stdout?.on("data", (d: Buffer) => {
      buffer += d.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        onLine(line);
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

export interface HeadlessRunOptions {
  readonly workspace: string;
  readonly prompt: string;
  readonly model?: string;
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
}

export type CursorAgentExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
};

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

function buildHeadlessArgs(opts: HeadlessRunOptions): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--prompt",
    opts.prompt,
  ];
  if (opts.model !== undefined) {
    args.push("--model", opts.model);
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
  appendWorktreeArgs(args, opts);
  return args;
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
  const args = buildHeadlessArgs(opts);
  const proc = spawn("cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine);
  const [code, signal] = (await once(proc, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  await linesDone;
  return { code, signal, stderr };
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
  if (opts.prompt !== undefined && opts.prompt.length > 0) {
    args.push("--prompt", opts.prompt);
  }
  if (opts.model !== undefined) {
    args.push("--model", opts.model);
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
  appendWorktreeArgs(args, opts);
  return args;
}

export async function resumeStreaming(
  opts: ResumeRunOptions,
  onLine: (line: string) => void,
): Promise<CursorAgentExit> {
  const args = buildResumeArgs(opts);
  const proc = spawn("cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine);
  const [code, signal] = (await once(proc, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  await linesDone;
  return { code, signal, stderr };
}

export function isTrustFailureMessage(text: string): boolean {
  return text.includes("Workspace Trust Required");
}
