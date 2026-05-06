# Advanced Group Lifecycle Controls Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-group-lifecycle.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-group-lifecycle.md`

### Summary

Implement `P3-GROUP-LIFECYCLE`: add explicit Cursor-local group lifecycle state, backward-compatible group persistence, pause/resume/delete/watch commands, paused-run guards, and activity-derived latest-run progress summaries.

### Scope

**Included**: group lifecycle types, canonical group persistence with legacy load support, run progress persistence, `group pause`, `group resume`, `group delete`, `group watch`, run guards in `group run`, JSON/human output, and tests.

**Excluded**: queue lifecycle controls, server or daemon APIs, SDK exports, direct Cursor-managed file writes, and cancellation of already-started Cursor processes.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/group/types.ts`: reference group state, group run options, and group event shape.
- `/Users/taco/gits/tacogips/codex-agent/src/group/repository.ts`: reference durable JSON group storage, delete, pause, and resume behavior.
- `/Users/taco/gits/tacogips/codex-agent/src/group/manager.ts`: reference paused-run guard and progress event concepts.
- `/Users/taco/gits/tacogips/codex-agent/src/group/repository.test.ts`: reference persistence and lifecycle test coverage.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: reference CLI command names and user-facing lifecycle flow.

Intentional divergences:

- Cursor groups remain workspace based; run records link to Cursor session ids after stream events expose them.
- Watch summaries derive from `P2-ACTIVITY` signals plus group store state instead of Codex rollout files.
- Pause blocks new scheduling but does not terminate in-flight Cursor processes.
- This repository uses `--json`, not Codex `--format json|table`.

---

## Modules

### 1. Group Lifecycle Types

#### `src/types/group.ts`

**Status**: COMPLETED

```typescript
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

export interface GroupProgressSnapshot {
  readonly group: GroupRecord;
  readonly run?: GroupRunRecord;
  readonly totals: Record<GroupRunWorkspaceStatus, number>;
  readonly provenance: "group-store+activity";
  readonly updatedAt: string;
}
```

**Checklist**:

- [x] Define strict lifecycle, run, workspace progress, and snapshot types.
- [x] Export types from the package-local type surface used by persistence and CLI.
- [x] Avoid raw Cursor stream payload types in group domain types.

### 2. Backward-Compatible Group Store

#### `src/persistence/groups-store.ts`
#### `src/persistence/groups-store.test.ts`

**Status**: COMPLETED

```typescript
export interface GroupStoreUpdate {
  readonly lifecycleState?: GroupLifecycleState;
  readonly lastRun?: GroupRunRecord;
}

export async function listGroups(): Promise<readonly GroupRecord[]>;
export async function getGroup(name: string): Promise<GroupRecord | undefined>;
export async function createGroup(name: string): Promise<GroupRecord>;
export async function deleteGroup(name: string): Promise<GroupRecord | undefined>;
export async function pauseGroup(name: string): Promise<GroupRecord | undefined>;
export async function resumeGroup(name: string): Promise<GroupRecord | undefined>;
export async function updateGroupRun(
  name: string,
  update: GroupStoreUpdate,
): Promise<GroupRecord | undefined>;
```

**Checklist**:

- [x] Load legacy `{ name, workspaces }` rows as canonical active groups.
- [x] Persist canonical records with lifecycle state and timestamps.
- [x] Preserve add/remove workspace behavior and duplicate handling.
- [x] Add tests for legacy migration, pause, resume, delete, run update, and corrupt status tolerance.

### 3. Group Progress Derivation

#### `src/group/progress.ts`
#### `src/group/progress.test.ts`

**Status**: COMPLETED

```typescript
export interface GroupProgressDependencies {
  readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
  readonly now: () => string;
}

export async function deriveGroupProgressSnapshot(
  group: GroupRecord,
  deps: GroupProgressDependencies,
): Promise<GroupProgressSnapshot>;
```

**Checklist**:

- [x] Map activity statuses to workspace progress statuses.
- [x] Preserve persisted run status when no session id or activity signal exists.
- [x] Produce stable totals and `provenance: "group-store+activity"`.
- [x] Cover no-run, partial-run, waiting, failed, completed, and idle fallback cases.

### 4. Group CLI Lifecycle Commands

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
curort-cli-agent group pause <name> [--json]
curort-cli-agent group resume <name> [--json]
curort-cli-agent group delete <name> [--force] [--json]
curort-cli-agent group watch <name> [--interval <seconds>] [--once] [--json]
```

