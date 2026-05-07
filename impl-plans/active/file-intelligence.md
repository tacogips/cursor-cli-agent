# File Intelligence Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-file-intelligence.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-file-intelligence.md`

### Summary

Implement backlog slice `P3-FILE-INTELLIGENCE`: local-only `files list`, `files snapshots`, `files deleted`, `files find`, and `files rebuild` behavior derived from Cursor `ai-code-tracking.db`, with explicit provenance and graceful degradation when enrichment rows are missing.

### Scope

**Included**: normalized file-intelligence types, read-only Cursor `ai-tracking` file queries, repository-owned rebuildable file index, service orchestration, CLI commands, and focused tests.

**Excluded**: runtime code implementation in this planning branch, transcript-derived patch history, server APIs, daemon watches, SDK exports, commit attribution analytics, and mutation of Cursor-owned files or databases.

### Dependencies

- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, `stateDbPath`, `aiTrackingDbPath`, `loadAiTrackingEnrichment`, Cursor path config, and current CLI command structure.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/types.ts`: reference file operation, summary, history, index, and rebuild stat contracts.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.ts`: reference session lookup, grouping, rebuildable index, path lookup, and atomic save behavior.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/index.ts`: reference export boundary.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.test.ts`: reference tests for changed files, rebuild/find, ordered history, and moved/deleted path treatment.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/index.ts`: reference `files list`, `files patches`, `files find`, and `files rebuild` command shape.

Intentional divergences accepted by the design:

- Cursor file intelligence is sourced from `ai-code-tracking.db`, not rollout JSONL tool logs.
- Cursor exposes `snapshots` and `deleted` instead of Codex `patches`.
- Missing DB/schema/rows produce explicit degraded provenance instead of implying no file changes.
- Snapshot content is sparse and must be opt-in for JSON output.

---

## Modules

### 1. File Intelligence Types

#### `src/types/file-intelligence.ts`

**Status**: NOT_STARTED

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

- [ ] Define operations and provenance states.
- [ ] Define list, snapshot, deleted, find, and rebuild result types.
- [ ] Preserve `recordId`, resolved session id, and conversation id fields.
- [ ] Export types for adapters, persistence, service, and CLI.

### 2. AI Tracking File Reader

#### `src/cursor/ai-tracking-reader.ts`

**Status**: NOT_STARTED

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

- [ ] Keep SQL and schema fallbacks isolated in the Cursor adapter.
- [ ] Open `ai-code-tracking.db` read-only and close handles deterministically.
- [ ] Return degraded availability/provenance metadata when DB, schema, or rows are missing.
- [ ] Support snapshot metadata without loading content unless requested.

### 3. File Intelligence Index

#### `src/persistence/file-intelligence-index.ts`

**Status**: NOT_STARTED

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

- [ ] Store repository-owned derived rows, not Cursor-owned state.
- [ ] Support atomic rebuild semantics.
- [ ] Store operation, normalized path, raw path, session identity, timestamps, and provenance.
- [ ] Treat missing or stale index as a recoverable `files find` condition.

### 4. File Intelligence Service

#### `src/file-intelligence/manager.ts`

**Status**: NOT_STARTED

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

- [ ] Resolve session ids through `SessionIndexRepository.resolveSessionKey`.
- [ ] Prefer `localSessionId`, then `cursorChatId`, as `conversationId`.
- [ ] Normalize absolute paths against known workspace paths.
- [ ] Return `unknown` provenance for missing enrichment without failing known-session commands.
- [ ] Fail unknown sessions with the existing CLI not-found behavior.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
async function runFiles(argv: string[]): Promise<number>;
```

**Checklist**:

- [ ] Add `files list <session-id> [--json]`.
- [ ] Add `files snapshots <session-id> [--json] [--include-content]`.
- [ ] Add `files deleted <session-id> [--json]`.
- [ ] Add `files find <path> [--json]`.
- [ ] Add `files rebuild [--json]`.
- [ ] Render provenance and degraded-state messages in human output.

### 6. Tests

