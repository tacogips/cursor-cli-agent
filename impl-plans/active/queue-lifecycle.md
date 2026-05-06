# Advanced Queue Lifecycle Controls Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-queue-lifecycle.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-queue-lifecycle.md`

### Summary

Implement `P3-QUEUE-LIFECYCLE`: add explicit Cursor-local queue lifecycle state, retained item execution state, backward-compatible queue persistence, lifecycle/control commands, paused-run and stop guards, item progress summaries, and queue run status recording.

### Scope

**Included**: queue lifecycle types, canonical queue persistence with legacy load support, pause/resume/delete/update/move/mode/stop commands, retained item statuses, queue run guards, cooperative stop between items, progress output, JSON/human output, and tests.

**Excluded**: group lifecycle controls, server or daemon APIs, SDK exports, direct Cursor-managed file writes, and cross-process killing of already-started Cursor processes.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/queue/types.ts`: reference queue, item status, command mode, and event concepts.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/repository.ts`: reference durable JSON queue storage and lifecycle mutation functions.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.ts`: reference paused-run guard, stop signal, item status persistence, and event emission.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/repository.test.ts`: reference persistence and mutation test coverage.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.test.ts`: reference mode-preservation test coverage.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: reference queue command names and user-facing lifecycle flow.

Intentional divergences:

- Cursor queues remain name/workspace based; run records link to Cursor session ids after stream events expose them.
- Successful items are retained as `completed` instead of removed, so progress/history remains visible.
- Stop is cooperative between items; in-flight Cursor processes are not killed by another CLI process in this slice.
- This repository uses `--json` / `--stream`, not Codex `--format json|table`.

---

## Modules

### 1. Queue Lifecycle Types

#### `src/types/queue.ts`

**Status**: NOT_STARTED

```typescript
export type QueueLifecycleState = "active" | "paused" | "completed" | "failed" | "stopped";
export type QueueItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type QueueItemMode = "auto" | "manual";
export type QueueRunStatus = "running" | "completed" | "failed" | "paused" | "stopped";

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
  readonly result?: { readonly exitCode: number | null };
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
```

**Checklist**:

- [ ] Define strict lifecycle, item, mode, run, and progress types.
- [ ] Export types from the package-local type surface used by persistence and CLI.
- [ ] Keep raw Cursor stream payloads out of queue domain types.

### 2. Backward-Compatible Queue Store

#### `src/persistence/queues-store.ts`
#### `src/persistence/queues-store.test.ts`

**Status**: NOT_STARTED

```typescript
export interface QueueItemPatch {
  readonly prompt?: string;
  readonly status?: QueueItemStatus;
  readonly mode?: QueueItemMode;
}

export interface QueueStoreUpdate {
  readonly lifecycleState?: QueueLifecycleState;
  readonly stopRequestedAt?: string | undefined;
  readonly lastRun?: QueueRunRecord;
  readonly items?: readonly QueueItemRecord[];
}

export async function listQueues(): Promise<readonly QueueRecord[]>;
export async function getQueue(name: string): Promise<QueueRecord | undefined>;
export async function createQueue(name: string, workspace: string): Promise<QueueRecord>;
export async function deleteQueue(name: string): Promise<QueueRecord | undefined>;
export async function pauseQueue(name: string): Promise<QueueRecord | undefined>;
export async function resumeQueue(name: string): Promise<QueueRecord | undefined>;
export async function requestQueueStop(name: string): Promise<QueueRecord | undefined>;
export async function updateQueueItem(
  name: string,
  itemId: string,
  patch: QueueItemPatch,
): Promise<QueueRecord | undefined>;
export async function moveQueueItem(
  name: string,
  from: number,
  to: number,
): Promise<QueueRecord | undefined>;
export async function updateQueueRun(
  name: string,
  update: QueueStoreUpdate,
): Promise<QueueRecord | undefined>;
```

**Checklist**:

- [ ] Load legacy `{ name, workspace, items: [{ id, prompt, createdAt }] }` rows as canonical active queues.
- [ ] Persist canonical records with lifecycle state, timestamps, stop requests, item status, and run records.
- [ ] Preserve existing create/add/remove behavior while switching successful runs to retained completed items.
- [ ] Add tests for legacy migration, pause, resume, delete, update, move, mode, stop, run update, and corrupt status tolerance.

### 3. Queue Progress Derivation

#### `src/queue/progress.ts`
#### `src/queue/progress.test.ts`

**Status**: NOT_STARTED

```typescript
export interface QueueProgressSnapshot {
  readonly queue: QueueRecord;
  readonly run?: QueueRunRecord;
  readonly totals: {
    readonly pending: number;
    readonly running: number;
    readonly completed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly manual: number;
  };
  readonly provenance: "queue-store+activity";
  readonly updatedAt: string;
}

export interface QueueProgressDependencies {
  readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
  readonly now: () => string;
}

