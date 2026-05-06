export type GroupLifecycleState = "active" | "paused" | "completed" | "failed";

export type GroupRunStatus = "running" | "completed" | "failed" | "paused";

export type GroupRunWorkspaceStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "unknown";

export interface GroupRunWorkspaceRecord {
  readonly workspace: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly status: GroupRunWorkspaceStatus;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
}

export interface GroupRunRecord {
  readonly id: string;
  readonly status: GroupRunStatus;
  readonly promptPreview?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly workspaces: readonly GroupRunWorkspaceRecord[];
}

export interface GroupRecord {
  readonly name: string;
  readonly workspaces: readonly string[];
  readonly lifecycleState: GroupLifecycleState;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastRun?: GroupRunRecord;
}

export type GroupProgressTotals = Record<GroupRunWorkspaceStatus, number>;

export interface GroupProgressSnapshot {
  readonly group: GroupRecord;
  readonly run?: GroupRunRecord;
  readonly totals: GroupProgressTotals;
  readonly provenance: "group-store+activity";
  readonly updatedAt: string;
}
