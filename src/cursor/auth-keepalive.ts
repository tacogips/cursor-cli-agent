import { checkModelAvailability } from "./model-availability";
import type { ToolVersionCommandRunner } from "../types/tool-versions";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 20 * 60 * 1000;
const MIN_KEEPALIVE_INTERVAL_MS = 60 * 1000;

export interface CursorAuthKeepAliveOptions {
  readonly model: string;
  readonly cursorAgentBinary?: string;
  readonly cursorApiKey?: string;
  readonly cursorAuthToken?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly workspace?: string;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly setInterval?: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof globalThis.setInterval>;
  readonly clearInterval?: (
    id: ReturnType<typeof globalThis.setInterval>,
  ) => void;
  readonly commandRunner?: ToolVersionCommandRunner;
}

export interface CursorAuthKeepAliveStatus {
  readonly running: boolean;
  readonly lastSuccessAt?: string;
  readonly lastFailureAt?: string;
  readonly lastFailureMessage?: string;
  readonly probeCount: number;
}

function clampIntervalMs(value: number | undefined): number {
  const v = value ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  if (!Number.isFinite(v) || v < MIN_KEEPALIVE_INTERVAL_MS) {
    return MIN_KEEPALIVE_INTERVAL_MS;
  }
  return Math.floor(v);
}

export class CursorAuthKeepAlive {
  private timer: ReturnType<typeof globalThis.setInterval> | undefined;
  private _status: CursorAuthKeepAliveStatus;

  constructor(private readonly options: CursorAuthKeepAliveOptions) {
    this._status = { running: false, probeCount: 0 };
  }

  start(): void {
    if (this._status.running) {
      return;
    }
    this._status = { ...this._status, running: true };
    const intervalMs = clampIntervalMs(this.options.intervalMs);
    const setIntervalFn =
      this.options.setInterval ?? globalThis.setInterval.bind(globalThis);
    this.timer = setIntervalFn(() => {
      void this.probeNow();
    }, intervalMs);
  }

  stop(): void {
    if (!this._status.running) {
      return;
    }
    this._status = { ...this._status, running: false };
    const clearIntervalFn =
      this.options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
    if (this.timer !== undefined) {
      clearIntervalFn(this.timer);
      this.timer = undefined;
    }
  }

  async probeNow(): Promise<void> {
    const now = this.options.now ?? (() => new Date());
    try {
      const result = await checkModelAvailability({
        model: this.options.model,
        probe: true,
        ...(this.options.cursorAgentBinary !== undefined
          ? { cursorAgentBinary: this.options.cursorAgentBinary }
          : {}),
        ...(this.options.cursorApiKey !== undefined
          ? { cursorApiKey: this.options.cursorApiKey }
          : {}),
        ...(this.options.cursorAuthToken !== undefined
          ? { cursorAuthToken: this.options.cursorAuthToken }
          : {}),
        ...(this.options.env !== undefined ? { env: this.options.env } : {}),
        ...(this.options.workspace !== undefined
          ? { workspace: this.options.workspace }
          : {}),
        ...(this.options.timeoutMs !== undefined
          ? { timeoutMs: this.options.timeoutMs }
          : {}),
        now,
        ...(this.options.commandRunner !== undefined
          ? { commandRunner: this.options.commandRunner }
          : {}),
      });
      if (result.modelReachability.status === "unavailable") {
        throw new Error(
          result.modelReachability.error ?? "model probe returned unavailable",
        );
      }
      this._status = {
        ...this._status,
        lastSuccessAt: now().toISOString(),
        probeCount: this._status.probeCount + 1,
      };
    } catch (err) {
      this._status = {
        ...this._status,
        lastFailureAt: now().toISOString(),
        lastFailureMessage: err instanceof Error ? err.message : String(err),
        probeCount: this._status.probeCount + 1,
      };
    }
  }

  status(): CursorAuthKeepAliveStatus {
    return { ...this._status };
  }
}
