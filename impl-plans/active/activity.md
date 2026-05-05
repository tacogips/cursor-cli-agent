# Activity Derivation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-activity.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-05

---

## Design Document Reference

**Source**: `design-docs/specs/design-activity.md`

### Summary

Implement backlog slice `P2-ACTIVITY`: derive best-effort local Cursor session activity from the session index, managed process observations, normalized stream events, stderr/stdout waiting patterns, transcript metadata, and optional repository-owned signal cache entries.

### Scope

**Included**: activity status/signal types, deterministic derivation service, optional local signal cache, process/stream signal recording hooks for wrapper-started runs, `activity` CLI command, and focused tests for derivation, fallback, filtering, and JSON output.

**Excluded**: server routes, SSE, daemon supervision, SDK exports, remote activity tables, group/queue pause-resume lifecycle semantics, and mutation of Cursor transcript files or Cursor-managed internal state.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/activity/types.ts`: reference `ActivityStatus` and activity entry shape.
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.ts`: deterministic rollout-line status derivation and unknown-session `null` lookup behavior.
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.test.ts`: tests for running, waiting approval, and failed derivation.
- `/Users/taco/gits/tacogips/codex-agent/src/activity/index.ts`: activity API export pattern.
- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`: local session lookup fallback pattern.

Intentional divergences accepted by the design:

- Cursor activity is marked `provenance: "derived"` because Cursor has no durable activity table.
- Cursor derives from session index rows, transcript mtimes, managed process state, stream events, and stderr/stdout patterns instead of Codex rollout events.
- Codex `waiting_approval` maps to Cursor-specific `waiting_trust` and `waiting_input` states.
- Cursor records include ordered signal provenance so callers can understand why a status was selected.

---

## Modules

### 1. Activity Types

#### `src/types/activity.ts`

**Status**: COMPLETED

```typescript
export type ActivityStatus =
  | "idle"
  | "running"
  | "waiting_trust"
  | "waiting_input"
  | "completed"
  | "failed";

export type ActivitySignalSource =
  | "process"
  | "transcript"
  | "stream"
  | "stderr"
  | "stdout"
  | "index";

export interface ActivitySignal {
  readonly source: ActivitySignalSource;
  readonly status: ActivityStatus;
  readonly observedAt: string;
  readonly detail?: string;
}

export interface SessionActivity {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
  readonly signals: readonly ActivitySignal[];
  readonly provenance: "derived";
}
```

**Checklist**:

- [x] Export strict activity status and signal provenance types.
- [x] Preserve local session and Cursor chat identity fields.
- [x] Include `provenance: "derived"` on every activity record.

### 2. Activity Signal Store

#### `src/persistence/activity-store.ts`

**Status**: COMPLETED

```typescript
export interface ActivityStore {
  getSignals(sessionId: string): Promise<readonly ActivitySignal[]>;
  appendSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
  pruneSignals(before: string): Promise<number>;
}
```

**Checklist**:

- [x] Persist only repository-owned derived signals for cross-process continuity.
- [x] Treat missing, corrupt, or stale cache entries as non-fatal.
- [x] Keep cache records separate from Cursor-managed files.

### 3. Activity Derivation Service

#### `src/activity/manager.ts`

**Status**: COMPLETED

```typescript
export interface ActivityListOptions {
  readonly status?: ActivityStatus;
  readonly limit?: number;
}

export interface ActivityManager {
  getSessionActivity(sessionId: string): Promise<SessionActivity | null>;
  listActivity(options?: ActivityListOptions): Promise<readonly SessionActivity[]>;
  recordSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}
```

**Checklist**:

- [x] Resolve sessions through `SessionIndexRepository` by local session id or Cursor chat id.
- [x] Combine index rows, transcript mtimes, stored signals, and wrapper managed-process observations.
- [x] Apply design priority: active process, waiting signals, failure/completion, transcript/index, idle fallback.
- [x] Apply same-timestamp tie-breaker: `failed`, `waiting_trust`, `waiting_input`, `running`, `completed`, `idle`.

### 4. Cursor Signal Capture

#### `src/cursor/activity-signals.ts`
#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
export interface ActivitySignalClassifier {
  classifyStreamEvent(event: AgentEvent): ActivitySignal | null;
  classifyProcessResult(exitCode: number | null, stderr?: string): ActivitySignal | null;
}
```

**Checklist**:

- [x] Classify trust gating, interactive input waits, completion, failure, and running observations from normalized signals.
- [x] Record signals for `session run`, `session resume`, `session continue`, `group run`, and `queue run` executions started by this wrapper.
- [x] Keep raw Cursor payload parsing inside cursor/adapter-facing modules.

### 5. Activity CLI

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
curort-cli-agent activity [--session <id>] [--status <status>] [--limit <n>] [--json]
```

