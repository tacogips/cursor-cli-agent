# Repository-Owned Usage Event Persistence Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-usage-event-persistence.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Design Document Reference

**Source**: `design-docs/specs/design-usage-event-persistence.md`

### Summary

Implement `P5-USAGE-EVENT-PERSISTENCE`: persist normalized Cursor usage events observed during wrapper-started runs so usage stats can aggregate token totals from repository-owned evidence instead of reporting false zeroes or ambiguous missing-source notes.

### Scope

**Included**: usage event types, repository-owned usage event store, normalized event extraction, capture hooks for session/group/queue wrapper runs, usage stats aggregation and CLI output, and focused tests.

**Excluded**: runtime implementation in this design-plan branch, Cursor-owned file mutation, cloud billing reconciliation, server routes, SDK exports, daemon supervision, and historical token inference for non-wrapper sessions.

### Dependencies

- `P1-CORE-FOUNDATION`: normalized `AgentEvent`, stream normalizer, process runner, session index, group/queue run flows, and data-dir helpers.
- `P2-ACTIVITY`: established wrapper-run capture pattern and non-fatal repository-owned signal persistence.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/sdk/usage-stats.ts`: model/daily aggregation, cache tolerance, token usage normalization, and cumulative token delta handling.
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/usage-stats.test.ts`: fixture coverage for missing source, mixed usage shapes, repeated events, cumulative deltas, model fallback, and daily buckets.
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`: streaming session lifecycle and event forwarding pattern.
- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`: subprocess JSONL streaming boundary.

Intentional divergences:

- Cursor usage persistence captures normalized live stream events because Cursor transcripts may not retain usage totals.
- Stats claim completeness only for repository-owned usage event evidence, not all Cursor historical sessions.
- Raw Cursor payload parsing remains adapter-local; persistence stores stable domain records.

## Modules

### 1. Usage Event Types

#### `src/types/usage-event.ts`
#### `src/types/agent-event.ts`

**Status**: NOT_STARTED

```typescript
export type UsageEventSource = "stream_result";

export interface UsageTokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
}

export interface UsageEventRecord extends UsageTokenTotals {
  readonly eventId: string;
  readonly sessionId: string;
  readonly recordId?: string;
  readonly cursorChatId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly model: string;
  readonly observedAt: string;
  readonly source: UsageEventSource;
  readonly provenance: "repository_usage_events";
}
```

**Checklist**:

- [ ] Define strict normalized usage event records.
- [ ] Keep token fields non-negative and explicit.
- [ ] Align `UsageStats` naming with current `AgentEvent` usage shape or add a compatible adapter type.

### 2. Usage Event Store

#### `src/persistence/usage-event-store.ts`
#### `src/config/paths.ts`

**Status**: NOT_STARTED

```typescript
export interface UsageEventStore {
  listEvents(options?: UsageEventListOptions): Promise<readonly UsageEventRecord[]>;
  upsertEvent(event: UsageEventRecord): Promise<void>;
}

export interface UsageEventListOptions {
  readonly sessionId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly since?: string;
  readonly until?: string;
}

export function usageEventsJsonPath(): string;
```

**Checklist**:

- [ ] Store events under repository-owned `getDataDir()` state.
- [ ] Upsert by `eventId` so duplicate stream/result observations are idempotent.
- [ ] Treat missing or corrupt store content as empty recoverable state.
- [ ] Sort reads by `observedAt`, then `eventId`.

### 3. Usage Capture Adapter

#### `src/cursor/usage-events.ts`

**Status**: NOT_STARTED

```typescript
export interface UsageEventContext {
  readonly sessionId: string;
  readonly recordId?: string;
  readonly cursorChatId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly model?: string;
  readonly observedAt: string;
}

export interface UsageEventExtractor {
  fromAgentEvent(event: AgentEvent, context: UsageEventContext): UsageEventRecord | null;
}
```

**Checklist**:

- [ ] Convert only normalized `AgentEvent` usage into persisted usage events.
- [ ] Ignore events with no positive token evidence.
- [ ] Resolve model from event usage, stream start context, or `unknown`.
- [ ] Generate stable event ids from session id, source, timestamp, and token payload hash.

### 4. Wrapper Capture Hooks

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
interface UsageCaptureSessionContext {
  readonly sessionId: string;
  readonly recordId?: string;
  readonly cursorChatId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly model?: string;
}

