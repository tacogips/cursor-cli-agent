# Advanced Queue Lifecycle Controls Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-queue-lifecycle.md`
**Issue Reference**: `parity-global-design-plan-implement-loop#P3-QUEUE-LIFECYCLE`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-queue-lifecycle.md`

### Summary

Implement `P3-QUEUE-LIFECYCLE`: add explicit Cursor-local queue lifecycle state, retained item execution state, backward-compatible queue persistence, lifecycle/control commands, paused-run and stop guards, item progress summaries, and queue run status recording.

### Scope

**Included**: queue lifecycle types, canonical queue persistence with legacy load support, pause/resume/delete/update/move/mode/stop commands, retained item statuses, queue run guards, cooperative stop between items, progress output, JSON/human output, and tests.

**Excluded**: group lifecycle controls, server or daemon APIs, SDK exports, direct Cursor-managed file writes, and cross-process killing of already-started Cursor processes.

### Codex Reference Mapping

Workflow preferred reference root `/g/gits/tacogips/cursor-cli-agent/codex-agent` was checked and contains no files. The accepted design maps behavior to the inspected fallback reference root: `/g/gits/tacogips/codex-agent`.

- `/g/gits/tacogips/codex-agent/src/queue/types.ts`: reference queue, item status, command mode, and event concepts.
- `/g/gits/tacogips/codex-agent/src/queue/repository.ts`: reference durable JSON queue storage and lifecycle mutation functions.
- `/g/gits/tacogips/codex-agent/src/queue/runner.ts`: reference paused-run guard, stop signal, item status persistence, and event emission.
- `/g/gits/tacogips/codex-agent/src/queue/repository.test.ts`: reference persistence and mutation test coverage.
- `/g/gits/tacogips/codex-agent/src/queue/runner.test.ts`: reference mode-preservation test coverage.
- `/g/gits/tacogips/codex-agent/src/cli/index.ts`: reference queue command names and user-facing lifecycle flow.

Intentional divergences:

- Cursor queues remain name/workspace based; run records link to Cursor session ids after stream events expose them.
- Successful items are retained as `completed` instead of removed, so progress/history remains visible.
- Stop is cooperative between items; in-flight Cursor processes are not killed by another CLI process in this slice.
- This repository uses `--json` / `--stream`, not Codex `--format json|table`.

---

## Modules

### 1. Queue Lifecycle Types

#### `src/types/queue.ts`

**Status**: Completed

```typescript
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

- [x] Define strict lifecycle, item, mode, run, and progress types.
- [x] Export types from the package-local type surface used by persistence and CLI.
- [x] Keep raw Cursor stream payloads out of queue domain types.

### 2. Backward-Compatible Queue Store

#### `src/persistence/queues-store.ts`

#### `src/persistence/queues-store.test.ts`

**Status**: Completed

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
export async function createQueue(
  name: string,
  workspace: string,
): Promise<QueueRecord>;
export async function deleteQueue(
  name: string,
): Promise<QueueRecord | undefined>;
export async function pauseQueue(
  name: string,
): Promise<QueueRecord | undefined>;
export async function resumeQueue(
  name: string,
): Promise<QueueRecord | undefined>;
export async function requestQueueStop(
  name: string,
): Promise<QueueRecord | undefined>;
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

- [x] Load legacy `{ name, workspace, items: [{ id, prompt, createdAt }] }` rows as canonical active queues.
- [x] Persist canonical records with lifecycle state, timestamps, stop requests, item status, and run records.
- [x] Preserve existing create/add/remove behavior while switching successful runs to retained completed items.
- [x] Add tests for legacy migration, pause, resume, delete, update, move, mode, stop, run update, and corrupt status tolerance.

### 3. Queue Progress Derivation

#### `src/queue/progress.ts`

#### `src/queue/progress.test.ts`

**Status**: Completed

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

- [x] Count item statuses and manual-mode pending items deterministically.
- [x] Enrich current item display from `P2-ACTIVITY` when a local session id exists.
- [x] Preserve persisted queue state when no activity signal exists.
- [x] Cover no-run, manual, failed, completed, and waiting-current cases.

### 4. Queue CLI Lifecycle Commands

#### `src/cli/cli.ts`

