# Activity Derivation Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
**Created**: 2026-05-05
**Last Updated**: 2026-05-05

---

## Design Document Reference

**Source**: `design-docs/specs/design-codex-agent-parity-gap.md`, `design-docs/specs/design-parity-backlog-workflow.md`, `design-docs/specs/architecture.md`

### Summary

Implement backlog slice `P2-ACTIVITY`: derive local session activity state from managed process state, transcript modification times, normalized stream events, and waiting conditions.

### Scope

**Included**: activity types, derivation service, optional local cache, CLI activity command, and tests.

**Excluded**: server SSE, daemon supervision, queue/group pause semantics, and persistent remote activity tables.

### Codex Reference Mapping

- `/Users/taco/gits/tacogips/codex-agent/src/activity/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.test.ts`

Intentional divergence: Cursor activity is derived best-effort from local process and transcript signals because Cursor has no durable activity table.

---

## Modules

### 1. Activity Types

#### `src/types/activity.ts`

**Status**: NOT_STARTED

```typescript
export type ActivityStatus = "idle" | "running" | "waiting_trust" | "waiting_input" | "completed" | "failed";

export interface ActivitySignal {
  readonly source: "process" | "transcript" | "stream" | "stderr" | "index";
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

- [ ] Define status values from the accepted design.
- [ ] Preserve Cursor identity fields.
- [ ] Include signal provenance for explainable derivation.

### 2. Activity Derivation Service

#### `src/activity/manager.ts`

**Status**: NOT_STARTED

```typescript
export interface ActivityManager {
  getSessionActivity(sessionId: string): Promise<SessionActivity | null>;
  listActivity(options?: ActivityListOptions): Promise<readonly SessionActivity[]>;
  recordStreamSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}
```

**Checklist**:

- [ ] Combine session index records with managed process state.
- [ ] Use transcript mtimes to distinguish idle and recently active sessions.
- [ ] Map trust and input waiting conditions from stream/stderr signals.
- [ ] Return `provenance: "derived"` for all records.

### 3. Activity Cache

#### `src/persistence/activity-store.ts`

**Status**: NOT_STARTED

```typescript
export interface ActivityStore {
  get(sessionId: string): Promise<readonly ActivitySignal[]>;
  append(sessionId: string, signal: ActivitySignal): Promise<void>;
  prune(before: string): Promise<number>;
}
```

**Checklist**:

- [ ] Persist only derived local signals needed across process boundaries.
- [ ] Keep cache absence non-fatal.
- [ ] Avoid treating cache as Cursor ground truth.

### 4. CLI Command

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent activity [--session <id>] [--status <status>] [--limit <n>] [--json]
```

**Checklist**:

- [ ] Add activity usage.
- [ ] Validate status and limit.
- [ ] Render status, updated time, session identity, and signal sources.

### 5. Tests and Verification

#### `src/activity/manager.test.ts`
#### `src/persistence/activity-store.test.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
describe("activity derivation", () => {
  // derived status and CLI contract tests
});
```

**Checklist**:

- [ ] Cover running, idle, waiting, completed, and failed derivations.
- [ ] Cover missing process/cache data as non-fatal.
- [ ] Cover CLI filtering and JSON output.

---

## Work Breakdown

### TASK-001: Activity Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/activity.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Status enum includes all accepted Cursor states.
- [ ] Signal provenance is represented.

### TASK-002: Activity Store

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/persistence/activity-store.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [ ] Store appends, reads, and prunes signals.
- [ ] Corrupt or missing cache states are handled.
- [ ] Tests use temporary local state.

### TASK-003: Activity Manager

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/activity/manager.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [ ] Manager derives status from process, transcript, stream, and index signals.
- [ ] Activity records include identity and provenance.
- [ ] Absence of optional signals returns best-effort activity.

### TASK-004: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [ ] `activity` command supports session/status/limit/json flags.
- [ ] Output is deterministic and tested.
- [ ] Existing session/group/queue commands remain unchanged.

### TASK-005: Test Coverage

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/activity/manager.test.ts`, `src/persistence/activity-store.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [ ] Unit tests cover status derivation and cache behavior.
- [ ] CLI tests cover validation and render contracts.
- [ ] `task typecheck`, `task test`, and `task ci` expectations are recorded.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Activity types | `src/types/activity.ts` | NOT_STARTED | - |
| Activity store | `src/persistence/activity-store.ts` | NOT_STARTED | `src/persistence/activity-store.test.ts` |
| Activity manager | `src/activity/manager.ts` | NOT_STARTED | `src/activity/manager.test.ts` |
| CLI command | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-ACTIVITY | Phase 1 process, stream, transcript, and session index foundation | Available |
| P3 group and queue lifecycle | P2-ACTIVITY | Blocked until complete |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts activity --json`
- Manual smoke: `bun run src/main.ts activity --session <id> --json`

## Completion Criteria

- [ ] Activity states derive from local process, transcript, stream, and index signals.
- [ ] Waiting trust/input states are represented when signals indicate them.
- [ ] Missing optional signals degrade to best-effort idle/completed/failed states.
- [ ] CLI exposes session and status filtered activity.
- [ ] All activity records identify provenance as derived.

## Progress Log

### Session: 2026-05-05 Step 3 Batch Planning

**Tasks Completed**: Created implementation plan for `P2-ACTIVITY`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan is ready for delegated implementation after batch review.

## Related Plans

- **Depends On**: `impl-plans/active/phase1-core-foundation.md`
- **Future**: `impl-plans/active/group-lifecycle.md`, `impl-plans/active/queue-lifecycle.md`, `impl-plans/active/sse.md`