**Checklist**:

- [x] Add usage text and subcommand dispatch for pause, resume, delete, and watch.
- [x] Return not-found, usage, and JSON responses consistently with existing CLI conventions.
- [x] Reject deleting a running latest run unless `--force` is set.
- [x] Implement one-shot and polling watch output for human and JSON modes.

### 5. Group Run Guard and Progress Recording

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
interface GroupRunRecorder {
  startRun(groupName: string, prompt: string): Promise<GroupRunRecord>;
  markWorkspaceStarted(groupName: string, workspace: string): Promise<void>;
  markWorkspaceSession(
    groupName: string,
    workspace: string,
    sessionId: string,
  ): Promise<void>;
  markWorkspaceFinished(
    groupName: string,
    workspace: string,
    exitCode: number | null,
  ): Promise<void>;
  finishRun(groupName: string, status: GroupRunStatus): Promise<void>;
}
```

**Checklist**:

- [x] Refuse `group run` before launching Cursor when the group is paused.
- [x] Re-read lifecycle before each workspace and stop scheduling when paused mid-run.
- [x] Persist latest run workspace status as sessions start, reveal ids, and finish.
- [x] Set final lifecycle to completed or failed after the run exits.

### 6. Verification and Documentation Alignment

#### `src/persistence/groups-store.test.ts`
#### `src/group/progress.test.ts`
#### `src/cli/cli.test.ts`

**Status**: PARTIAL

```typescript
describe("group lifecycle controls", () => {
  // persistence, CLI, guard, and progress derivation tests
});
```

**Checklist**:

- [x] Cover JSON and human output for lifecycle commands.
- [x] Cover paused-run guards and mid-run pause behavior.
- [x] Cover activity-derived watch snapshots and no-history output.
- [x] Run `task typecheck`, `task test`, and `task ci`.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Group lifecycle types | `src/types/group.ts` | COMPLETED | - |
| Group store | `src/persistence/groups-store.ts` | COMPLETED | `src/persistence/groups-store.test.ts` |
| Group progress | `src/group/progress.ts` | COMPLETED | `src/group/progress.test.ts` |
| CLI lifecycle commands | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Run guard and progress recording | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| `P3-GROUP-LIFECYCLE` | `P2-ACTIVITY` | Completed |
| Group watch snapshots | Activity manager API | Ready |
| Run progress recording | Existing group run and stream normalizer hooks | Ready |

## Work Breakdown

### TASK-001: Group Lifecycle Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/group.ts`
**Dependencies**: None

**Description**:
Define the group lifecycle, latest-run, workspace progress, and watch snapshot type surface.

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Type names match the design document.
- [x] Domain types do not import Cursor adapter payloads.

### TASK-002: Group Store Lifecycle Persistence

**Status**: Completed
**Parallelizable**: Yes, after TASK-001; disjoint from TASK-003
**Deliverables**: `src/persistence/groups-store.ts`, `src/persistence/groups-store.test.ts`
**Dependencies**: TASK-001

**Description**:
Extend group storage with canonical lifecycle records while loading legacy records safely.

**Completion Criteria**:

- [x] Legacy records load as `active` groups.
- [x] Pause, resume, delete, and run updates persist canonical state.
- [x] Existing create/list/show/add/remove behavior remains compatible.
- [x] Store tests cover migration and lifecycle mutations.

### TASK-003: Group Progress Snapshot Derivation

**Status**: Completed
**Parallelizable**: Yes, after TASK-001; disjoint from TASK-002
**Deliverables**: `src/group/progress.ts`, `src/group/progress.test.ts`
**Dependencies**: TASK-001

**Description**:
Derive latest-run watch snapshots from group run state and `P2-ACTIVITY` session activity.

**Completion Criteria**:

- [x] Activity statuses map to workspace progress statuses.
- [x] Missing activity falls back to persisted run state.
- [x] Snapshot totals and provenance are stable.
- [x] Tests cover no-run, running, waiting, completed, failed, and idle cases.

### TASK-004: Group Lifecycle CLI Commands

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-002, TASK-003

**Description**:
Add `group pause`, `group resume`, `group delete`, and `group watch` with JSON and human output.

**Completion Criteria**:

