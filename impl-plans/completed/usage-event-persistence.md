# Repository-Owned Usage Event Persistence Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-usage-event-persistence.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-09

## Design Document Reference

**Source**: `design-docs/specs/design-usage-event-persistence.md`

### Summary

Implement `P5-USAGE-EVENT-PERSISTENCE`: persist normalized Cursor usage events observed during wrapper-started runs so usage stats can aggregate token totals from repository-owned evidence instead of reporting false zeroes or ambiguous missing-source notes.

### Scope

**Included**: usage event types, repository-owned usage event store, normalized event extraction, capture hooks for session/group/queue wrapper runs, usage stats aggregation and CLI output, and focused tests.

**Excluded**: mutating Cursor-owned transcripts or internal state, cloud billing reconciliation, new first-class HTTP routes dedicated to this slice, daemon supervision, and inferring exact token usage for sessions not started by this wrapper. SDK changes are limited to shared types, mock defaults, and existing `tools.usageStats` wiring; there is no separate published usage-event module beyond this repository.

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

**Status**: Completed

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

- [x] Define strict normalized usage event records.
- [x] Keep token fields non-negative and explicit.
- [x] Align `UsageStats` naming with current `AgentEvent` usage shape or add a compatible adapter type.

### 2. Usage Event Store

#### `src/persistence/usage-event-store.ts`
#### `src/config/paths.ts`

**Status**: Completed

```typescript
export interface UsageEventStore {
  listEvents(options?: UsageEventListOptions): Promise<readonly UsageEventRecord[]>;
  upsertEvent(event: UsageEventRecord): Promise<void>;
  upsertEvents(events: readonly UsageEventRecord[]): Promise<void>;
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

- [x] Store events under repository-owned `getDataDir()` state.
- [x] Upsert by `eventId` so duplicate stream/result observations are idempotent.
- [x] Treat missing or corrupt store content as empty recoverable state.
- [x] Sort reads by `observedAt`, then `eventId`.

### 3. Usage Capture Adapter

#### `src/cursor/usage-events.ts`

**Status**: Completed

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

- [x] Convert only normalized `AgentEvent` usage into persisted usage events.
- [x] Ignore events with no positive token evidence.
- [x] Resolve model from event usage, stream start context, or `unknown`.
- [x] Generate stable event ids from session id, source, token payload, model, and result fingerprint (`observedAt` is stored for ordering but excluded from the id so duplicate stream deliveries stay idempotent).

### 4. Wrapper Capture Hooks

#### `src/cli/cli.ts`
#### `src/cli/usage-persistence-chain.ts`

**Status**: Completed

```typescript
interface UsagePersistenceChainOptions {
  readonly store?: UsageEventStore;
  /** Optional diagnostic hook; persistence failures remain non-fatal. */
  readonly onPersistError?: (error: unknown) => void;
}

interface UsagePersistenceChain {
  readonly capture: (
    events: readonly AgentEvent[],
    fallbackSessionId?: string,
  ) => void;
  readonly flush: () => Promise<void>;
}

function createUsagePersistenceChain(
  repo: SessionIndexRepository,
  options?: UsagePersistenceChainOptions,
): UsagePersistenceChain;
```

**Checklist**:

- [x] Capture usage for `session run`, `session resume`, and `session continue`.
- [x] Capture usage for each child session in `group run` and `queue run`.
- [x] Reuse the activity capture write-chain pattern so persistence is ordered and non-fatal.
- [x] Preserve existing Cursor process exit codes when usage persistence fails.

### 5. Usage Stats Aggregation and CLI

#### `src/usage/manager.ts` (plan drafted `src/usage/usage-stats.ts`; aggregation implemented here)
#### `src/cli/cli.ts`

**Status**: Completed

```typescript
export interface UsageStatsOptions {
  readonly workspacePath?: string;
  readonly sessionId?: string;
  readonly recentDays?: number;
  readonly now?: Date;
}

/** Aggregation surface: full shape is `UsageStatsReport` in `src/types/usage-stats.ts` (session/activity slices omitted here). */
export interface UsageStatsReport {
  readonly totalSessions: number;
  readonly usageTokens: UsageTokenTotals;
  readonly usageTokensByModel: Record<string, UsageTokenTotals>;
  readonly usageRecentDailyActivity: readonly UsageDailyTokenActivity[];
  readonly usageEvidenceCoverage: UsageEvidenceCoverage;
  /** `repository_usage_events` when a store is wired; `unavailable` when aggregation runs without `usageEvents`. */
  readonly usageProvenance: "repository_usage_events" | "unavailable";
}

