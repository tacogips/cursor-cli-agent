import type { CursorAgentExit } from "../cursor/process-runner";
import {
  startHeadlessStreaming,
  startResumeStreaming,
  type CursorAgentStreamingProcess,
  type CursorAgentEffort,
  type HeadlessRunOptions,
  type ResumeRunOptions,
} from "../cursor/process-runner";
import { StreamNormalizerState } from "../cursor/stream-normalizer";
import { sessionIdFromEvent, type AgentEvent } from "../types/agent-event";

export type CursorAgentStreamMode = "event" | "normalized";
export type { CursorAgentEffort };

export interface CursorAgentRequest {
  readonly prompt?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: CursorAgentEffort;
  readonly mode?: "default" | "plan" | "ask";
  readonly streamMode?: CursorAgentStreamMode;
}

export interface CursorAgentRunResult {
  readonly sessionId: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly AgentEvent[];
}

export interface CursorRunningAgent {
  readonly sessionId: string;
  messages(): AsyncGenerator<AgentEvent, void, undefined>;
  waitForCompletion(): Promise<CursorAgentRunResult>;
  cancel(): Promise<void>;
  interrupt(): Promise<void>;
}

export interface AgentRunnerFacade {
  start(request: CursorAgentRequest): CursorRunningAgent;
  resume(
    request: CursorAgentRequest & { readonly sessionId: string },
  ): CursorRunningAgent;
}

type HeadlessStarter = (
  opts: HeadlessRunOptions,
  onLine: (line: string) => void,
) => CursorAgentStreamingProcess;

type ResumeStarter = (
  opts: ResumeRunOptions,
  onLine: (line: string) => void,
) => CursorAgentStreamingProcess;

interface AgentRunnerFactoryOptions {
  readonly cursorBinary?: string;
  readonly startHeadless?: HeadlessStarter;
  readonly startResume?: ResumeStarter;
}

interface QueueReader<T> {
  next(): Promise<IteratorResult<T, void>>;
}

class AsyncEventQueue<T> implements QueueReader<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T, void>) => void> =
    [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  next(): Promise<IteratorResult<T, void>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

class RunningAgent implements CursorRunningAgent {
  private currentSessionId: string;

  constructor(
    initialSessionId: string,
    private readonly queue: QueueReader<AgentEvent>,
    private readonly process: CursorAgentStreamingProcess,
    private readonly completion: Promise<CursorAgentRunResult>,
  ) {
    this.currentSessionId = initialSessionId;
  }

  get sessionId(): string {
    return this.currentSessionId;
  }

  async *messages(): AsyncGenerator<AgentEvent, void, undefined> {
    while (true) {
      const next = await this.queue.next();
      if (next.done === true) {
        return;
      }
      this.rememberSessionId(next.value);
      yield next.value;
    }
  }

  waitForCompletion(): Promise<CursorAgentRunResult> {
    return this.completion.then((result) => {
      this.currentSessionId = result.sessionId;
      return result;
    });
  }

  cancel(): Promise<void> {
    return this.process.cancel();
  }

  interrupt(): Promise<void> {
    return this.process.interrupt();
  }

  private rememberSessionId(event: AgentEvent): void {
    const sessionId = sessionIdFromEvent(event);
    if (sessionId !== undefined) {
      this.currentSessionId = sessionId;
    }
  }
}

function runResult(
  exit: CursorAgentExit,
  sessionId: string,
  events: readonly AgentEvent[],
): CursorAgentRunResult {
  return {
    sessionId,
    exitCode: exit.code,
    signal: exit.signal,
    stdout: exit.stdout,
    stderr: exit.stderr,
    events,
  };
}

function createRunningAgent(
  initialSessionId: string,
  start: (onLine: (line: string) => void) => CursorAgentStreamingProcess,
): CursorRunningAgent {
  const normalizer = new StreamNormalizerState();
  const queue = new AsyncEventQueue<AgentEvent>();
  const events: AgentEvent[] = [];
  let latestSessionId = initialSessionId;
  const process = start((line) => {
    for (const event of normalizer.processLine(line)) {
      const eventSessionId = sessionIdFromEvent(event);
      if (eventSessionId !== undefined) {
        latestSessionId = eventSessionId;
      }
      events.push(event);
      queue.push(event);
    }
  });
  const completion = process.done
    .then((exit) => runResult(exit, latestSessionId, events))
    .finally(() => {
      queue.close();
    });
  return new RunningAgent(initialSessionId, queue, process, completion);
}

function requirePrompt(request: CursorAgentRequest): string {
  const prompt = request.prompt?.trim();
  if (prompt === undefined || prompt.length === 0) {
    throw new Error("prompt is required to start a Cursor agent run");
  }
  return prompt;
}

export function createAgentRunnerFacade(
  options: AgentRunnerFactoryOptions = {},
): AgentRunnerFacade {
  const startHeadless = options.startHeadless ?? startHeadlessStreaming;
  const startResume = options.startResume ?? startResumeStreaming;
  return {
    start(request: CursorAgentRequest): CursorRunningAgent {
      const workspace = request.cwd ?? process.cwd();
      const prompt = requirePrompt(request);
      return createRunningAgent(request.sessionId ?? "pending", (onLine) =>
        startHeadless(
          {
            workspace,
            prompt,
            ...(options.cursorBinary !== undefined
              ? { cursorBinary: options.cursorBinary }
              : {}),
            ...(request.model !== undefined ? { model: request.model } : {}),
            ...(request.effort !== undefined ? { effort: request.effort } : {}),
            ...(request.mode !== undefined ? { mode: request.mode } : {}),
          },
          onLine,
        ),
      );
    },

    resume(
      request: CursorAgentRequest & { readonly sessionId: string },
    ): CursorRunningAgent {
      const workspace = request.cwd ?? process.cwd();
      return createRunningAgent(request.sessionId, (onLine) =>
        startResume(
          {
            workspace,
            sessionOrChatId: request.sessionId,
            ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
            ...(options.cursorBinary !== undefined
              ? { cursorBinary: options.cursorBinary }
              : {}),
            ...(request.model !== undefined ? { model: request.model } : {}),
            ...(request.effort !== undefined ? { effort: request.effort } : {}),
            ...(request.mode !== undefined ? { mode: request.mode } : {}),
          },
          onLine,
        ),
      );
    },
  };
}