interface UsageWriteQueue {
  enqueue(event: UsageEventRecord | null): void;
  flush(): Promise<void>;
}
```

**Checklist**:

- [ ] Capture usage for `session run`, `session resume`, and `session continue`.
- [ ] Capture usage for each child session in `group run` and `queue run`.
- [ ] Reuse the activity capture write-chain pattern so persistence is ordered and non-fatal.
- [ ] Preserve existing Cursor process exit codes when usage persistence fails.

### 5. Usage Stats Aggregation and CLI

#### `src/usage/usage-stats.ts`
#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
export interface UsageStatsOptions {
  readonly workspacePath?: string;
  readonly sessionId?: string;
  readonly recentDays?: number;
  readonly now?: Date;
}

export interface UsageStatsResult {
  readonly totalSessionsWithUsage: number;
  readonly totalTokens: UsageTokenTotals;
  readonly modelUsage: Record<string, UsageTokenTotals>;
  readonly recentDailyActivity: readonly UsageDailyActivity[];
  readonly coverage: UsageEvidenceCoverage;
  readonly provenance: "repository_usage_events";
}

export interface UsageEvidenceCoverage {
  readonly sessionsWithUsageEvents: number;
  readonly knownSessionsWithoutUsageEvents: number;
  readonly wrapperStartedSessionsWithoutUsageEvents: number;
}

export interface UsageDailyActivity {
  readonly date: string;
  readonly tokensByModel?: Record<string, number>;
}
```

**Checklist**:

- [ ] Aggregate totals by model and recent day from persisted events.
- [ ] Filter by workspace and session identity.
- [ ] Return explicit coverage instead of false zero certainty.
- [ ] Add or align `usage stats [--workspace] [--session] [--recent-days] [--json]` CLI behavior.

### 6. Tests and Documentation Refresh

#### `src/persistence/usage-event-store.test.ts`
#### `src/cursor/usage-events.test.ts`
#### `src/usage/usage-stats.test.ts`
#### `src/cli/cli.test.ts`
#### `README.md`

**Status**: NOT_STARTED

```typescript
describe("repository-owned usage events", () => {
  // persistence, extraction, aggregation, CLI, and coverage tests
});
```

**Checklist**:

- [ ] Cover missing and corrupt usage stores.
- [ ] Cover idempotent duplicate event writes.
- [ ] Cover aggregation by model, daily buckets, workspace, and session.
- [ ] Cover wrapper-started run capture with normalized completion usage.
- [ ] Cover CLI JSON coverage and provenance fields.
- [ ] Refresh user-facing docs for the usage stats command.

---

## Work Breakdown

### TASK-001: Usage Event Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/usage-event.ts`, targeted type alignment in `src/types/agent-event.ts`
**Dependencies**: P1-CORE-FOUNDATION

**Description**:
Define stable normalized usage event records and token totals used by persistence, capture, and aggregation.

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Token field names align with existing normalized `UsageStats`.
- [ ] Domain types contain no raw Cursor payload shapes.

### TASK-002: Usage Event Store

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/usage-event-store.ts`, `src/persistence/usage-event-store.test.ts`, `src/config/paths.ts`
**Dependencies**: TASK-001

**Description**:
Persist repository-owned usage events with atomic writes, idempotent upsert, deterministic reads, and corrupt-store tolerance.

**Completion Criteria**:

- [ ] Missing store returns an empty list.
- [ ] Corrupt store does not crash callers.
- [ ] Duplicate `eventId` writes do not double count.
- [ ] Tests use temporary data paths and do not touch Cursor-owned directories.

### TASK-003: Normalized Usage Event Extraction

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/usage-events.ts`, `src/cursor/usage-events.test.ts`
**Dependencies**: TASK-001

**Description**:
Convert normalized completion events plus session context into durable usage event records.

**Completion Criteria**:

- [ ] `session.completed` events with positive usage become `UsageEventRecord` values.
- [ ] Missing usage or all-zero usage returns `null`.
- [ ] Model fallback and stable event id generation are tested.
- [ ] Raw Cursor payload parsing remains outside persistence and CLI code.