export interface UsageEvidenceCoverage {
  readonly sessionsWithUsageEvents: number;
  readonly knownSessionsWithoutUsageEvents: number;
  readonly wrapperStartedSessionsWithoutUsageEvents: number;
}

export interface UsageDailyTokenActivity {
  readonly date: string;
  readonly tokensByModel: Record<string, number>;
}
```

**Checklist**:

- [x] Aggregate totals by model and recent day from persisted events.
- [x] Filter by workspace and session identity.
- [x] Return explicit coverage instead of false zero certainty.
- [x] Add or align `usage stats [--workspace] [--session] [--recent-days] [--json]` CLI behavior.

### 6. Tests and Documentation Refresh

#### `src/persistence/usage-event-store.test.ts`
#### `src/cursor/usage-events.test.ts`
#### `src/usage/manager.test.ts` (covers aggregation; no separate `usage-stats.test.ts`)
#### `src/cli/usage-persistence-chain.test.ts`
#### `src/cli/tool-registry-cli.test.ts` and related CLI tests
#### `README.md`

**Status**: Completed

```typescript
describe("repository-owned usage events", () => {
  // persistence, extraction, aggregation, CLI, and coverage tests
});
```

**Checklist**:

- [x] Cover missing and corrupt usage stores.
- [x] Cover idempotent duplicate event writes.
- [x] Cover aggregation by model, daily buckets, workspace, and session.
- [x] Cover wrapper-started run capture with normalized completion usage (`src/cli/usage-persistence-chain.test.ts`; integration/E2E over live Cursor streams remains optional).
- [x] Cover CLI JSON coverage and provenance fields (tool registry / manager).
- [x] Refresh user-facing docs for the usage stats command.

---

## Work Breakdown

### TASK-001: Usage Event Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/usage-event.ts`, targeted type alignment in `src/types/agent-event.ts`
**Dependencies**: P1-CORE-FOUNDATION

**Description**:
Define stable normalized usage event records and token totals used by persistence, capture, and aggregation.

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Token field names align with existing normalized `UsageStats`.
- [x] Domain types contain no raw Cursor payload shapes.

### TASK-002: Usage Event Store

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/persistence/usage-event-store.ts`, `src/persistence/usage-event-store.test.ts`, `src/config/paths.ts`
**Dependencies**: TASK-001

**Description**:
Persist repository-owned usage events with atomic writes, idempotent upsert, deterministic reads, and corrupt-store tolerance.

**Completion Criteria**:

- [x] Missing store returns an empty list.
- [x] Corrupt store does not crash callers.
- [x] Duplicate `eventId` writes do not double count.
- [x] Tests use temporary data paths and do not touch Cursor-owned directories.

### TASK-003: Normalized Usage Event Extraction

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/usage-events.ts`, `src/cursor/usage-events.test.ts`
**Dependencies**: TASK-001

**Description**:
Convert normalized completion events plus session context into durable usage event records.

**Completion Criteria**:

- [x] `session.completed` events with positive usage become `UsageEventRecord` values.
- [x] Missing usage or all-zero usage returns `null`.
- [x] Model fallback and stable event id generation are tested.
- [x] Raw Cursor payload parsing remains outside persistence and CLI code.

### TASK-004: Wrapper Run Usage Capture

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/usage-persistence-chain.ts`, hook wiring in `src/cli/cli.ts`, `src/cli/usage-persistence-chain.test.ts`
**Dependencies**: TASK-002, TASK-003, P2-ACTIVITY

**Description**:
Record usage events for wrapper-started session, group, and queue runs using the same ordered non-fatal capture pattern as activity signals.

**Completion Criteria**:

- [x] `session run`, `session resume`, and `session continue` persist observed completion usage.
- [x] `group run` and `queue run` persist per-child-session usage.
- [x] Usage persistence failure does not change Cursor process exit behavior.
- [x] Tests assert usage capture through representative wrapper flows (`createUsagePersistenceChain` unit coverage with mocked repo + injected store; full CLI streaming E2E remains optional).

### TASK-005: Usage Stats Aggregation and CLI

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/usage/manager.ts` (aggregation), targeted updates in `src/cli/cli.ts`, `src/usage/manager.test.ts`, CLI/tool-registry tests as applicable
**Dependencies**: TASK-002, TASK-004

