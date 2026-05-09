# Advanced Queue Lifecycle Controls

This document defines the `P3-QUEUE-LIFECYCLE` slice for Cursor-local queue pause, resume, delete, update, move, mode, stop, item state, paused-run guards, and progress output in `cursor-cli-agent`.

## Overview

Advanced queue lifecycle controls extend the existing phase-1 queue commands while keeping the product boundary local to this machine. Queue state remains repository-owned data under the project data directory; Cursor transcripts, process streams, and activity signals remain read-only evidence used to enrich progress.

Included:

- explicit queue lifecycle state and retained item execution state
- backward-compatible `queues.json` loading for existing `{ name, workspace, items }` records
- `queue pause`, `queue resume`, `queue delete`, `queue update`, `queue move`, `queue mode`, and `queue stop`
- paused-run and stop-request guards before scheduling each item
- progress output for `queue show`, `queue list`, `queue run`, and JSON lifecycle commands
- Cursor-local run records tied to session ids once stream events reveal them

Excluded:

- remote server routes, daemon supervision, SDK exports, or SSE
- direct writes to Cursor-managed transcript, ai-tracking, or skill directories
- hard cancellation of an already-started `cursor-agent` process from another CLI invocation
- group lifecycle controls, which are covered by `design-docs/specs/design-group-lifecycle.md`

## Lifecycle Model

Queue records gain durable lifecycle state:

- `active`: runnable queue with no lifecycle block
- `paused`: retained queue that must not schedule new items
- `completed`: latest run completed every runnable item
- `failed`: latest run has at least one failed item
- `stopped`: latest run stopped before all runnable items were scheduled

Item records gain execution state:

- `pending`: eligible for a future run
- `running`: currently assigned to a wrapper-started Cursor process
- `completed`: Cursor process exited successfully
- `failed`: Cursor process exited unsuccessfully or trust failure occurred
- `skipped`: intentionally left unrun by mode or operator update

State transitions:

| Command/Event | From | To | Notes |
|---|---|---|---|
| legacy load | missing state | `active` / `pending` | Existing queues and items remain valid. |
| `queue pause` | any existing state | `paused` | Idempotent; blocks new item scheduling. |
| `queue resume` | `paused`, `stopped`, `completed`, `failed` | `active` | Clears pause and stop request fields. |
| `queue stop` | running or scheduled queue | `stopped` | Requests no further item scheduling after the current process exits. |
| `queue delete` | existing, not running | removed | Reject running latest run unless `--force` is provided. |
| `queue run` start | `active`, `completed`, `failed` | `active` | Creates or replaces `lastRun` with `status: "running"`. |
| `queue run` while stopped | `stopped` | `stopped` | Exits before launching Cursor; only `queue resume` clears stopped state and stop guards. |
| item start | `pending` | `running` | Persist before launching Cursor. |
| item success | `running` | `completed` | Retain the item for progress/history instead of removing it. |
| item failure | `running` | `failed` | Preserve result and stop the run with existing non-zero behavior. |
| `queue update --status pending` | terminal item | `pending` | Clears result and run timestamps for retry. |

## Persistence Contract

Current persisted queues contain:

```typescript
interface LegacyQueueItemRecord {
  readonly id: string;
  readonly prompt: string;
  readonly createdAt: string;
}

interface LegacyQueueRecord {
  readonly name: string;
  readonly workspace: string;
  readonly items: readonly LegacyQueueItemRecord[];
}
```

The new canonical shape is:

