# Repository Analytics Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-repository-analytics.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-repository-analytics.md`

### Summary

Implement issue `parity-global-design-plan-implement-loop#P3-REPO-ANALYTICS`: local-only repository and commit analytics derived from Cursor `ai-code-tracking.db`, scored commits, and the `P3-FILE-INTELLIGENCE` layer, with explicit provenance and graceful degradation when sources are missing or sparse.

### Scope

**Included**: normalized analytics types, read-only `scored_commits` adapter access, repository-owned analytics index, analytics service orchestration, CLI commands, and focused tests.

**Excluded**: runtime code implementation in this planning branch, mutation of Cursor-owned files or databases, Git history mutation, server APIs, daemon watches, SDK exports, dashboards, exact per-line authorship, and direct transcript parsing for file changes.

### Dependencies

- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, `stateDbPath`, `aiTrackingDbPath`, Cursor path config, and current CLI command structure.
- `P3-FILE-INTELLIGENCE`: normalized file/session attribution, file index rebuild/find behavior, and provenance contracts. Upstream intake/review marks this dependency ready; existing file-intelligence plan and source modules are implemented.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/types.ts`: workflow-supplied behavioral reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.ts`: workflow-supplied behavioral reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.test.ts`: workflow-supplied behavioral reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/usage-stats.ts`: workflow-supplied behavioral reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/index.ts`: workflow-supplied session lookup reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/sqlite.ts`: workflow-supplied persistence reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts`: workflow-supplied session type reference; missing locally during Step 2/Step 3.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/design-docs/specs/design-codex-session-management.md`: workflow-supplied design reference; missing locally during Step 2/Step 3.

Intentional divergences accepted by the design: Cursor commit scoring comes from `scored_commits`, session/file attribution comes from `P3-FILE-INTELLIGENCE`, commit scores remain separately provenanced from conversations, and missing DB/schema/rows are explicit degraded states.

---

## Modules

### 1. Repository Analytics Types

#### `src/types/repository-analytics.ts`

**Status**: COMPLETED

```typescript
export type RepositoryAnalyticsProvenance =
  | "ai_tracking" | "file_intelligence" | "git" | "index"
  | "missing_ai_tracking" | "missing_scored_commits"
  | "missing_file_intelligence" | "missing_rows" | "unknown";

export interface ScoredCommitAnalytics {
  readonly commitHash: string;
  readonly branchName?: string;
  readonly commitMessage?: string;
  readonly commitDate?: string;
  readonly composerLinesAdded?: number;
  readonly composerLinesDeleted?: number;
  readonly v1AiPercentage?: number;
  readonly v2AiPercentage?: number;
  readonly provenance: RepositoryAnalyticsProvenance;
}

export interface RepositoryAnalyticsSummary {
  readonly totalCommits: number;
  readonly scoredCommits: number;
  readonly totalComposerLines: number;
  readonly weightedV1AiPercentage?: number;
  readonly weightedV2AiPercentage?: number;
  readonly updatedAt?: string;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
  readonly completenessNotes: readonly string[];
}

export interface RepositorySessionAnalytics {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly workspacePath?: string;
  readonly touchedFiles: number;
  readonly deletedFiles: number;
  readonly snapshots: number;
  readonly unknownFiles: number;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
  readonly completenessNotes: readonly string[];
}

export interface RepositoryFileAnalytics {
  readonly path: string;
  readonly sessions: number;
  readonly touchedCount: number;
  readonly deletedCount: number;
  readonly snapshotCount: number;
  readonly firstObservedAt?: string;
  readonly lastObservedAt?: string;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
}

export interface RepositoryAnalyticsRebuildStats {
  readonly indexedCommits: number;
  readonly indexedSessions: number;
  readonly indexedFiles: number;
  readonly skippedRows: number;
  readonly updatedAt: string;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
  readonly completenessNotes: readonly string[];
}
```

**Checklist**:
- [x] Define commit, repository, session, file, rebuild, and degraded result types.
- [x] Preserve provenance/completeness and keep commit analytics separate from session attribution.
- [x] Export types for adapters, persistence, service, and CLI.