**Description**:
Aggregate persisted usage event evidence into user-facing usage stats with explicit coverage and provenance.

**Completion Criteria**:

- [x] Aggregates input, output, cache-read, cache-write, and total tokens.
- [x] Groups totals by model and recent day.
- [x] Supports workspace, session, and recent-days filters.
- [x] JSON output exposes provenance and coverage counts (`usageProvenance` is `repository_usage_events` when a store is wired, otherwise `unavailable` on `UsageStatsReport`).
- [x] Empty evidence does not imply all known sessions consumed zero tokens.

### TASK-006: Documentation and Workflow Refresh

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, implementation plan progress updates
**Dependencies**: TASK-005

**Description**:
Refresh user-facing usage stats documentation and mark implementation progress after verification.

**Completion Criteria**:

- [x] README documents usage stats command, filters, coverage, and provenance.
- [x] Progress log records implementation verification.
- [x] Plan status and checklists are updated after all tests pass.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Usage event types | `src/types/usage-event.ts` | Completed | Typecheck |
| Usage event store | `src/persistence/usage-event-store.ts` | Completed | `src/persistence/usage-event-store.test.ts` |
| Usage event extractor | `src/cursor/usage-events.ts` | Completed | `src/cursor/usage-events.test.ts` |
| Usage persistence chain | `src/cli/usage-persistence-chain.ts` | Completed | `src/cli/usage-persistence-chain.test.ts` |
| Wrapper capture hooks | `src/cli/cli.ts` | Completed | Uses persistence chain; CLI streaming E2E optional |
| Usage stats aggregator | `src/usage/manager.ts` | Completed | `src/usage/manager.test.ts` |
| User-facing docs | `README.md` | Completed | Manual review |

## Dependency Table

| Feature or Task | Depends On | Status |
|-----------------|------------|--------|
| P5-USAGE-EVENT-PERSISTENCE | P1-CORE-FOUNDATION, P2-ACTIVITY | Completed |
| TASK-001 | P1-CORE-FOUNDATION | Completed |
| TASK-002 | TASK-001 | Completed |
| TASK-003 | TASK-001 | Completed |
| TASK-004 | TASK-002, TASK-003, P2-ACTIVITY | Completed |
| TASK-005 | TASK-002, TASK-004 | Completed |
| TASK-006 | TASK-005 | Completed |

## Parallelizable Tasks

- TASK-001 is parallelizable after `P1-CORE-FOUNDATION`.
- TASK-002 and TASK-003 can run in parallel after TASK-001 if write ownership is split between `src/persistence/*` and `src/cursor/*`.
- TASK-004, TASK-005, and TASK-006 are sequential because they converge on CLI behavior and depend on persisted capture.

## Verification

- `task typecheck`
- `task test`
- `task ci`
- `bun test src/persistence/usage-event-store.test.ts src/cursor/usage-events.test.ts src/cli/usage-persistence-chain.test.ts src/usage/manager.test.ts`
- `bun run src/main.ts usage stats --json`
- `bun run src/main.ts usage stats --recent-days 7 --json`
- `bun run src/main.ts usage stats --session <id> --json`

## Completion Criteria

- [x] Wrapper-started session, group, and queue runs persist normalized usage events when Cursor emits usage.
- [x] Duplicate or retried stream observations do not double count token totals.
- [x] Usage stats aggregate model and daily token totals from repository-owned evidence.
- [x] Empty or missing evidence is represented as partial or absent coverage, not as complete zero usage.
- [x] Cursor-managed transcripts, worker logs, skill directories, and `ai-tracking` DB remain read-only.
- [x] `task typecheck`, `task test`, and `task ci` pass before implementation completion.

## Progress Log

### Session: 2026-05-08 Self-review (onPersistError hook)

**Tasks Completed**: Added optional `onPersistError` on `UsagePersistenceChainOptions` for tests and future diagnostics; persistence remains non-fatal and hook throws cannot reject `flush`. Extended `usage-persistence-chain` tests for observed errors and for a throwing hook; re-ran `task ci`.

**Notes**: Production CLI continues to call `createUsagePersistenceChain(repo)` without a hook.

### Session: 2026-05-08 Implementation

