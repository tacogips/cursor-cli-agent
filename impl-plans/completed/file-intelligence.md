# File Intelligence Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-file-intelligence.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-file-intelligence.md`

### Summary

Implement backlog slice `P3-FILE-INTELLIGENCE`: local-only `files list`, `files snapshots`, `files deleted`, `files find`, and `files rebuild` behavior derived from Cursor `ai-code-tracking.db`, with explicit provenance and graceful degradation when enrichment data is unavailable or sparse.

**Included**: normalized file-intelligence types, read-only Cursor `ai-tracking` file queries, repository-owned rebuildable file index, service orchestration, CLI commands, and focused tests.

**Excluded**: transcript-derived patch history; HTTP handlers for file resources (implemented under the sibling `http-resource-apis` slice, not duplicated here); daemon watches; SDK-only export gaps called out separately; commit attribution analytics; and mutation of Cursor-owned files or databases.

- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, `stateDbPath`, `aiTrackingDbPath`, `loadAiTrackingEnrichment`, Cursor path config, and current CLI command structure.
- `P2-SESSION-SEARCH`: marked ready by workflow intake; no unmet dependency ids.

Requested reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

Inspected fallback reference repository root: `/g/gits/tacogips/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/types.ts` inspected via `/g/gits/tacogips/codex-agent/src/file-changes/types.ts`: reference file operation, summary, history, index, and rebuild stat contracts.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.ts` inspected via `/g/gits/tacogips/codex-agent/src/file-changes/service.ts`: reference session lookup, grouping, rebuildable index, path lookup, and atomic save behavior.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/index.ts` inspected via `/g/gits/tacogips/codex-agent/src/file-changes/index.ts`: reference export boundary.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.test.ts` inspected via `/g/gits/tacogips/codex-agent/src/file-changes/service.test.ts`: reference tests for changed files, rebuild/find, ordered history, and moved/deleted path treatment.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/index.ts` inspected via `/g/gits/tacogips/codex-agent/src/cli/index.ts`: reference `files list`, `files patches`, `files find`, and `files rebuild` command shape.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/server/handlers/files.ts` inspected via `/g/gits/tacogips/codex-agent/src/server/handlers/files.ts`: reference only; server routes are excluded from this slice.

Intentional divergences accepted by the design:

- Cursor file intelligence is sourced from `ai-code-tracking.db`, not rollout JSONL tool logs.
- Cursor exposes `snapshots` and `deleted` instead of Codex `patches`.
- Missing DB/schema/rows produce explicit degraded provenance instead of implying no file changes.
- Snapshot content is sparse and must be opt-in for JSON output.

---

## Modules

### 1. File Intelligence Types

#### `src/types/file-intelligence.ts`

**Status**: COMPLETED

```typescript
export type FileIntelligenceOperation =
  | "touched"
  | "deleted"
  | "snapshot"
  | "unknown";

export type FileIntelligenceProvenance =
  | "ai_tracking"
  | "index"
  | "missing_ai_tracking"
  | "missing_rows"
  | "unknown";

export interface FileIntelligencePathRef {
  readonly path: string;
  readonly pathKind: "workspace_relative" | "absolute" | "raw";
}

