# Advanced Group Lifecycle Controls

This document defines the `P3-GROUP-LIFECYCLE` slice for Cursor-local group pause, resume, delete, and watch behavior in `curort-cli-agent`.

## Overview

Advanced group lifecycle controls extend the existing phase-1 group commands without changing the product boundary: all state is local, repository-owned, and derived from Cursor transcripts, wrapper-started process observations, and the activity subsystem.

Included:

- explicit group lifecycle state
- backward-compatible `groups.json` loading for existing `{ name, workspaces }` records
- `group pause`, `group resume`, `group delete`, and `group watch`
- paused-run guards before and during `group run`
- JSON and human output for lifecycle commands
- activity-derived progress summaries for the latest group run

Excluded:

- remote server routes, daemon supervision, SDK exports, or SSE
- killing already-started Cursor processes after a group is paused
- direct writes to Cursor-managed transcript or skill directories
- queue lifecycle controls, which are a separate phase-3 slice

## Lifecycle Model

Group records gain an explicit lifecycle state:

- `active`: runnable group with no lifecycle block
- `paused`: group is retained but must not start new workspace runs
- `completed`: latest recorded group run completed for every workspace
- `failed`: latest recorded group run has at least one failed workspace

Deletion is a persistence operation, not a lifecycle state. `group delete` removes the group from the repository-owned group store. A future archive feature may add `archived`, but this slice does not persist archived groups.

State transitions:

| Command/Event | From | To | Notes |
|---|---|---|---|
| legacy load | missing state | `active` | Existing records remain valid. |
| `group pause` | any existing state | `paused` | Idempotent; updates `updatedAt`. |
| `group resume` | any existing state | `active` | Idempotent; clears the pause guard. |
| `group run` start | `active`, `completed`, `failed` | `active` | Creates or replaces `lastRun` with `status: "running"`. |
| `group run` success | `active` | `completed` | All workspaces completed successfully. |
| `group run` failure | `active` | `failed` | At least one workspace failed. |
| `group delete` | existing, not running | removed | Reject running groups unless `--force` is provided. |

## Persistence Contract

Current persisted groups contain:

```typescript
interface LegacyGroupRecord {
  readonly name: string;
  readonly workspaces: readonly string[];
}
```

The new canonical shape is:

```typescript
type GroupLifecycleState = "active" | "paused" | "completed" | "failed";

type GroupRunWorkspaceStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "unknown";

interface GroupRunWorkspaceRecord {
  readonly workspace: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly status: GroupRunWorkspaceStatus;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
}

interface GroupRunRecord {
  readonly id: string;
  readonly status: "running" | "completed" | "failed" | "paused";
  readonly promptPreview?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly workspaces: readonly GroupRunWorkspaceRecord[];
}

interface GroupRecord {
  readonly name: string;
  readonly workspaces: readonly string[];
  readonly lifecycleState: GroupLifecycleState;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastRun?: GroupRunRecord;
}
```

Load rules:

1. Missing `lifecycleState` means `active`.
2. Missing `createdAt` and `updatedAt` are tolerated and populated on the next write.
3. Missing `lastRun` means watch output reports no run history instead of failing.
4. Unknown lifecycle or run statuses are normalized to `active` and `unknown` with tests covering corruption tolerance.
5. Saves write the canonical shape and use repository-owned state paths only.

## CLI Contract

Commands:

```bash
curort-cli-agent group pause <name> [--json]
curort-cli-agent group resume <name> [--json]
curort-cli-agent group delete <name> [--force] [--json]
curort-cli-agent group watch <name> [--interval <seconds>] [--once] [--json]
```

Output rules:

- `--json` for pause/resume returns the updated canonical group record.
- `--json` for delete returns `{ "deleted": true, "group": <record> }`.
- Human pause/resume/delete output is one concise status line.
- `group watch --json` emits one JSON snapshot with `--once`; without `--once`, it emits newline-delimited snapshot objects until interrupted or the latest run reaches a terminal state.
- Human watch output shows lifecycle, latest run status, workspace totals, and one row per workspace.

Validation:

- Missing names return usage errors.
- Unknown groups return the existing not-found exit behavior.
- `group delete` rejects a running `lastRun` unless `--force` is set.
- `group watch --interval` must be a positive integer.

## Paused Run Guards

`group run` must check the group record before starting a run. If the group is paused, it fails before launching Cursor and records no new run.

During a multi-workspace group run, the command must re-read the group before each workspace. If the group has been paused, it stops scheduling additional workspaces, marks pending workspaces as `pending`, sets `lastRun.status` to `paused`, and leaves any already-started Cursor process to complete normally because this phase has no daemon-level process supervisor.

## Watch and Progress Summary

`group watch` builds a `GroupProgressSnapshot` from canonical group persistence plus the phase-2 activity manager:

```typescript
interface GroupProgressSnapshot {
  readonly group: GroupRecord;
  readonly run?: GroupRunRecord;
  readonly totals: {
    readonly pending: number;
    readonly running: number;
    readonly waiting: number;
    readonly completed: number;
    readonly failed: number;
    readonly unknown: number;
  };
  readonly provenance: "group-store+activity";
  readonly updatedAt: string;
}
```

Activity mapping:

- `running` maps to workspace `running`.
- `waiting_trust` and `waiting_input` map to workspace `waiting`.
- `completed` maps to workspace `completed`.
- `failed` maps to workspace `failed`.
- `idle` keeps persisted workspace status unless no run evidence exists, then maps to `unknown`.

The summary is best-effort because Cursor does not expose a durable group execution table. JSON output must include provenance so callers know it was derived.

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/group/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/group/repository.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/group/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/group/repository.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to preserve:

- group records persist in a repository-owned JSON file
- pause/resume are durable group state changes
- delete removes a group by resolved identity
- group run refuses paused groups
- group run emits progress events for started, completed, failed, and group-completed states

Intentional Cursor divergences:

- This project stores workspace groups, not Codex session-id groups, so run progress is keyed by workspace and linked to Cursor session ids only after stream events reveal them.
- Cursor watch/progress is derived from local group state plus `P2-ACTIVITY` signals, not Codex rollout watcher events.
- This phase does not introduce a process supervisor, so pausing a group blocks new scheduling but does not kill in-flight `cursor-agent` processes.
- CLI output follows this repository's `--json` convention instead of Codex's `--format json|table`.

## Dependencies

- `P2-ACTIVITY`: completed activity derivation is required for watch/progress summaries.
- Existing phase-1 group persistence and CLI commands in `src/persistence/groups-store.ts` and `src/cli/cli.ts`.
- Cursor process and stream adapters remain the only modules that interpret raw Cursor output.

## Verification

Implementation should be verified with:

```bash
task typecheck
task test
task ci
bun run src/main.ts group pause example --json
bun run src/main.ts group resume example --json
bun run src/main.ts group watch example --once --json
```

Manual smoke commands require a pre-existing local group named `example`.

## Open Questions

- Should `group delete` require `--force` for completed or failed groups, or only for running groups?
- Should a later daemon phase add active cancellation for in-flight Cursor processes when a paused group is detected?

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-3-file-intelligence-and-orchestration-expansion`
- `design-docs/specs/design-activity.md`
- `impl-plans/active/group-lifecycle.md`