- [x] Usage and dispatch include all new subcommands.
- [x] Not-found, usage, and delete-running guards return stable exit codes.
- [x] JSON output is parseable and human output is concise.
- [x] Watch supports `--once`, positive `--interval`, and polling mode.

### TASK-005: Group Run Guard and Progress Recording

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-002, TASK-004

**Description**:
Integrate lifecycle guards and latest-run updates into existing `group run`.

**Completion Criteria**:

- [x] Paused groups refuse runs before Cursor is launched.
- [x] Mid-run pauses stop scheduling additional workspaces.
- [x] Latest-run records capture workspace status, discovered session ids, timestamps, and exit codes.
- [x] Final group lifecycle becomes `completed` or `failed` based on workspace results.

### TASK-006: End-to-End Verification

**Status**: Partial
**Parallelizable**: No
**Deliverables**: Verification run notes, `README.md`, `.divedra/README.md`, `.agents/skills/divedra-impl-workflow/SKILL.md`
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run focused and full project checks after TypeScript implementation, then refresh README and user-facing workflow-skill documentation before final verification.

**Completion Criteria**:

- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.
- [ ] `README.md`, `.divedra/README.md`, and `.agents/skills/divedra-impl-workflow/SKILL.md` document the delivered group lifecycle controls.
- [x] Manual smoke commands are recorded:
  `bun run src/main.ts group pause example --json`,
  `bun run src/main.ts group resume example --json`,
  `bun run src/main.ts group watch example --once --json`.

## Completion Criteria

- [x] All modules implemented.
- [x] Legacy group records remain readable.
- [x] Paused groups cannot start new runs.
- [x] Watch snapshots derive progress from group state plus activity.
- [x] JSON and human CLI outputs are tested.
- [ ] README and workflow-skill documentation are refreshed.
- [x] Type checking, tests, and CI pass.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started by this workflow node.
**Notes**: `P2-ACTIVITY` is the required cross-feature dependency for watch/progress summaries. Later implementation sessions must update task statuses, checklists, verification results, and any remaining blockers here before completion.

### Session: 2026-05-06 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, and verification portions of TASK-006.
**Tasks In Progress**: TASK-006 documentation refresh remains partial because `.agents/skills/divedra-impl-workflow/SKILL.md` was not writable in the current sandbox.
**Blockers**: `.agents/skills/divedra-impl-workflow/SKILL.md` update was rejected by filesystem permissions even though README.md and .divedra/README.md were refreshed.
**Notes**: Implemented canonical group lifecycle types, backward-compatible group store migration, group progress derivation, pause/resume/delete/watch CLI commands, paused pre-run and mid-run scheduling guards, latest-run persistence, and focused tests. Verification passed: `task typecheck`, `task test`, `task ci`, and temporary-data smoke commands for `group pause example --json`, `group resume example --json`, and `group watch example --once --json`.

### Session: 2026-05-06 Step 7 Revision

**Tasks Completed**: Addressed Step 7 mid findings for in-flight session-id persistence and missing mid-run pause test coverage.
**Tasks In Progress**: TASK-006 workflow-skill refresh remains blocked by filesystem permissions.
**Blockers**: `.agents/skills/divedra-impl-workflow/SKILL.md` is still not writable; `touch` and `chmod` both failed with `Operation not permitted`.
**Notes**: Added ordered group-run write chaining so discovered session ids are persisted while the stream is still active, added a focused mid-run pause scheduling test that verifies only the first workspace launches and the second remains pending, and reran `task typecheck`, `task test`, and `task ci` successfully.

## Addressed Review Feedback

- Step 3 accepted the design with no high or mid findings.
- Step 5 mid finding on missing documentation refresh deliverables was addressed in TASK-006.
- Low finding: open questions remain in `design-docs/specs/design-group-lifecycle.md#open-questions` instead of `design-docs/user-qa/`; no plan change is required because the current delete guard and pause behavior are already specified for implementation.
- Step 7 mid finding on in-flight session-id persistence was addressed by ordered group-run write chaining in `src/cli/cli.ts`.
- Step 7 mid finding on mid-run pause test coverage was addressed in `src/cli/cli.test.ts`.
- Step 7 mid finding on `.agents/skills/divedra-impl-workflow/SKILL.md` remains blocked by filesystem permissions and is documented in TASK-006.

## Related Plans

- **Depends On**: completed `P2-ACTIVITY` implementation.
- **Scope Link**: `design-docs/specs/design-group-lifecycle.md`.