**Tasks Completed**: TASK-001 through TASK-006 (runtime implementation, aggregation, README refresh, `task ci`).
**Notes**: Usage aggregation lives in `src/usage/manager.ts` with extended `UsageStatsReport` instead of a separate `usage-stats.ts` module. Dedicated wrapper-run CLI assertions remain optional follow-up beyond manager/store/extractor coverage.

### Session: 2026-05-08 Self-review

**Tasks Completed**: Plan document synced with delivered files; `fromAgentEvent` return value now lists token fields explicitly (avoids leaking internal `hasPositive` into persisted records). Re-ran `task ci` successfully.
**Notes**: Remaining optional follow-up: integration-style CLI tests that assert usage JSONL capture through `session run` / group / queue wrappers.

### Session: 2026-05-08 Self-review (verification and coverage)

**Tasks Completed**: Corrected Verification section commands (aggregation tests live in `manager.test.ts`, not `usage-stats.test.ts`); aligned TASK-004 deliverables with deferred wrapper-flow assertions; ensured new persistence modules were git-tracked; added extractor regression test for whitespace-only model context strings.
**Notes**: Recommended commit includes `git add` for `src/types/usage-event.ts`, `src/persistence/usage-event-store.ts`, `src/persistence/usage-event-store.test.ts`, `src/cursor/usage-events.ts`, and `src/cursor/usage-events.test.ts`.

### Session: 2026-05-08 Self-review (provenance accuracy)

**Tasks Completed**: `UsageStatsReport.usageProvenance` is now `unavailable` when `createUsageStatsManager` is constructed without a `usageEvents` store, so JSON no longer implies repository-owned token evidence without a store. README and plan JSON criterion updated; manager test asserts the `unavailable` branch.

**Notes**: CLI and tool-helper paths that wire `createUsageEventStore` still report `repository_usage_events`.

### Session: 2026-05-08 Self-review (usage event idempotency)

**Tasks Completed**: `stableEventId` no longer mixes in `observedAt`, matching the design requirement that duplicate or retried normalized completions must not double count; capture timestamps remain on the record for ordering. Added extractor regression coverage for two capture times with the same completion payload.

**Notes**: `task ci` re-verified after the change.

### Session: 2026-05-08 Self-review (capture chain hygiene)

**Tasks Completed**: `createUsagePersistenceChain` now drops `streamModels` entries after each `session.completed` so long `group run` / `queue run` batches do not retain model names for every child session for the lifetime of the run.

**Notes**: `task ci` re-verified.

### Session: 2026-05-08 Self-review (phase-5 verification)

**Tasks Completed**: Revalidated uncommitted Phase 5 diff (CLI/tool/SDK usage wiring, persistence store, aggregator coverage, PROGRESS.json `usage-event-persistence` slice, README usage stats wording). Ran `task ci` green. Added persistence unit coverage that `listEvents({ sessionId })` matches persisted events by local session id, `recordId`, or `cursorChatId`, consistent with aggregator session matching.

**Notes**: Optional deferred items remain integration-style CLI tests over real wrapper JSONL captures; housekeeping to move Completed plans under `impl-plans/completed/` applies repo-wide once active-table cleanup is scheduled.

### Session: 2026-05-08 Self-review (mock SDK provenance)

**Tasks Completed**: `createMockCursorAgentSdk` default `tools.usageStats` now uses `usageProvenance: "unavailable"` and the same completeness note as `createUsageStatsManager` without a store, so test doubles do not imply repository-owned token evidence. Re-ran `task ci` green.

**Notes**: Real SDK `createToolHelperSdk` / CLI / tool-registry paths still wire `createUsageEventStore` and report `repository_usage_events` when appropriate.

### Session: 2026-05-08 Self-review (scoped activity aggregation)

**Tasks Completed**: Usage stats activity buckets now derive from `getSessionActivity` for each session in `scopedSessions`, matching `--session` / `--workspace` filters (previously `listActivity` could count activity outside the filtered cohort). Regression coverage in `src/usage/manager.test.ts`; SDK empty-repo expectation aligned. Re-ran `task ci` green.

**Notes**: Behavior matches session-scoped status and usage event queries; mocks should implement `getSessionActivity` consistently with indexed sessions.

### Session: 2026-05-08 Self-review (batched usage persistence writes)

**Tasks Completed**: Added `UsageEventStore.upsertEvents` (single load/save per batch); `createUsagePersistenceChain` batches all `session.completed` rows from one normalized event batch into one chained persist step (fewer JSON rewrites during `group run` / `queue run`). `upsertEvent` delegates to `upsertEvents`. Added store unit coverage for multi-row batch.