**Checklist**:

- [x] Add top-level `activity` command and usage text.
- [x] Validate supported statuses and positive integer `--limit`.
- [x] Return existing session-not-found behavior for unknown `--session` values.
- [x] Render human output with status, updated time, identity, and signal sources.
- [x] Render stable JSON records with `provenance: "derived"` and full signal details.

### 6. Tests

#### `src/activity/manager.test.ts`
#### `src/persistence/activity-store.test.ts`
#### `src/cursor/activity-signals.test.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
describe("activity derivation", () => {
  // status priority, fallback, CLI, and cache behavior tests
});
```

**Checklist**:

- [x] Cover `running`, `waiting_trust`, `waiting_input`, `completed`, `failed`, and `idle`.
- [x] Cover same-timestamp tie-breaking and ordered signal provenance.
- [x] Cover missing/corrupt optional cache as best-effort behavior.
- [x] Cover `activity` CLI JSON, human output, `--session`, `--status`, and `--limit` validation.

---

## Work Breakdown

### TASK-001: Activity Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/activity.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Status set exactly matches `design-activity.md`.
- [x] Signal source and derived provenance are represented.

### TASK-002: Activity Signal Store

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/persistence/activity-store.ts`, `src/persistence/activity-store.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Store appends, reads, and prunes signals keyed by local session or chat id.
- [x] Missing/corrupt cache state does not fail activity listing or lookup.
- [x] Tests use temporary state paths and do not touch Cursor-managed directories.

### TASK-003: Cursor Signal Classifier and Recording Hooks

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/activity-signals.ts`, `src/cursor/activity-signals.test.ts`, targeted updates in `src/cli/cli.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Classifier maps normalized stream/process/stderr/stdout evidence to activity signals.
- [x] Wrapper-started session/group/queue runs record running, waiting, completed, and failed signals.
- [x] Cursor-specific raw signal interpretation stays out of persistence and domain types.

### TASK-004: Activity Derivation Manager

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/activity/manager.ts`, `src/activity/manager.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [x] Manager derives status from process/cache, transcript mtime, and session index evidence.
- [x] Unknown session lookup returns `null` for manager API and maps to existing CLI not-found behavior.
- [x] Records include identity fields, ordered signals, `updatedAt`, and `provenance: "derived"`.
- [x] Priority and same-timestamp tie-breaker match the accepted design.

### TASK-005: Activity CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Completion Criteria**:

- [x] `activity` supports `--session`, `--status`, `--limit`, and `--json`.
- [x] List mode supports status filtering and bounded results.
- [x] Human and JSON renderers expose signal provenance without changing existing command behavior.

### TASK-006: Documentation and Workflow Refresh

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md` and any user-facing workflow/skill docs required by the implementation workflow review step
**Dependencies**: TASK-005

**Completion Criteria**:

- [x] User-facing command docs include the `activity` command contract.
- [x] Post-implementation README and workflow-skill refresh expectations are satisfied before final commit-message generation.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Activity types | `src/types/activity.ts` | COMPLETED | Typecheck |
| Activity signal store | `src/persistence/activity-store.ts` | COMPLETED | `src/persistence/activity-store.test.ts` |
| Cursor signal classifier | `src/cursor/activity-signals.ts` | COMPLETED | `src/cursor/activity-signals.test.ts` |
| Activity manager | `src/activity/manager.ts` | COMPLETED | `src/activity/manager.test.ts` |
| Activity CLI | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| User-facing docs | `README.md` | COMPLETED | Manual review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-ACTIVITY | Phase 1 session index, process runner, stream normalizer, transcript reader | Available |
| TASK-002 | TASK-001 | Completed |
| TASK-003 | TASK-001, TASK-002 | Completed |
| TASK-004 | TASK-001, TASK-002, TASK-003 | Completed |
| TASK-005 | TASK-004 | Completed |
| TASK-006 | TASK-005 | Completed |

## Parallelizable Tasks

