# Repository Analytics Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-repository-analytics.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-repository-analytics.md`

### Summary

Implement backlog slice `P3-REPO-ANALYTICS`: local-only repository and commit analytics derived from Cursor `ai-code-tracking.db`, scored commits, and the `P3-FILE-INTELLIGENCE` layer, with explicit provenance and graceful degradation when sources are missing or sparse.

### Scope

**Included**: normalized analytics types, read-only `scored_commits` adapter access, repository-owned analytics index, analytics service orchestration, CLI commands, and focused tests.

**Excluded**: runtime code implementation in this planning branch, mutation of Cursor-owned files or databases, Git history mutation, server APIs, daemon watches, SDK exports, dashboards, exact per-line authorship, and direct transcript parsing for file changes.

### Dependencies

- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, `stateDbPath`, `aiTrackingDbPath`, Cursor path config, and current CLI command structure.
- `P3-FILE-INTELLIGENCE`: normalized file/session attribution, file index rebuild/find behavior, and provenance contracts.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/types.ts`: reference file operation, summary, history, index, and rebuild stat contracts.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.ts`: reference session lookup, grouping, rebuildable index, path lookup, and atomic save behavior.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.test.ts`: reference tests for changed files, rebuild/find, ordered history, and moved/deleted path treatment.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/usage-stats.ts`: reference local aggregation, recent activity bucketing, cache behavior, and graceful missing-source returns.

Intentional divergences accepted by the design:

- Cursor commit scoring is sourced from `scored_commits`, not Codex rollout events.
- Cursor session/file attribution comes from `P3-FILE-INTELLIGENCE`, not transcript replay.
- `scored_commits` is repository-scoped and not reliably conversation-keyed, so commit scores and session attribution remain separately provenanced.
- Missing DB/schema/rows produce explicit degraded provenance instead of implying no AI attribution or no repository activity.

---

## Modules

### 1. Repository Analytics Types

#### `src/types/repository-analytics.ts`

**Status**: NOT_STARTED

```typescript
export type RepositoryAnalyticsProvenance =
  | "ai_tracking"
  | "file_intelligence"
  | "git"
  | "index"
  | "missing_ai_tracking"
  | "missing_scored_commits"
  | "missing_file_intelligence"
  | "missing_rows"
  | "unknown";

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
```

**Checklist**:

- [ ] Define commit, repository, session, file, rebuild, and degraded result types.
- [ ] Preserve explicit provenance and completeness notes on every response.
- [ ] Keep commit analytics separate from session attribution unless a reliable join is present.
- [ ] Export types for adapters, persistence, service, and CLI.

### 2. Cursor AI Tracking Analytics Reader

#### `src/cursor/ai-tracking-reader.ts`

**Status**: NOT_STARTED

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

- [ ] Keep `scored_commits` SQL and schema fallbacks isolated in the Cursor adapter.
- [ ] Open `ai-code-tracking.db` read-only and close handles deterministically.
- [ ] Return degraded availability/provenance metadata when DB, schema, columns, or rows are missing.
- [ ] Sort and limit rows deterministically for CLI callers.

### 3. Repository Analytics Index

#### `src/persistence/repository-analytics-index.ts`

**Status**: NOT_STARTED

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

- [ ] Store repository-owned derived rows, not Cursor-owned state.
- [ ] Replace derived analytics atomically during rebuild.
- [ ] Store commit scores, session/file rollups, timestamps, provenance, and completeness notes.
- [ ] Treat missing or stale index as recoverable degraded analytics.

### 4. Repository Analytics Service

#### `src/repository-analytics/manager.ts`

**Status**: NOT_STARTED

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

- [ ] Coordinate session index reads, scored commit reads, file-intelligence summaries, and analytics index writes.
- [ ] Compute weighted AI percentages only when line counts are present.
- [ ] Preserve valid `0` AI percentages as explicit scored values.
- [ ] Return degraded success for missing optional sources.
- [ ] Avoid direct transcript parsing for file changes.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
async function runRepoAnalytics(argv: string[]): Promise<number>;
```

**Checklist**:

- [ ] Add `repo analytics summary [--json]`.
- [ ] Add `repo analytics commits [--json] [--limit <n>]`.
- [ ] Add `repo analytics sessions [--json]`.
- [ ] Add `repo analytics files [--json]`.
- [ ] Add `repo analytics rebuild [--json]`.
- [ ] Render provenance and degraded-state messages in human output.

### 6. Tests

#### `src/cursor/ai-tracking-reader.test.ts`, `src/persistence/repository-analytics-index.test.ts`, `src/repository-analytics/manager.test.ts`, `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
interface RepositoryAnalyticsTestMatrix {
  readonly hasScoredCommits: boolean;
  readonly hasFileIntelligence: boolean;
  readonly rebuiltIndex: boolean;
}
```

**Checklist**:

- [ ] Cover missing DB, missing `scored_commits`, and missing columns degradation.
- [ ] Cover valid zero AI percentages and weighted percentage calculations.
- [ ] Cover sparse file-intelligence dependency results.
- [ ] Cover `repo analytics rebuild` and subsequent list/summary reads.
- [ ] Cover JSON output provenance for all subcommands.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Repository analytics types | `src/types/repository-analytics.ts` | NOT_STARTED | - |
| AI tracking analytics reader | `src/cursor/ai-tracking-reader.ts` | NOT_STARTED | planned |
| Repository analytics index | `src/persistence/repository-analytics-index.ts` | NOT_STARTED | planned |
| Repository analytics service | `src/repository-analytics/manager.ts` | NOT_STARTED | planned |
| CLI commands | `src/cli/cli.ts` | NOT_STARTED | planned |
| Test coverage | `src/**/*.test.ts` | NOT_STARTED | planned |

## Work Breakdown

### TASK-001: Repository Analytics Contracts

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/types/repository-analytics.ts`, export wiring
**Dependencies**: file-intelligence:TASK-001