export async function deriveQueueProgressSnapshot(
  queue: QueueRecord,
  deps: QueueProgressDependencies,
): Promise<QueueProgressSnapshot>;
```

**Checklist**:

- [ ] Count item statuses and manual-mode pending items deterministically.
- [ ] Enrich current item display from `P2-ACTIVITY` when a local session id exists.
- [ ] Preserve persisted queue state when no activity signal exists.
- [ ] Cover no-run, paused, stopped, manual, failed, completed, and waiting-current cases.

### 4. Queue CLI Lifecycle Commands

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent queue pause <name> [--json]
curort-cli-agent queue resume <name> [--json]
curort-cli-agent queue delete <name> [--force] [--json]
curort-cli-agent queue update <name> --item <id> [--prompt <text>] [--status <pending|completed|failed|skipped>] [--json]
curort-cli-agent queue move <name> --from <n> --to <n> [--json]
curort-cli-agent queue mode <name> --item <id> --mode <auto|manual> [--json]
curort-cli-agent queue stop <name> [--json]
```

**Checklist**:

- [ ] Add usage text and subcommand dispatch for pause, resume, delete, update, move, mode, and stop.
- [ ] Return not-found, usage, and JSON responses consistently with existing CLI conventions.
- [ ] Reject deleting a running latest run unless `--force` is set.
- [ ] Include lifecycle and progress totals in list/show human output without changing JSON canonical output.

### 5. Queue Run Guard, Stop, and Progress Recording

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
interface QueueRunRecorder {
  startRun(queueName: string): Promise<QueueRunRecord>;
  markItemStarted(queueName: string, itemId: string): Promise<void>;
  markItemSession(queueName: string, itemId: string, sessionId: string): Promise<void>;
  markItemFinished(
    queueName: string,
    itemId: string,
    exitCode: number | null,
  ): Promise<void>;
  finishRun(queueName: string, status: QueueRunStatus): Promise<void>;
}
```

**Checklist**:

- [ ] Refuse `queue run` before launching Cursor when the queue is paused or stopped.
- [ ] Re-read lifecycle and stop request before each item and stop scheduling when paused or stopped.
- [ ] Persist current item, item status, local session id, result, and latest run totals as execution progresses.
- [ ] Keep trust and Cursor process failure exit behavior compatible with current `queue run`.
- [ ] Preserve manual-mode items without scheduling them by default.

### 6. Verification and Documentation Alignment

#### `src/persistence/queues-store.test.ts`
#### `src/queue/progress.test.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
describe("queue lifecycle controls", () => {
  // persistence, CLI, guard, stop, progress, and mode tests
});
```

**Checklist**:

- [ ] Cover JSON and human output for lifecycle commands.
- [ ] Cover paused-run guards, cooperative stop, and retained completed items.
- [ ] Cover activity-derived progress snapshots and no-history output.
- [ ] Run `task typecheck`, `task test`, and `task ci`.

---

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Queue lifecycle types | `src/types/queue.ts` | NOT_STARTED | - |
| Queue store | `src/persistence/queues-store.ts` | NOT_STARTED | `src/persistence/queues-store.test.ts` |
| Queue progress | `src/queue/progress.ts` | NOT_STARTED | `src/queue/progress.test.ts` |
| CLI lifecycle commands | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |
| Queue run recording | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |
| Verification | tests and task commands | NOT_STARTED | `task ci` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| P3-QUEUE-LIFECYCLE | P1-CORE-FOUNDATION | REQUIRED |
| P3-QUEUE-LIFECYCLE | P2-ACTIVITY | REQUIRED |
| Queue run progress | Cursor stream normalizer and activity signals | REQUIRED |
| Queue persistence | Repository-owned `queues.json` path | AVAILABLE |

## Parallelizable Tasks

| Task | Parallelizable | Notes |
|---|---|---|
| Queue types | Yes | Can land before store and CLI wiring. |
| Queue store | Yes after types | Independent from progress derivation once type names are fixed. |
| Queue progress | Yes after types | Uses activity dependency and queue records only. |
| CLI lifecycle commands | Partial | Can wire non-run commands after store functions exist. |
| Run guard and recording | No | Depends on store functions and current `queue run` behavior. |
| Verification | Partial | Store/progress tests can run before full CLI run tests. |

## Completion Criteria

- [ ] Canonical queue records load legacy data and save lifecycle/item/run fields.
- [ ] Pause/resume/delete/update/move/mode/stop commands work in human and JSON modes.
- [ ] `queue run` refuses paused or stopped queues before launching Cursor.
- [ ] `queue run` observes pause/stop before each item and records stopped or paused latest-run status.
- [ ] Successful items are retained as completed; failed items retain exit result.
- [ ] Progress output reports lifecycle, item totals, manual items, and latest run status.
- [ ] Type checking passes.
- [ ] Unit and CLI tests pass.
- [ ] `task ci` passes.

## Progress Log

### Session: 2026-05-06 00:00
**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started in this workflow branch.
**Notes**: Initial plan maps Codex queue lifecycle behavior to Cursor-local queue persistence, stream normalization, activity signals, and cooperative stop semantics.