**Notes**: `task ci` re-verified after the change.

### Session: 2026-05-08 Self-review (store method binding)

**Tasks Completed**: `createUsageEventStore` wires `upsertEvent` through a local `upsertEventsBatch` closure so callers cannot break persistence by extracting `upsertEvent` without a `this` receiver. Re-ran `task ci` after the change.

**Notes**: No behavior change for normal `store.upsertEvent` / `store.upsertEvents` calls.

### Session: 2026-05-08 Self-review (final pass)

**Tasks Completed**: Reviewed impl-plan state and uncommitted Phase 5 diff (store, extractor, CLI capture chain, aggregator, SDK mocks, PROGRESS/README). Confirmed `task ci` green after `matchesFilters` workspace slug simplification (redundant `workspaceSlugFromPath(options.workspacePath)` branch removed; it matches `slug` derived from `resolve(options.workspacePath)`).

**Notes**: Optional follow-up remains integration-style CLI tests over real wrapper JSONL streams; relocating completed plans from `impl-plans/active/` is repo-wide housekeeping.

### Session: 2026-05-08 Self-review (capture timestamp + store validation)

**Tasks Completed**: Aligned `observedAt` for all usage rows produced from a single normalized event batch (one ISO timestamp per `capture()`), so sibling completions in the same flush sort predictably on `eventId`. Tightened `isUsageEventRecord` optional-field validation and added store regression coverage for malformed optional types. Re-ran `task ci`.

**Notes**: Git diff review confirmed PROGRESS/README alignment with Completed transcript-search and markdown-tasks plans; usage-event persistence remains the Phase 5 focus of the uncommitted change set.

### Session: 2026-05-08 Self-review (phase-5 closure)

**Tasks Completed**: Re-read current `git diff` (staged + unstaged); confirmed Phase 5 usage-event persistence is delivered with README/PROGRESS/tool-registry/SDK alignment and `task ci` green before edits. Added store regression coverage that `upsertEvents([])` does not clear previously persisted rows. Staged entire change set (`git add -A`) for a coherent commit-ready tree.

**Notes**: Deferred integration CLI tests remain optional follow-up.

### Session: 2026-05-08 Self-review (completion fingerprint)

**Tasks Completed**: Reviewed staged Phase 5 diff end-to-end; `task ci` remained green. Improved `resultFingerprint` in `fromAgentEvent` to SHA-256 the full completion text instead of the first 4KiB, avoiding accidental id collisions when token totals and model match but bodies differ past the prefix. Added extractor regression test for long divergent suffixes.

**Notes**: Duplicate normalized stream deliveries still dedupe because the payload hash is unchanged.

### Session: 2026-05-08 Closure (repo conventions)

**Tasks Completed**: Moved this plan from `impl-plans/active/` to `impl-plans/completed/`; updated cross-references in `impl-plans/README.md` and `design-docs/specs/design-usage-event-persistence.md`. Confirmed staged Phase 5 diff passes `task ci`.
**Notes**: The broader index cleanup has now archived the remaining Completed plans under `impl-plans/completed/`.

### Session: 2026-05-08 Self-review (flush hygiene)

**Tasks Completed**: Reviewed full `git diff HEAD` for Phase 5 usage-event persistence (store, extractor, CLI hooks, usage manager, SDK mocks, README/PROGRESS). `createUsagePersistenceChain.flush` awaits the persistence-queue tail until `chain` stops growing (initial `await` plus `while (settled !== chain)`), then clears `streamModels`, avoiding a race where a late `capture` extends `chain` after an earlier awaited tail. Added JSDoc for `usageSessionsObserved` in `src/types/usage-stats.ts` (matches `Set` of persisted event `sessionId` values). Ran `task ci` successfully.

**Notes**: Phase 5 plan tasks remain complete; deferred integration CLI tests unchanged.

### Session: 2026-05-08 Self-review (capture batch timestamp)

**Tasks Completed**: Reviewed staged Phase 5 diff versus plan intent; `createUsagePersistenceChain.capture` now assigns one `observedAt` per batch (shared by every `session.completed` row in that `capture()` call) instead of calling `new Date().toISOString()` inside the per-completion loop, restoring deterministic sibling ordering with shared `eventId`-based sort keys. Re-ran `task ci` successfully.

**Notes**: Matches the design note that all usage rows from one normalized event flush share the same observation instant.