### 2. Cursor AI Tracking Analytics Reader

#### `src/cursor/ai-tracking-reader.ts`

**Status**: COMPLETED

```typescript
export interface AiTrackingAnalyticsReader {
  listScoredCommits(options?: ScoredCommitReadOptions): AiTrackingScoredCommitResult;
}

export interface AiTrackingScoredCommitRow {
  readonly commitHash: string;
  readonly branchName?: string;
  readonly commitMessage?: string;
  readonly commitDate?: string;
  readonly composerLinesAdded?: number;
  readonly composerLinesDeleted?: number;
  readonly v1AiPercentage?: number;
  readonly v2AiPercentage?: number;
}
```

**Checklist**:
- [x] Keep `scored_commits` SQL/schema fallbacks isolated in the Cursor adapter.
- [x] Open `ai-code-tracking.db` read-only and close handles deterministically.
- [x] Return degraded metadata when DB, schema, columns, or rows are missing.
- [x] Sort and limit rows deterministically for CLI callers.

### 3. Repository Analytics Index

#### `src/persistence/repository-analytics-index.ts`

**Status**: COMPLETED

```typescript
export interface RepositoryAnalyticsIndex {
  rebuild(input: RepositoryAnalyticsRebuildInput): RepositoryAnalyticsRebuildStats;
  getSummary(): RepositoryAnalyticsSummary;
  listCommits(options?: RepositoryCommitListOptions): RepositoryCommitListResult;
  listSessions(options?: RepositorySessionAnalyticsOptions): RepositorySessionAnalyticsResult;
  listFiles(options?: RepositoryFileAnalyticsOptions): RepositoryFileAnalyticsResult;
}

export interface RepositoryAnalyticsRebuildStats {
  readonly indexedCommits: number;
  readonly indexedSessions: number;
  readonly indexedFiles: number;
  readonly skippedRows: number;
  readonly updatedAt: string;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
}
```

**Checklist**:
- [x] Store repository-owned derived rows, not Cursor-owned state.
- [x] Replace derived analytics atomically during rebuild.
- [x] Store commit scores, rollups, timestamps, provenance, and completeness notes.
- [x] Treat missing or stale index as recoverable degraded analytics.

### 4. Repository Analytics Service

#### `src/repository-analytics/manager.ts`

**Status**: COMPLETED

```typescript
export interface RepositoryAnalyticsService {
  getSummary(): Promise<RepositoryAnalyticsSummary>;
  listCommits(options?: RepositoryCommitListOptions): Promise<RepositoryCommitListResult>;
  listSessions(options?: RepositorySessionAnalyticsOptions): Promise<RepositorySessionAnalyticsResult>;
  listFiles(options?: RepositoryFileAnalyticsOptions): Promise<RepositoryFileAnalyticsResult>;
  rebuild(): Promise<RepositoryAnalyticsRebuildStats>;
}
```

**Checklist**:
- [x] Coordinate session index, scored commits, file intelligence, and analytics index writes.
- [x] Compute weighted AI percentages only when line counts are present.
- [x] Preserve valid `0` AI percentages as explicit scored values.
- [x] Return degraded success for missing optional sources.
- [x] Avoid direct transcript parsing for file changes.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
async function runRepoAnalytics(argv: string[]): Promise<number>;
```

**Checklist**:
- [x] Add `repo analytics summary`, `commits`, `sessions`, `files`, and `rebuild`.
- [x] Support `--json`; support `--limit <n>` for commits.
- [x] Render provenance and degraded-state messages in human output.

### 6. Tests

#### `src/cursor/ai-tracking-reader.test.ts`, `src/persistence/repository-analytics-index.test.ts`, `src/repository-analytics/manager.test.ts`, `src/cli/cli.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Cover missing DB, missing `scored_commits`, and missing columns degradation.
- [x] Cover valid zero AI percentages and weighted percentage calculations.
- [x] Cover sparse file-intelligence dependency results.
- [x] Cover `repo analytics rebuild` and subsequent list/summary reads.
- [x] Cover JSON output provenance for all subcommands.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Repository analytics types | `src/types/repository-analytics.ts` | COMPLETED | typecheck |
| AI tracking analytics reader | `src/cursor/ai-tracking-reader.ts` | COMPLETED | `src/cursor/ai-tracking-reader.test.ts` |
| Repository analytics index | `src/persistence/repository-analytics-index.ts` | COMPLETED | `src/persistence/repository-analytics-index.test.ts` |
| Repository analytics service | `src/repository-analytics/manager.ts` | COMPLETED | covered through CLI and index tests |
| CLI commands | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Test coverage | `src/**/*.test.ts` | COMPLETED | `task test` |