export interface SessionFileSummary {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly files: readonly SessionFileEntry[];
  readonly totalFiles: number;
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionFileEntry {
  readonly path: FileIntelligencePathRef;
  readonly operation: FileIntelligenceOperation;
  readonly changeCount: number;
  readonly firstObservedAt?: string;
  readonly lastObservedAt?: string;
  readonly models: readonly string[];
  readonly provenance: FileIntelligenceProvenance;
}
```

**Checklist**:

- [x] Define operations and provenance states.
- [x] Define list, snapshot, deleted, find, and rebuild result types.
- [x] Preserve `recordId`, resolved session id, and conversation id fields.
- [x] Export types for adapters, persistence, service, and CLI.

### 2. AI Tracking File Reader

#### `src/cursor/ai-tracking-reader.ts`

**Status**: COMPLETED

```typescript
export interface AiTrackingFileReader {
  listCodeTouches(conversationId: string): readonly AiTrackingCodeTouch[];
  listTrackedSnapshots(conversationId: string): readonly AiTrackingSnapshot[];
  listDeletedFiles(conversationId: string): readonly AiTrackingDeletedFile[];
  listConversationFileRefs(
    conversationIds: readonly string[],
  ): readonly AiTrackingFileRef[];
}

export interface AiTrackingSnapshot {
  readonly gitPath: string;
  readonly content?: string;
  readonly contentBytes: number;
  readonly fileExtension?: string;
  readonly model?: string;
  readonly createdAt: number;
}
```

**Checklist**:

- [x] Keep SQL and schema fallbacks isolated in the Cursor adapter.
- [x] Open `ai-code-tracking.db` read-only and close handles deterministically.
- [x] Return degraded availability/provenance metadata when DB, schema, or rows are missing.
- [x] Support snapshot metadata by default and load content only when explicitly requested.

### 3. File Intelligence Index

#### `src/persistence/file-intelligence-index.ts`

**Status**: COMPLETED

```typescript
export interface FileIntelligenceIndex {
  rebuild(input: FileIndexRebuildInput): FileIndexRebuildStats;
  findByPath(path: string): FileHistoryResult;
  getStats(): FileIndexStats;
}

export interface FileIndexRebuildStats {
  readonly indexedSessions: number;
  readonly touchedFiles: number;
  readonly deletedFiles: number;
  readonly snapshots: number;
  readonly skippedSessions: number;
  readonly updatedAt: string;
  readonly provenance: FileIntelligenceProvenance;
}
```

**Checklist**:

- [x] Store repository-owned derived rows, not Cursor-owned state.
- [x] Support atomic rebuild semantics.
- [x] Store operation, normalized path, raw path, session identity, timestamps, and provenance.
- [x] Treat missing or stale index as a recoverable `files find` condition.

### 4. File Intelligence Service

#### `src/file-intelligence/manager.ts`

**Status**: COMPLETED

```typescript
export interface FileIntelligenceService {
  listFiles(sessionId: string): Promise<SessionFileSummary>;
  listSnapshots(
    sessionId: string,
    options?: FileSnapshotOptions,
  ): Promise<SessionFileSnapshotResult>;
  listDeleted(sessionId: string): Promise<SessionDeletedFilesResult>;
  findFile(path: string): Promise<FileHistoryResult>;
  rebuild(): Promise<FileIndexRebuildStats>;
}
```

**Checklist**:

- [x] Resolve session ids through `SessionIndexRepository.resolveSessionKey`.
- [x] Prefer `localSessionId`, then `cursorChatId`, as `conversationId`.
- [x] Normalize absolute paths against known workspace paths.
- [x] Return `unknown` provenance for missing enrichment without failing known-session commands.
- [x] Fail unknown sessions with the existing CLI not-found behavior.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
async function runFiles(argv: string[]): Promise<number>;
```

**Checklist**:

- [x] Add `files list <session-id> [--json]`.
- [x] Add `files snapshots <session-id> [--json] [--include-content]`.
- [x] Add `files deleted <session-id> [--json]`.
- [x] Add `files find <path> [--json]`.
- [x] Add `files rebuild [--json]`.
- [x] Render provenance and degraded-state messages in human output.

### 6. Tests

#### `src/cursor/ai-tracking-reader.test.ts`, `src/persistence/file-intelligence-index.test.ts`, `src/file-intelligence/manager.test.ts`, `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
interface FileIntelligenceTestMatrix {
  readonly rebuiltIndex: boolean;
}
```

**Checklist**:

- [x] Cover missing DB and missing schema degradation.
- [x] Cover touched, deleted, and snapshot rows joined by conversation id.
- [x] Cover `files find` after rebuild.
- [x] Cover unknown session and blank path validation.
- [x] Cover JSON output provenance for all subcommands.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| File intelligence types | `src/types/file-intelligence.ts` | COMPLETED | covered through service/CLI compile tests |
| AI tracking file reader | `src/cursor/ai-tracking-reader.ts` | COMPLETED | `src/cursor/ai-tracking-reader.test.ts` |
| File intelligence index | `src/persistence/file-intelligence-index.ts` | COMPLETED | `src/persistence/file-intelligence-index.test.ts` |
| File intelligence service | `src/file-intelligence/manager.ts` | COMPLETED | `src/file-intelligence/manager.test.ts` |
| CLI commands | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Test coverage | `src/**/*.test.ts` | COMPLETED | reader, index, service, CLI |

## Work Breakdown

### TASK-001: File Intelligence Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/file-intelligence.ts`, export wiring
**Dependencies**: phase1-core-foundation:TASK-004, phase1-core-foundation:TASK-004.25, phase1-core-foundation:TASK-006

**Description**:
Define strict operation, provenance, result, snapshot, deleted-file, find, and rebuild stat contracts.

**Completion Criteria**:
- [x] Types compile under strict TypeScript.
- [x] Types include explicit degraded provenance.
- [x] Contracts preserve session, record, and conversation identity fields.

### TASK-002: Cursor AI Tracking Reader Extensions

**Status**: Completed
**Parallelizable**: Yes, after TASK-001; write scope is limited to `src/cursor/ai-tracking-reader.ts` and its tests.
**Deliverables**: `src/cursor/ai-tracking-reader.ts`, `src/cursor/ai-tracking-reader.test.ts`
**Dependencies**: TASK-001

**Description**:
Extend the read-only Cursor adapter to query touched files, deleted files, and tracked snapshot metadata/content with schema-safe degradation.

**Completion Criteria**:
- [x] DB missing/unreadable returns degraded availability.
- [x] Sparse rows return `missing_rows`, not command failure.
- [x] Snapshot content can be omitted by default.
- [x] Tests cover the observed local table shapes.

### TASK-003: Repository-Owned File Index

**Status**: Completed
**Parallelizable**: Yes, after TASK-001; write scope is limited to `src/persistence/file-intelligence-index.ts` and its tests.
**Deliverables**: `src/persistence/file-intelligence-index.ts`, `src/persistence/file-intelligence-index.test.ts`
**Dependencies**: TASK-001

**Description**:
Add a rebuildable local file index for path lookup across known Cursor sessions.

**Completion Criteria**:
- [x] Rebuild replaces derived rows atomically.
- [x] Find matches normalized and raw paths.
- [x] Index stats report freshness and provenance.
- [x] Tests cover stale/missing index behavior.

### TASK-004: File Intelligence Service

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/file-intelligence/manager.ts`, `src/file-intelligence/index.ts`, `src/file-intelligence/manager.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Coordinate session resolution, ai-tracking reads, path normalization, degraded provenance, and index rebuild/find behavior.

**Completion Criteria**:
- [x] Known session with missing enrichment returns degraded provenance.
- [x] Unknown session returns not-found behavior for CLI callers.
- [x] Deleted files and snapshots are exposed separately.
- [x] Path normalization handles workspace-relative and raw paths.

### TASK-005: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**:
Add `files` subcommands with JSON and human output, validation, and exit-code behavior aligned with existing CLI conventions.

**Completion Criteria**:
- [x] All five requested subcommands are routed.
- [x] `--json` emits stable structured results.
- [x] Human output reports provenance and degraded states.
- [x] Validation covers missing session id, missing path, and unknown action.

### TASK-006: Verification and Plan Closure

**Status**: Completed
**Parallelizable**: No
**Deliverables**: implementation-plan progress updates
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run project automation, record progress, and update completion criteria. After implementation, refresh the README and user-facing skill documentation required by the workflow before commit-message generation.

**Completion Criteria**:
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes or failures are documented.
- [x] Manual `files` smoke commands are documented with degraded-state notes.
- [x] README and user-facing skill refresh are explicitly deferred to the dedicated post-implementation workflow step.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P3-FILE-INTELLIGENCE | phase1-core-foundation:TASK-004, phase1-core-foundation:TASK-004.25, phase1-core-foundation:TASK-006, P2-SESSION-SEARCH | READY |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001 | COMPLETED |
| TASK-004 | TASK-001, TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Completion Criteria

- [x] All requested `files` subcommands implemented.
- [x] File intelligence is derived from `ai-tracking`, not transcript replay.
- [x] Missing DB, missing schema, and missing rows degrade gracefully with explicit provenance.
- [x] Repository-owned file index can be rebuilt and queried by path.
- [x] Cursor-owned files and databases remain read-only.
- [x] Type checking and tests pass.
- [x] README and user-facing skill refresh step is deferred to the dedicated workflow step after implementation review.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/main.ts files list <session-id> --json
bun run src/main.ts files snapshots <session-id> --json
bun run src/main.ts files deleted <session-id> --json
bun run src/main.ts files rebuild --json
bun run src/main.ts files find <path> --json
```

## Risks

- Workflow requested root `/g/gits/tacogips/cursor-cli-agent/codex-agent` may remain unavailable for inspection; implementation must preserve requested-path references and use `/g/gits/tacogips/codex-agent` only as the documented fallback.
- Cursor may change the `ai-code-tracking.db` schema.
- `ai_code_hashes.fileName` may not always normalize cleanly to a workspace-relative path.
- Snapshot rows are sparse and may be absent even for sessions with code touches.
- `files find` can be stale until `files rebuild` runs.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Initial design and implementation-plan authoring.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan maps Codex file-change behavior to Cursor `ai-tracking` enrichment, replaces patch history with snapshots/deleted-file views, and preserves degraded provenance.

### Session: 2026-05-07

**Tasks Completed**: Step 4 plan refresh after accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Updated the preferred active plan path in place, preserved issue-resolution scope, added Codex fallback mapping, removed planning-only wording, and included README/user-facing skill refresh expectations.

### Session: 2026-05-07 Step 6 implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `task typecheck`, `task test`, and `task ci` pass. Temporary local-state smoke checks ran `files rebuild --json` and `files find src/a.ts --json` with isolated `CURSOR_CLI_AGENT_DATA_DIR` and `CURSOR_CLI_AGENT_CURSOR_HOME` values.
**Notes**: Implemented local-only file intelligence from Cursor `ai-tracking` tables, repository-owned derived SQLite index, `files list/snapshots/deleted/find/rebuild` CLI commands, JSON/human provenance output, and focused reader/index/service/CLI tests. README and user-facing workflow-skill refresh remain for the dedicated post-implementation workflow step.