```typescript
type QueueLifecycleState = "active" | "paused" | "completed" | "failed" | "stopped";
type QueueItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type QueueItemMode = "auto" | "manual";
type QueueRunStatus = "running" | "completed" | "failed" | "paused" | "stopped";

interface QueueItemRecord {
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

interface QueueRunRecord {
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

interface QueueRecord {
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

Load rules:

1. Missing `lifecycleState` means `active`.
2. Legacy items load as `status: "pending"` and `mode: "auto"`.
3. Missing `createdAt` and `updatedAt` are tolerated and populated on the next write.
4. Unknown queue lifecycle, item status, item mode, or run status values are normalized to safe defaults with tests covering corruption tolerance.
5. Saves write canonical records through repository-owned `queues.json` only.

## CLI Contract

Commands:

```bash
cursor-cli-agent queue pause <name> [--json]
cursor-cli-agent queue resume <name> [--json]
cursor-cli-agent queue delete <name> [--force] [--json]
cursor-cli-agent queue update <name> --item <id> [--prompt <text>] [--status <pending|completed|failed|skipped>] [--json]
cursor-cli-agent queue move <name> --from <n> --to <n> [--json]
cursor-cli-agent queue mode <name> --item <id> --mode <auto|manual> [--json]
cursor-cli-agent queue stop <name> [--json]
```

Output rules:

- `--json` for pause/resume/update/move/mode/stop returns the updated canonical queue record.
- `--json` for delete returns `{ "deleted": true, "queue": <record> }`.
- Human lifecycle output is one concise status line.
- `queue list` human output includes lifecycle, total items, pending, running, completed, failed, skipped, and workspace.
- `queue show --json` returns the canonical queue record; human output includes item rows and latest run summary.
- `queue run --json` keeps the existing stream alias behavior; progress events are emitted as structured queue event objects alongside normalized Cursor stream events.

Validation:

- Missing names and required flags return usage errors.
- Unknown queues return the existing not-found behavior.
- `queue delete` rejects a running `lastRun` unless `--force` is set.
- `queue update --status running` is rejected unless it is used internally by the runner; CLI updates may set `pending`, `completed`, `failed`, or `skipped`.
- `queue move` indices are zero-based and must be within the item array.
- `queue stop` is idempotent; if no run is active, it returns the current queue without creating a pending stop request.

## Run Guards and Stop Semantics

`queue run` must re-read the queue before starting a run and before scheduling each item. If the queue is paused or stopped, it fails before launching Cursor and records no new run. Operators must use `queue resume` to clear stopped state and stop guard fields before another run can start.

During a run:

1. Create `lastRun` with all runnable item ids in `pendingItemIds`.
2. Before each item, re-read queue state.
3. If `lifecycleState` is `paused`, stop scheduling, mark the run `paused`, and leave remaining pending items unchanged.
4. If `stopRequestedAt` is set, stop scheduling, mark the run `stopped`, and clear no item states beyond the current completed item.
5. Mark an item `running` before launching Cursor, attach `localSessionId` once stream normalization reveals it, and then mark `completed` or `failed` from the process result.

This phase does not add cross-process process termination. `queue stop` is a cooperative durable request that a running CLI process observes between items, and SIGINT in the same process uses the same stop path after the current Cursor run exits.

## Mode Semantics

Item `mode` is an execution policy:

- `auto`: eligible for normal `queue run` scheduling.
- `manual`: retained in the queue and reported in progress, but not scheduled by default.

Manual items are skipped for the current run without changing their item status. Operators can switch them back to `auto`, update their prompt, mark them skipped, or run them in a later slice if an explicit manual-run command is added.

## Progress Summary

Queue progress is derived from canonical queue persistence plus phase-2 activity signals when a session id has been observed:

```typescript
interface QueueProgressSnapshot {
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
```

Activity mapping is best-effort. If activity reports `waiting_trust` or `waiting_input`, progress output may display the current item as waiting, but persisted item state remains `running` until the process exits or a later command updates it.

## Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/codex-agent`.

Relevant files:

- `/g/gits/tacogips/codex-agent/src/queue/types.ts`
- `/g/gits/tacogips/codex-agent/src/queue/repository.ts`
- `/g/gits/tacogips/codex-agent/src/queue/runner.ts`
- `/g/gits/tacogips/codex-agent/src/queue/repository.test.ts`
- `/g/gits/tacogips/codex-agent/src/queue/runner.test.ts`
- `/g/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to preserve:

- queue records persist in a repository-owned JSON file
- pause/resume are durable queue state changes
- delete removes a queue by resolved identity
- item prompt, status, position, and mode can be updated
- queue run refuses paused queues and emits started, completed, failed, completed-queue, and stopped-queue events
- prompt mode survives run status persistence

Intentional Cursor divergences:

- This project keeps queue identity by name and workspace path rather than Codex UUID-first lookup.
- Successful items are retained with `status: "completed"` for progress/history instead of being removed after execution.
- Queue progress uses Cursor stream normalization and optional activity signals, not Codex process events.
- Stop is cooperative between queued items because this phase has no daemon-level process registry.
- CLI output follows this repository's `--json` and `--stream` conventions instead of Codex's `--format json|table`.

## Dependencies

- `P1-CORE-FOUNDATION`: existing queue persistence, CLI dispatch, Cursor process runner, and stream normalization.
- `P2-ACTIVITY`: optional activity-derived progress enrichment for session-linked current items.
- Existing Cursor-local state paths in `src/config/paths.ts`; no Cursor-managed files are written.

## Verification

Implementation should be verified with:

```bash
task typecheck
task test
task ci
bun run src/main.ts queue pause example --json
bun run src/main.ts queue resume example --json
bun run src/main.ts queue update example --item <id> --status pending --json
bun run src/main.ts queue move example --from 0 --to 1 --json
bun run src/main.ts queue mode example --item <id> --mode manual --json
bun run src/main.ts queue stop example --json
```

Manual smoke commands require a pre-existing local queue named `example`.

## Open Questions

- Should a later slice add `queue run --include-manual`, or should manual items always require changing the item mode back to `auto`?
- Should `queue delete` require `--force` for completed or failed queues, or only for queues whose latest run is `running`?
- Should retained completed items have a separate prune command, or should delete remain the only history cleanup operation?

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-3-file-intelligence-and-orchestration-expansion`
- `design-docs/specs/design-activity.md`
- `design-docs/specs/design-group-lifecycle.md`
- `impl-plans/active/queue-lifecycle.md`