#### `src/cursor/ai-tracking-reader.test.ts`, `src/persistence/file-intelligence-index.test.ts`, `src/file-intelligence/manager.test.ts`, `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
interface FileIntelligenceTestMatrix {
  readonly rebuiltIndex: boolean;
}
```

**Checklist**:

- [ ] Cover missing DB and missing schema degradation.
- [ ] Cover touched, deleted, and snapshot rows joined by conversation id.
- [ ] Cover `files find` after rebuild.
- [ ] Cover unknown session and blank path validation.
- [ ] Cover JSON output provenance for all subcommands.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| File intelligence types | `src/types/file-intelligence.ts` | NOT_STARTED | - |
| AI tracking file reader | `src/cursor/ai-tracking-reader.ts` | NOT_STARTED | planned |
| File intelligence index | `src/persistence/file-intelligence-index.ts` | NOT_STARTED | planned |
| File intelligence service | `src/file-intelligence/manager.ts` | NOT_STARTED | planned |
| CLI commands | `src/cli/cli.ts` | NOT_STARTED | planned |
| Test coverage | `src/**/*.test.ts` | NOT_STARTED | planned |

## Work Breakdown

### TASK-001: File Intelligence Contracts

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/file-intelligence.ts`, export wiring
**Dependencies**: phase1-core-foundation:TASK-004, phase1-core-foundation:TASK-004.25, phase1-core-foundation:TASK-006

**Description**:
Define strict operation, provenance, result, snapshot, deleted-file, find, and rebuild stat contracts.

**Completion Criteria**:
- [ ] Types compile under strict TypeScript.
- [ ] Types include explicit degraded provenance.
- [ ] Contracts preserve session, record, and conversation identity fields.

### TASK-002: Cursor AI Tracking Reader Extensions

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/ai-tracking-reader.ts`, `src/cursor/ai-tracking-reader.test.ts`
**Dependencies**: TASK-001

**Description**:
Extend the read-only Cursor adapter to query touched files, deleted files, and tracked snapshot metadata/content with schema-safe degradation.

**Completion Criteria**:
- [ ] DB missing/unreadable returns degraded availability.
- [ ] Sparse rows return `missing_rows`, not command failure.
- [ ] Snapshot content can be omitted by default.
- [ ] Tests cover the observed local table shapes.

### TASK-003: Repository-Owned File Index

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/file-intelligence-index.ts`, `src/persistence/file-intelligence-index.test.ts`
**Dependencies**: TASK-001

**Description**:
Add a rebuildable local file index for path lookup across known Cursor sessions.

**Completion Criteria**:
- [ ] Rebuild replaces derived rows atomically.
- [ ] Find matches normalized and raw paths.
- [ ] Index stats report freshness and provenance.
- [ ] Tests cover stale/missing index behavior.

### TASK-004: File Intelligence Service

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/file-intelligence/manager.ts`, `src/file-intelligence/index.ts`, `src/file-intelligence/manager.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Coordinate session resolution, ai-tracking reads, path normalization, degraded provenance, and index rebuild/find behavior.

**Completion Criteria**:
- [ ] Known session with missing enrichment returns `unknown` provenance.
- [ ] Unknown session returns not-found behavior for CLI callers.
- [ ] Deleted files and snapshots are exposed separately.
- [ ] Path normalization handles workspace-relative and raw paths.

### TASK-005: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**:
Add `files` subcommands with JSON and human output, validation, and exit-code behavior aligned with existing CLI conventions.

**Completion Criteria**:
- [ ] All five requested subcommands are routed.
- [ ] `--json` emits stable structured results.
- [ ] Human output reports provenance and degraded states.
- [ ] Validation covers missing session id, missing path, and unknown action.

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
- [ ] Manual `files` smoke commands are documented with degraded-state notes.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P3-FILE-INTELLIGENCE | phase1-core-foundation:TASK-004, phase1-core-foundation:TASK-004.25, phase1-core-foundation:TASK-006 | READY |
| TASK-002 | TASK-001 | BLOCKED |
| TASK-003 | TASK-001 | BLOCKED |
| TASK-004 | TASK-001, TASK-002, TASK-003 | BLOCKED |
| TASK-005 | TASK-004 | BLOCKED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | BLOCKED |

## Completion Criteria

- [ ] All requested `files` subcommands implemented.
- [ ] File intelligence is derived from `ai-tracking`, not transcript replay.
- [ ] Missing DB, missing schema, and missing rows degrade gracefully with explicit provenance.
- [ ] Repository-owned file index can be rebuilt and queried by path.
- [ ] Cursor-owned files and databases remain read-only.
- [ ] Type checking and tests pass.

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

- Cursor may change the `ai-code-tracking.db` schema.
- `ai_code_hashes.fileName` may not always normalize cleanly to a workspace-relative path.
- Snapshot rows are sparse and may be absent even for sessions with code touches.
- `files find` can be stale until `files rebuild` runs.

## Open Questions

None.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation-plan authoring only.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation is intentionally out of scope for this branch.
**Notes**: Plan maps Codex file-change behavior to Cursor `ai-tracking` enrichment, replaces Codex patch history with Cursor snapshots/deleted-file views, and preserves explicit degraded provenance.