### TASK-004: Wrapper Run Usage Capture

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: targeted updates in `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-002, TASK-003, P2-ACTIVITY

**Description**:
Record usage events for wrapper-started session, group, and queue runs using the same ordered non-fatal capture pattern as activity signals.

**Completion Criteria**:

- [ ] `session run`, `session resume`, and `session continue` persist observed completion usage.
- [ ] `group run` and `queue run` persist per-child-session usage.
- [ ] Usage persistence failure does not change Cursor process exit behavior.
- [ ] Tests assert usage capture through representative wrapper flows.

### TASK-005: Usage Stats Aggregation and CLI

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/usage/usage-stats.ts`, targeted updates in `src/cli/cli.ts`, `src/usage/usage-stats.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-002, TASK-004

**Description**:
Aggregate persisted usage event evidence into user-facing usage stats with explicit coverage and provenance.

**Completion Criteria**:

- [ ] Aggregates input, output, cache-read, cache-write, and total tokens.
- [ ] Groups totals by model and recent day.
- [ ] Supports workspace, session, and recent-days filters.
- [ ] JSON output exposes `provenance: "repository_usage_events"` and coverage counts.
- [ ] Empty evidence does not imply all known sessions consumed zero tokens.

### TASK-006: Documentation and Workflow Refresh

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `README.md`, implementation plan progress updates
**Dependencies**: TASK-005

**Description**:
Refresh user-facing usage stats documentation and mark implementation progress after verification.

**Completion Criteria**:

- [ ] README documents usage stats command, filters, coverage, and provenance.
- [ ] Progress log records implementation verification.
- [ ] Plan status and checklists are updated after all tests pass.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Usage event types | `src/types/usage-event.ts` | NOT_STARTED | Typecheck |
| Usage event store | `src/persistence/usage-event-store.ts` | NOT_STARTED | `src/persistence/usage-event-store.test.ts` |
| Usage event extractor | `src/cursor/usage-events.ts` | NOT_STARTED | `src/cursor/usage-events.test.ts` |
| Wrapper capture hooks | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |
| Usage stats aggregator | `src/usage/usage-stats.ts` | NOT_STARTED | `src/usage/usage-stats.test.ts` |
| User-facing docs | `README.md` | NOT_STARTED | Manual review |

## Dependency Table

| Feature or Task | Depends On | Status |
|-----------------|------------|--------|
| P5-USAGE-EVENT-PERSISTENCE | P1-CORE-FOUNDATION, P2-ACTIVITY | Ready after dependencies remain available |
| TASK-001 | P1-CORE-FOUNDATION | Ready |
| TASK-002 | TASK-001 | Blocked |
| TASK-003 | TASK-001 | Blocked |
| TASK-004 | TASK-002, TASK-003, P2-ACTIVITY | Blocked |
| TASK-005 | TASK-002, TASK-004 | Blocked |
| TASK-006 | TASK-005 | Blocked |

## Parallelizable Tasks

- TASK-001 is parallelizable after `P1-CORE-FOUNDATION`.
- TASK-002 and TASK-003 can run in parallel after TASK-001 if write ownership is split between `src/persistence/*` and `src/cursor/*`.
- TASK-004, TASK-005, and TASK-006 are sequential because they converge on CLI behavior and depend on persisted capture.

## Verification

- `task typecheck`
- `task test`
- `task ci`
- `bun test src/persistence/usage-event-store.test.ts src/cursor/usage-events.test.ts src/usage/usage-stats.test.ts src/cli/cli.test.ts`
- `bun run src/main.ts usage stats --json`
- `bun run src/main.ts usage stats --recent-days 7 --json`
- `bun run src/main.ts usage stats --session <id> --json`

## Completion Criteria

- [ ] Wrapper-started session, group, and queue runs persist normalized usage events when Cursor emits usage.
- [ ] Duplicate or retried stream observations do not double count token totals.
- [ ] Usage stats aggregate model and daily token totals from repository-owned evidence.
- [ ] Empty or missing evidence is represented as partial or absent coverage, not as complete zero usage.
- [ ] Cursor-managed transcripts, worker logs, skill directories, and `ai-tracking` DB remain read-only.
- [ ] `task typecheck`, `task test`, and `task ci` pass before implementation completion.

## Progress Log

### Session: 2026-05-06 Step 3 Feature Design Plan

**Tasks Completed**: Authored design document and implementation plan for `P5-USAGE-EVENT-PERSISTENCE`.
**Tasks In Progress**: None. **Blockers**: None.
**Verification**: Documentation-only validation by reading assigned skills, mailbox-selected feature input, codex-agent references, existing activity plan, stream normalizer, activity store, CLI capture hooks, and local architecture notes.
**Notes**: No runtime code was implemented. No latest review payload was attached for this pass. Plan maps Codex rollout usage aggregation to Cursor wrapper-started normalized event capture and repository-owned persistence, with `P1-CORE-FOUNDATION` and `P2-ACTIVITY` as explicit dependencies.
