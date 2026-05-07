export type QueueLifecycleState =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type QueueItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type QueueItemMode = "auto" | "manual";

export type QueueRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "stopped";

export interface QueueItemRecord {
  readonly id: string;
  readonly prompt: string;
  readonly status: QueueItemStatus;
  readonly mode: QueueItemMode;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly result?: {
    readonly exitCode: number | null;
  };
}

export interface QueueRunRecord {
  readonly id: string;
  readonly status: QueueRunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly currentItemId?: string;
  readonly completedItemIds: readonly string[];
  readonly failedItemIds: readonly string[];
  readonly pendingItemIds: readonly string[];
  readonly stoppedAt?: string;
}

export interface QueueRecord {
  readonly name: string;
  readonly workspace: string;
  readonly lifecycleState: QueueLifecycleState;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly stopRequestedAt?: string;
  readonly items: readonly QueueItemRecord[];
  readonly lastRun?: QueueRunRecord;
}

export interface QueueProgressTotals {
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly manual: number;
}

export interface QueueProgressSnapshot {
  readonly queue: QueueRecord;
  readonly run?: QueueRunRecord;
  readonly totals: QueueProgressTotals;
  readonly provenance: "queue-store+activity";
  readonly updatedAt: string;
}