## Work Breakdown

### TASK-001: Repository Analytics Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/types/repository-analytics.ts`, export wiring
**Dependencies**: file-intelligence:TASK-001 (completed)

**Description**:
Define strict commit, summary, session attribution, file attribution, provenance, completeness, and rebuild stat contracts.

**Completion Criteria**:
- [x] Types compile under strict TypeScript.
- [x] Types include explicit degraded provenance and completeness notes.
- [x] Contracts keep commit scoring separate from session/file attribution.

### TASK-002: Cursor Scored Commits Reader

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/cursor/ai-tracking-reader.ts`, `src/cursor/ai-tracking-reader.test.ts`
**Dependencies**: TASK-001

**Description**:
Extend the read-only Cursor adapter to query `scored_commits` with schema-safe degradation.

**Completion Criteria**:
- [x] DB missing/unreadable returns degraded availability.
- [x] Missing `scored_commits` table or columns returns `missing_scored_commits`.
- [x] Valid zero percentages remain distinguishable from missing values.
- [x] Tests cover observed local table shapes.

### TASK-003: Repository Analytics Index

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/persistence/repository-analytics-index.ts`, `src/persistence/repository-analytics-index.test.ts`
**Dependencies**: TASK-001, file-intelligence:TASK-003 (completed)

**Description**:
Add a rebuildable local analytics index for scored commits and session/file rollups. This can be implemented alongside TASK-002 after TASK-001 because its write scope is limited to `src/persistence/repository-analytics-index.ts` and its tests.

**Completion Criteria**:
- [x] Rebuild replaces derived rows atomically.
- [x] Summary, commit, session, and file queries return deterministic ordering.
- [x] Index stats report freshness, skipped rows, and provenance.
- [x] Tests cover missing/stale index behavior.

### TASK-004: Repository Analytics Service

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/repository-analytics/manager.ts`, `src/repository-analytics/index.ts`, `src/repository-analytics/manager.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, file-intelligence:TASK-004 (completed)

**Description**:
Coordinate scored commits, session index data, file-intelligence attribution, degraded provenance, and analytics index rebuild/read behavior.

**Completion Criteria**:
- [x] Summary computes weighted percentages from available line counts.
- [x] Missing file intelligence degrades session/file analytics without failing commit analytics.
- [x] Commit scoring does not imply conversation-level attribution.
- [x] Tests cover sparse rows and mixed provenance.

### TASK-005: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**:
Add `repo analytics` subcommands with JSON and human output, validation, and exit-code behavior aligned with existing CLI conventions.

**Completion Criteria**:
- [x] All five requested subcommands are routed.
- [x] `--json` emits stable structured results.
- [x] Human output reports provenance and degraded states.
- [x] Validation covers unknown action and invalid limit values.

### TASK-006: Verification and Plan Closure

**Status**: Completed
**Parallelizable**: No
**Deliverables**: implementation-plan progress updates
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run project automation, record progress, and update completion criteria.

**Completion Criteria**:
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes or failures are documented.
- [x] Manual `repo analytics` smoke commands are documented with degraded-state notes.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P3-REPO-ANALYTICS | P3-FILE-INTELLIGENCE | COMPLETED |
| TASK-001 | file-intelligence:TASK-001 | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001, file-intelligence:TASK-003 | COMPLETED |
| TASK-004 | TASK-001, TASK-002, TASK-003, file-intelligence:TASK-004 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Completion Criteria