### Session: 2026-05-08 Self-review (explicit stream totalTokens)

**Tasks Completed**: Aligned normalized `UsageStats`, `parseUsage`, and extractor `tokenTotals` with design: optional explicit `totalTokens` from the Cursor stream (camelCase or snake_case) wins over summed component totals; total-only payloads still normalize to completions with zeroed breakdown fields. Covered with stream-normalizer and extractor tests. Ran `task ci` green after the change.

**Notes**: Component sums may disagree with persisted `totalTokens` when upstream sends both; aggregates use stored `totalTokens` for evidence rows.

### Session: 2026-05-08 Self-review (parseUsage total sanitization)

**Tasks Completed**: `parseUsage` now treats explicit stream totals as absent when they are non-finite or negative, matching downstream `tokenTotals` expectations and avoiding accidental `UsageStats` payloads with unusable totals. Added stream-normalizer coverage for negative `total_tokens` with component usage. Re-ran `task ci` after the change.

**Notes**: Component fields are unchanged; invalid explicit totals fall back to component sums or undefined usage as before.

### Session: 2026-05-08 Self-review (staged diff + resultFingerprint entropy)

**Tasks Completed**: Reviewed full staged Phase 5 `git diff` (usage store, extractor, CLI `createUsagePersistenceChain`, usage manager aggregation, stream normalizer, SDK/helpers tests, README/PROGRESS/plan moves). Synced `impl-plans/PROGRESS.json` `lastUpdated` into the index. `fromAgentEvent` now feeds the full 64-hex SHA-256 of `event.result` into `stableEventId` (replacing a 16-hex prefix) to reduce collision risk when usage and model match but completion text differs. Re-ran `task ci` green.

**Notes**: `usage-event-persistence` tasks remain complete in `PROGRESS.json`; optional wrapper-stream integration tests still deferred.

### Session: 2026-05-08 Self-review (impl-plan closure + event id length)

**Tasks Completed**: Re-reviewed staged `git diff` (24 paths: usage store and tests, extractor and tests, CLI capture chain, stream normalizer, usage manager and tests, SDK helpers/testing/types, README, design spec, PROGRESS, plan under `completed/`). Confirmed `usage-event-persistence` stays **Completed** in `PROGRESS.json`. `stableEventId` now keeps the full 64-hex SHA-256 of the id payload (no truncation). Added JSDoc on `createUsagePersistenceChain`. Bumped `PROGRESS.json` `lastUpdated`. Re-ran `task ci` after changes.

**Notes**: Optional follow-up remains integration-style CLI tests over real wrapper JSONL; the broader Completed-plan archive cleanup is now done.

### Session: 2026-05-08 Self-review (design spec vs `usageProvenance`)

**Tasks Completed**: Aligned `design-usage-event-persistence.md` aggregation bullets with shipped behavior: `unavailable` when `createUsageStatsManager` has no `usageEvents` store, `repository_usage_events` when a store is wired (including empty/missing file as empty evidence). Re-ran `task ci` green.

**Notes**: No new TASK work; plan tasks remain Completed in `PROGRESS.json`.

### Session: 2026-05-08 Self-review (usage store read resilience)

**Tasks Completed**: Re-reviewed staged Phase 5 `git diff --cached` (24 paths: usage types/store/extractor, CLI capture chain, stream normalizer, usage manager, SDK/helpers, README, design spec, PROGRESS, plan under `completed/`). `usage stats` aggregation now catches errors from `UsageEventStore.listEvents`, returns zeroed token totals, zeros `usageEvidenceCoverage` (avoids implying “all headless sessions lack usage” after a read failure), appends an explicit completeness note, and keeps `usageProvenance: "repository_usage_events"` when a store was wired. Added `manager` unit coverage for a throwing `listEvents`. Ran `task ci` green; bumped `impl-plans/PROGRESS.json` `lastUpdated`.

**Notes**: Phase 5 task index remains **Completed**; optional wrapper-stream integration tests still deferred.

### Session: 2026-05-08 Self-review (typing + design alignment)

**Tasks Completed**: Added `UsageEvidenceCoverage` JSDoc in `src/types/usage-stats.ts` documenting zeroed counts and completeness notes when `listEvents` throws. Extended `design-usage-event-persistence.md` aggregation rules with the same contract. Re-ran `task ci`.

