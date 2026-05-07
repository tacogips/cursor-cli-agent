export type DaemonState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "stale"
  | "failed";

export interface DaemonAuthSummary {
  readonly mode: "disabled" | "required";
  readonly tokenConfigured: boolean;
}

export interface DaemonMetadata {
  readonly schemaVersion: 1;
  readonly state: "starting" | "running" | "stopping" | "failed";
  readonly pid: number;
  readonly parentPid: number;
  readonly marker: string;
  readonly commandPath: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly dataDir: string;
  readonly configDir: string;
  readonly serverMode: "http";
  readonly startedAt: string;
  readonly lastCheckedAt?: string;
  readonly auth: DaemonAuthSummary;
}

export interface DaemonStatusResult {
  readonly state: DaemonState;
  readonly metadata?: DaemonMetadata;
  readonly staleReason?: string;
}

export interface DaemonStartOptions {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface DaemonStartResult extends DaemonStatusResult {
  readonly state: "running" | "failed";
  readonly readiness?: DaemonReadinessResult;
}

export interface DaemonStopOptions {
  readonly timeoutMs?: number;
}

export type DaemonStopResult =
  | {
      readonly state: "stopped";
      readonly stopped: true;
      readonly metadata?: DaemonMetadata;
    }
  | {
      readonly state: "stopped";
      readonly stopped: false;
      readonly reason: "not_running";
    }
  | {
      readonly state: "stale";
      readonly stopped: false;
      readonly metadata?: DaemonMetadata;
      readonly staleReason: string;
    }
  | {
      readonly state: "failed";
      readonly stopped: false;
      readonly metadata?: DaemonMetadata;
      readonly reason: string;
    };

export interface DaemonStatusOptions {
  readonly checkReadiness?: boolean;
  readonly token?: string;
}

export interface DaemonReadinessOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

export type DaemonReadinessResult =
  | { readonly ready: true; readonly statusCode: number }
  | {
      readonly ready: false;
      readonly reason: "timeout" | "unauthorized" | "unreachable";
      readonly statusCode?: number;
      readonly error?: string;
    };