- [x] All requested `repo analytics` subcommands implemented.
- [x] Commit scoring is derived from `scored_commits`, not transcript replay.
- [x] Session/file attribution reuses `P3-FILE-INTELLIGENCE`.
- [x] Missing DB, missing schema, missing rows, and missing dependency states degrade gracefully with explicit provenance.
- [x] Repository-owned analytics index can be rebuilt and queried.
- [x] Cursor-owned files, Cursor-owned databases, and Git history remain read-only.
- [x] Type checking and tests pass.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/main.ts repo analytics summary --json
bun run src/main.ts repo analytics commits --json
bun run src/main.ts repo analytics sessions --json
bun run src/main.ts repo analytics files --json
bun run src/main.ts repo analytics rebuild --json
```

## Risks

- Cursor may change the `ai-code-tracking.db` schema.
- `scored_commits` may be absent, stale, sparse, or not scoped to the active workspace.
- Commit rows are not conversation-keyed in the observed schema.
- File/session attribution depends on `P3-FILE-INTELLIGENCE` and can be stale until rebuild.
- AI percentages are best-effort metadata, not exact authorship.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation-plan authoring only.
**Blockers**: Runtime implementation was intentionally out of scope for that branch.
**Notes**: Plan maps Codex file-change/index and usage aggregation patterns to Cursor `scored_commits` plus normalized file-intelligence attribution.

### Session: 2026-05-07

**Tasks Completed**: Step 4 plan revision only.
**Blockers**: None for implementation planning; `P3-FILE-INTELLIGENCE` dependency drift was reconciled to ready.
**Notes**: Added full workflow-supplied Codex-reference paths with missing-local status, kept the preferred path unchanged, expanded analytics contracts, and marked TASK-002/TASK-003 parallelizable after TASK-001 because their write scopes are disjoint.

### Session: 2026-05-07 Step 6

**Tasks Completed**: TASK-001 through TASK-006.
**Verification**: `task typecheck`, `task test`, `task ci`, and sequential `repo analytics` JSON smoke commands with `CURORT_CLI_AGENT_DATA_DIR=/tmp/curort-repo-analytics-smoke` passed.
**Notes**: Implemented repository analytics contracts, read-only scored commit ingestion with degraded provenance, repository-owned analytics index rebuild/query support, service coordination with file-intelligence rebuilds, CLI subcommands, and focused tests. Local smoke rebuild indexed 72 unique scored commits, 763 sessions, and 313 files; duplicate local `scored_commits` hashes are deduplicated by newest commit date before indexing.

### Session: 2026-05-07 Step 6 Revision

**Tasks Completed**: Addressed Step 7 mid finding for unweighted AI percentage fallback.
**Verification**: `task typecheck`, `task test`, `task ci`, and sequential `repo analytics` JSON smoke commands with `CURORT_CLI_AGENT_DATA_DIR=/tmp/curort-repo-analytics-smoke` passed.
**Notes**: Repository summary now falls back to unweighted v1/v2 AI averages when scored commits include percentages but no usable composer line counts, and stores completeness notes describing that fallback. Added persistence and CLI coverage for missing line-count columns with explicit JSON summary percentages and provenance/completeness details.

### Session: 2026-05-07 Step 6 Revision 2

**Tasks Completed**: Addressed Step 7 mid finding for observed Cursor `scored_commits` TEXT numeric columns.
**Verification**: `task typecheck`, `task test`, `task ci`, and sequential `repo analytics` JSON smoke commands with `CURORT_CLI_AGENT_DATA_DIR=/tmp/curort-repo-analytics-smoke` passed.
**Notes**: The ai-tracking scored-commit reader now accepts finite numeric strings for percentage and line-count fields while rejecting blank/non-numeric values. Added reader and CLI coverage for TEXT `v1AiPercentage`/`v2AiPercentage`, including valid `0.00` preservation. Local smoke summary now reports weightedV1AiPercentage 92.67128030442825 and weightedV2AiPercentage 100 from observed Cursor TEXT percentage values.