- TASK-001 can be implemented first independently.
- No later tasks are marked parallelizable because their write scopes either depend on the new shared activity types/store or converge on `src/cli/cli.ts`.

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts activity --json`
- Manual smoke: `bun run src/main.ts activity --session <id> --json`
- Manual smoke: `bun run src/main.ts activity --status running --limit 3 --json`

## Completion Criteria

- [x] Activity records are derived from local process, stream, stderr/stdout, transcript, and index signals.
- [x] `running`, `waiting_trust`, `waiting_input`, `completed`, `failed`, and `idle` derivation is deterministic and tested.
- [x] Missing optional signal sources degrade to best-effort records instead of command failure.
- [x] `activity` CLI supports lookup, filtering, limiting, human output, and JSON output.
- [x] Every record includes ordered signals and `provenance: "derived"`.
- [x] Cursor-managed transcript and skill directories remain read-only.
- [x] `task typecheck`, `task test`, and `task ci` pass before final workflow commit.

## Progress Log

### Session: 2026-05-05 Step 4 Implementation Plan Creation

**Tasks Completed**: Revised `P2-ACTIVITY` implementation plan after Step 3 accepted `design-docs/specs/design-activity.md`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan is scoped to the single backlog slice and traces behavior to `/Users/taco/gits/tacogips/codex-agent/src/activity/*` plus the Cursor-specific divergences accepted in the design.

### Session: 2026-05-05 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, and TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `task typecheck`, `task test`, and `task ci` passed. Manual smokes passed with `CURORT_CLI_AGENT_DATA_DIR=/private/tmp/curort-activity-smoke`: `bun run src/main.ts activity --limit 1 --json`, `bun run src/main.ts activity --session e20f0aa8-2eb1-48e2-9e6f-251ca8d47776 --json`, and `bun run src/main.ts activity --status running --limit 3 --json`.
**Notes**: Implemented derived activity types, cache, classifier, manager, CLI integration, wrapper-run signal recording, README command documentation, and focused test coverage. The default-data-dir manual smoke was blocked by sandbox write restrictions to `/Users/taco/.local/share/curort-cli-agent`, so the same command path was verified with the repository-supported data-dir override under `/private/tmp`.

### Session: 2026-05-05 Step 6 Review Revision

**Tasks Completed**: Addressed Step 7 high finding from `comm-000008` by changing activity selection so later dynamic terminal signals override stale dynamic running signals, and added regression coverage for completed-after-running and failed-after-running cases.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `bun test src/activity/manager.test.ts`, `task typecheck`, `task test`, and `task ci` passed. Manual smokes passed with `CURORT_CLI_AGENT_DATA_DIR=/private/tmp/curort-activity-smoke`: `bun run src/main.ts activity --limit 1 --json`, `bun run src/main.ts activity --session e20f0aa8-2eb1-48e2-9e6f-251ca8d47776 --json`, and `bun run src/main.ts activity --status running --limit 3 --json`.
**Notes**: The activity implementation remains aligned with `design-docs/specs/design-activity.md`: running wins only when it is the latest dynamic evidence; later process or stream completion/failure now becomes the selected status and `updatedAt` source. Unrelated `divedra` submodule working-tree state is outside the `P2-ACTIVITY` write scope.

### Session: 2026-05-05 Step 6 Review Revision for comm-000010

**Tasks Completed**: Addressed Step 7 mid findings from `comm-000010`: newer index terminal status now overrides stale cached dynamic process/stream/stderr/stdout signals, and stdout wait-pattern evidence is now carried from `src/cursor/process-runner.ts` into `src/cli/cli.ts` process-result activity recording.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `bun test src/activity/manager.test.ts src/cursor/activity-signals.test.ts src/cursor/process-runner.test.ts`, `task typecheck`, `task test`, and `task ci` passed.
**Notes**: Added regression coverage for stale cached process running versus later index completed evidence, stdout process-result classification, and raw stdout preservation from `runHeadlessStreaming`. The dirty `divedra` submodule state remains unrelated to `P2-ACTIVITY` and was not modified in this revision.

### Session: 2026-05-05 Step 6 Review Revision for comm-000012

**Tasks Completed**: Addressed the latest Step 7 review rerun context by hardening the optional derived activity signal cache boundary: cache read failures now degrade to index/transcript-derived signals, and cache write failures from wrapper-run signal recording no longer fail activity manager calls.
**Tasks In Progress**: None.
**Blockers**: The local artifact roots did not contain the full `comm-000012` payload for this execution; revision used the visible Step 7 `needs_revision` decision plus the accepted design requirement that the optional cache must remain best-effort.
**Verification**: `bun test src/activity/manager.test.ts`, `task typecheck`, `task test`, and `task ci` passed.
**Notes**: Added regression coverage with a failing `ActivityStore` to confirm `recordSignal` resolves and `getSessionActivity` still returns index-derived activity when cache persistence is unavailable. The dirty `divedra` submodule state remains unrelated to `P2-ACTIVITY` and was not modified in this revision.

## Related Plans

- **Depends On**: `impl-plans/active/phase1-core-foundation.md`
- **Related**: `impl-plans/active/transcript-search.md`, `impl-plans/active/session-search.md`
- **Future**: group/queue lifecycle and SSE plans when those backlog slices are active