**Description**:
Define strict commit, summary, session attribution, file attribution, provenance, completeness, and rebuild stat contracts.

**Completion Criteria**:
- [ ] Types compile under strict TypeScript.
- [ ] Types include explicit degraded provenance and completeness notes.
- [ ] Contracts keep commit scoring separate from session/file attribution.

### TASK-002: Cursor Scored Commits Reader

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/ai-tracking-reader.ts`, `src/cursor/ai-tracking-reader.test.ts`
**Dependencies**: TASK-001

**Description**:
Extend the read-only Cursor adapter to query `scored_commits` with schema-safe degradation.

**Completion Criteria**:
- [ ] DB missing/unreadable returns degraded availability.
- [ ] Missing `scored_commits` table or columns returns `missing_scored_commits`.
- [ ] Valid zero percentages remain distinguishable from missing values.
- [ ] Tests cover observed local table shapes.

### TASK-003: Repository Analytics Index

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/repository-analytics-index.ts`, `src/persistence/repository-analytics-index.test.ts`
**Dependencies**: TASK-001, file-intelligence:TASK-003

**Description**:
Add a rebuildable local analytics index for scored commits and session/file rollups.

**Completion Criteria**:
- [ ] Rebuild replaces derived rows atomically.
- [ ] Summary, commit, session, and file queries return deterministic ordering.
- [ ] Index stats report freshness, skipped rows, and provenance.
- [ ] Tests cover missing/stale index behavior.

### TASK-004: Repository Analytics Service

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/repository-analytics/manager.ts`, `src/repository-analytics/index.ts`, `src/repository-analytics/manager.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, file-intelligence:TASK-004

**Description**:
Coordinate scored commits, session index data, file-intelligence attribution, degraded provenance, and analytics index rebuild/read behavior.

**Completion Criteria**:
- [ ] Summary computes weighted percentages from available line counts.
- [ ] Missing file intelligence degrades session/file analytics without failing commit analytics.
- [ ] Commit scoring does not imply conversation-level attribution.
- [ ] Tests cover sparse rows and mixed provenance.

### TASK-005: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**:
Add `repo analytics` subcommands with JSON and human output, validation, and exit-code behavior aligned with existing CLI conventions.

**Completion Criteria**:
- [ ] All five requested subcommands are routed.
- [ ] `--json` emits stable structured results.
- [ ] Human output reports provenance and degraded states.
- [ ] Validation covers unknown action and invalid limit values.

### TASK-006: Verification and Plan Closure

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: implementation-plan progress updates
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run project automation, record progress, and update completion criteria.

**Completion Criteria**:
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes or failures are documented.
- [ ] Manual `repo analytics` smoke commands are documented with degraded-state notes.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P3-REPO-ANALYTICS | P3-FILE-INTELLIGENCE | BLOCKED |
| TASK-001 | file-intelligence:TASK-001 | BLOCKED |
| TASK-002 | TASK-001 | BLOCKED |
| TASK-003 | TASK-001, file-intelligence:TASK-003 | BLOCKED |
| TASK-004 | TASK-001, TASK-002, TASK-003, file-intelligence:TASK-004 | BLOCKED |
| TASK-005 | TASK-004 | BLOCKED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | BLOCKED |

## Completion Criteria

- [ ] All requested `repo analytics` subcommands implemented.
- [ ] Commit scoring is derived from `scored_commits`, not transcript replay.
- [ ] Session/file attribution reuses `P3-FILE-INTELLIGENCE`.
- [ ] Missing DB, missing schema, missing rows, and missing dependency states degrade gracefully with explicit provenance.
- [ ] Repository-owned analytics index can be rebuilt and queried.
- [ ] Cursor-owned files, Cursor-owned databases, and Git history remain read-only.
- [ ] Type checking and tests pass.

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

## Open Questions

None.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation-plan authoring only.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation is intentionally out of scope for this branch; implementation depends on `P3-FILE-INTELLIGENCE`.
**Notes**: Plan maps Codex file-change/index and usage aggregation patterns to Cursor `scored_commits` plus normalized file-intelligence attribution, preserving explicit degraded provenance.