#### `src/cli/cli.test.ts`

**Status**: Completed

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

- [x] Add usage text and subcommand dispatch for pause, resume, delete, update, move, mode, and stop.
- [x] Return not-found, usage, and JSON responses consistently with existing CLI conventions.
- [x] Reject deleting a running latest run unless `--force` is set.
- [x] Include lifecycle and progress totals in list/show human output without changing JSON canonical output.

### 5. Queue Run Guard, Stop, and Progress Recording

#### `src/cli/cli.ts`

#### `src/cli/cli.test.ts`

**Status**: Completed

```typescript
interface QueueRunRecorder {
  startRun(queueName: string): Promise<QueueRunRecord>;
  markItemStarted(queueName: string, itemId: string): Promise<void>;
  markItemSession(
    queueName: string,
    itemId: string,
    sessionId: string,
  ): Promise<void>;
  markItemFinished(
    queueName: string,
    itemId: string,
    exitCode: number | null,
  ): Promise<void>;
  finishRun(queueName: string, status: QueueRunStatus): Promise<void>;
}
```

**Checklist**:

- [x] Refuse `queue run` before launching Cursor when the queue is paused or stopped.
- [x] Re-read lifecycle and stop request before each item and stop scheduling when paused or stopped.
- [x] Persist current item, item status, local session id, result, and latest run totals as execution progresses.
- [x] Keep trust and Cursor process failure exit behavior compatible with current `queue run`.
- [x] Preserve manual-mode items without scheduling them by default.

### 6. Verification and Documentation Alignment

#### `src/persistence/queues-store.test.ts`

#### `src/queue/progress.test.ts`

#### `src/cli/cli.test.ts`

**Status**: Completed

```typescript
describe("queue lifecycle controls", () => {
  // persistence, CLI, guard, stop, progress, and mode tests
});
```

**Checklist**:

- [x] Cover JSON and human output for lifecycle commands.
- [x] Cover paused-run guards, cooperative stop, and retained completed items.
- [x] Cover activity-derived progress snapshots and no-history output.
- [x] Run `task typecheck`, `task test`, and `task ci`.

---

## Module Status

| Module                 | File Path                         | Status    | Tests                                  |
| ---------------------- | --------------------------------- | --------- | -------------------------------------- |
| Queue lifecycle types  | `src/types/queue.ts`              | Completed | -                                      |
| Queue store            | `src/persistence/queues-store.ts` | Completed | `src/persistence/queues-store.test.ts` |
| Queue progress         | `src/queue/progress.ts`           | Completed | `src/queue/progress.test.ts`           |
| CLI lifecycle commands | `src/cli/cli.ts`                  | Completed | `src/cli/cli.test.ts`                  |
| Queue run recording    | `src/cli/cli.ts`                  | Completed | `src/cli/cli.test.ts`                  |
| Verification           | tests and task commands           | Completed | `task ci`                              |

## Task Breakdown

| Task                                           | Deliverables                                                              | Dependencies                                    | Parallelizable                                 | Completion Criteria                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TASK-001: Queue domain types                   | `src/types/queue.ts`; imports in store/progress/CLI                       | none                                            | Yes                                            | lifecycle/item/mode/run/progress types exist; no raw Cursor payloads leak into domain types                                                                                            |
| TASK-002: Canonical queue persistence          | `src/persistence/queues-store.ts`; `src/persistence/queues-store.test.ts` | TASK-001                                        | Yes after types                                | legacy queues load as active pending/auto items; saves write canonical lifecycle/item/run fields; tests cover migration, corrupt defaults, mutations, and running-delete guard support |
| TASK-003: Queue progress snapshots             | `src/queue/progress.ts`; `src/queue/progress.test.ts`                     | TASK-001; P2 activity types                     | Yes after types                                | totals count all item states and manual items; current item can use activity by `localSessionId`; missing activity does not mutate persisted state                                     |
| TASK-004: Queue lifecycle CLI commands         | `src/cli/cli.ts`; `src/cli/cli.test.ts`                                   | TASK-002; TASK-003                              | Partial; shares `src/cli/cli.ts` with TASK-005 | pause/resume/delete/update/move/mode/stop dispatch, usage, validation, human output, and JSON output match design                                                                      |
| TASK-005: Queue run lifecycle recording        | `src/cli/cli.ts`; `src/cli/cli.test.ts`                                   | TASK-002; TASK-003; stream/activity integration | No                                             | paused/stopped pre-run guard; per-item re-read; cooperative stop; retained completed/failed items; manual items skipped by default; existing failure exit behavior preserved           |
| TASK-006: Verification and user-facing refresh | `README.md`; `.divedra/README.md`; `.agents/skills/*` if stale; tests     | TASK-004; TASK-005                              | Partial                                        | queue command docs are current; workflow/skill docs refreshed if needed; `task typecheck`, `task test`, and `task ci` pass                                                             |