**Notes**: Default JSON `UsageEventStore` still tolerates corrupt files without throwing `listEvents`; the manager guard is for unexpected failures and alternative store implementations.

### Session: 2026-05-08 Self-review (extract usage persistence chain)

**Tasks Completed**: Moved `createUsagePersistenceChain` and shared `sessionIdFromEvent` into `src/cli/usage-persistence-chain.ts` with optional injected `UsageEventStore` for tests; `cli.ts` imports the factory; added `src/cli/usage-persistence-chain.test.ts` covering persistence, batch `observedAt`, stream model precedence, zero-token skip, and non-fatal store failures. Updated plan checklists and module table.

**Notes**: Live Cursor subprocess integration tests remain optional; `task ci` verified green after extraction.

### Session: 2026-05-08 Self-review (plan snippet + PROGRESS sync)

**Tasks Completed**: Reviewed staged `git diff --cached` for Phase 5 usage-event persistence (store, extractor, CLI chain, usage manager, stream normalizer, SDK, README, design spec, PROGRESS, plan relocation). Confirmed `impl-plans/PROGRESS.json` marks `usage-event-persistence` **Completed** and `markdown-tasks` **Completed** in line with shipped code. Synced plan section 5 TypeScript excerpt with `UsageStatsReport` / `usageProvenance` / `UsageDailyTokenActivity`. Ran `task ci` green.

**Notes**: No open TASK work for this plan; optional wrapper JSONL integration tests remain deferred.

### Session: 2026-05-08 Self-review (staged diff + `task ci`)

**Tasks Completed**: Re-reviewed the staged Phase 5 change set (usage event types/store/tests, extractor/tests, `usage-persistence-chain` + tests, CLI wiring, stream normalizer, usage manager aggregation/tests, SDK helpers/testing/types, README, design spec, `impl-plans` index + `PROGRESS.json` + plan move to `completed/`). Confirmed `usage-event-persistence` tasks remain **Completed**; no remaining plan TASK work. `task ci` failed `format:check` on `src/usage/manager.ts`; applied `bun run format` and re-ran `task ci` successfully.

**Notes**: Include the formatted `manager.ts` in the same commit as the rest of the Phase 5 tree; optional wrapper JSONL integration tests still deferred.

### Session: 2026-05-08 Agent closure (staged diff + scope accuracy)

**Tasks Completed**: Reviewed full `git diff --cached` for Phase 5 (usage store, extractor, `usage-persistence-chain`, CLI hooks, `usage/manager`, stream normalizer, SDK helpers/tests/types, README, design spec, `PROGRESS.json`, plan under `completed/`). Re-ran `task ci` successfully. Updated plan **Excluded** scope: removed obsolete doc-only-branch wording; documented minimal SDK alignment vs no standalone usage export.

**Notes**: `usage-event-persistence` tasks remain **Completed** in `PROGRESS.json`; optional wrapper JSONL integration tests still deferred.

### Session: 2026-05-08 SDK usage store DI + self-review

**Tasks Completed**: Reviewed unstaged `git diff` for Phase 5 alignment: optional `usageEventStore` on `CursorAgentSdkOptions` and `ToolHelperSdkOptions`, passed through `createToolHelperSdk` to `createUsageStatsManager`, with `src/sdk/index.test.ts` coverage for repository-owned token totals. Added an exhaustive `default` branch on `sessionIdFromEvent` in `usage-persistence-chain.ts`. Re-exported `UsageEventStore` from `src/sdk/types.ts` so embedders can type injected stores from `curort-cli-agent/sdk` without reaching into `src/persistence/*`. Ran Prettier on `index.test.ts`; `task ci` green.

**Notes**: `usage-event-persistence` stays **Completed** in `PROGRESS.json`; TASK-006 scope treats SDK DI as incremental alignment beyond README. Optional wrapper JSONL CLI integration tests unchanged.

### Session: 2026-05-06 Step 3 Feature Design Plan
**Tasks In Progress**: None. **Blockers**: None.
**Verification**: Documentation-only validation by reading assigned skills, mailbox-selected feature input, codex-agent references, existing activity plan, stream normalizer, activity store, CLI capture hooks, and local architecture notes.
**Notes**: No runtime code was implemented. No latest review payload was attached for this pass. Plan maps Codex rollout usage aggregation to Cursor wrapper-started normalized event capture and repository-owned persistence, with `P1-CORE-FOUNDATION` and `P2-ACTIVITY` as explicit dependencies.