## Dependencies

| Feature            | Depends On                                    | Status    |
| ------------------ | --------------------------------------------- | --------- |
| P3-QUEUE-LIFECYCLE | P1-CORE-FOUNDATION                            | AVAILABLE |
| P3-QUEUE-LIFECYCLE | P2-ACTIVITY                                   | AVAILABLE |
| Queue run progress | Cursor stream normalizer and activity signals | AVAILABLE |
| Queue persistence  | Repository-owned `queues.json` path           | AVAILABLE |

## Parallelizable Tasks

| Task                    | Parallelizable  | Notes                                                           |
| ----------------------- | --------------- | --------------------------------------------------------------- |
| Queue types             | Yes             | Can land before store and CLI wiring.                           |
| Queue store             | Yes after types | Independent from progress derivation once type names are fixed. |
| Queue progress          | Yes after types | Uses activity dependency and queue records only.                |
| CLI lifecycle commands  | Partial         | Can wire non-run commands after store functions exist.          |
| Run guard and recording | No              | Depends on store functions and current `queue run` behavior.    |
| Verification            | Partial         | Store/progress tests can run before full CLI run tests.         |

## Completion Criteria

- [x] Canonical queue records load legacy data and save lifecycle/item/run fields.
- [x] Pause/resume/delete/update/move/mode/stop commands work in human and JSON modes.
- [x] `queue run` refuses paused or stopped queues before launching Cursor.
- [x] `queue run` observes pause/stop before each item and records stopped or paused latest-run status.
- [x] Successful items are retained as completed; failed items retain exit result.
- [x] Progress output reports lifecycle, item totals, manual items, and latest run status.
- [x] Type checking passes.
- [x] Unit and CLI tests pass.
- [x] `task ci` passes.

## Verification

- `task typecheck`
- `task test`
- `task ci`
- `bun run src/main.ts queue pause example --json`
- `bun run src/main.ts queue resume example --json`
- `bun run src/main.ts queue update example --item <id> --status pending --json`
- `bun run src/main.ts queue move example --from 0 --to 1 --json`
- `bun run src/main.ts queue mode example --item <id> --mode manual --json`
- `bun run src/main.ts queue stop example --json`
- Manual smoke: create a temp queue, add two auto items and one manual item, run it with a harmless prompt, verify auto items are retained as completed and manual item remains unscheduled.
- Manual smoke: pause before run and confirm no Cursor process launches.
- Manual smoke: request stop between items and confirm latest run is marked stopped with remaining items retained.

## Progress Log

### Session: 2026-05-06 00:00

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started in this workflow branch.
**Notes**: Initial plan maps Codex queue lifecycle behavior to Cursor-local queue persistence, stream normalization, activity signals, and cooperative stop semantics.

### Session: 2026-05-07 00:00

**Tasks Completed**: Step 4 plan refined after accepted design review.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started in this Step 4 node.
**Notes**: Corrected Codex references to inspected fallback root, preserved required preferred plan path, expanded task dependencies, completion criteria, and verification commands for later implementation.

### Session: 2026-05-07 23:45

**Tasks Completed**: TASK-001 through TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented queue lifecycle domain types, canonical queue persistence with legacy/corrupt tolerance, queue progress snapshots, queue lifecycle CLI commands, retained-item queue run recording, paused/stopped guards, manual-mode skip behavior, README queue lifecycle examples, and focused store/progress/CLI tests. Verification passed with `task typecheck`, `task test`, and `task ci`.
