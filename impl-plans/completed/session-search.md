# Session Metadata Search Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-session-search.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-session-search.md`

### Summary

Implement backlog slice `P2-SESSION-SEARCH`: metadata-only `session search <query>` over the repository-owned Cursor session index, with workspace, model, mode, status, limit, offset, and JSON output support.

### Scope

**Included**: local session-index search, exact metadata filters, case-insensitive substring query matching, deterministic pagination, human and JSON CLI output, pending chat-only record support, tests, and plan progress updates.

**Excluded**: transcript full-text search, bookmarks, activity summaries, file intelligence, server APIs, SDK exports, daemon work, and new Cursor CLI invocations.

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.ts`: query validation, paginated result shape, deterministic candidate ordering, and SQLite-first candidate filtering.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.test.ts`: empty query rejection, filter coverage, pagination coverage, and deterministic search behavior.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts`: search option and result contracts.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/sqlite.ts`: SQLite-backed session metadata persistence pattern.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/index.ts`: session API boundary and search export placement.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/server/handlers/sessions.ts`: server search validation/result mapping reference only; server APIs remain excluded for this Cursor slice.

Intentional divergence: this Cursor slice searches indexed metadata fields in `state.db` and returns `CursorSessionRecord` results with `recordId`, `localSessionId`, `cursorChatId`, and `identityState`; it does not scan transcript content.

---

## Modules

### 1. Search Types

#### `src/types/session-search.ts`

**Status**: COMPLETED

```typescript
import type { CursorSessionRecord, SessionMode, SessionStatus } from "./session-record";

export interface SessionSearchFilters {
  readonly workspace?: string;
  readonly model?: string;
  readonly mode?: SessionMode;
  readonly status?: SessionStatus;
}

export interface SessionSearchOptions {
  readonly query: string;
  readonly filters?: SessionSearchFilters;
  readonly limit: number;
  readonly offset: number;
}

export interface SessionSearchHit extends CursorSessionRecord {
  readonly matchFields: readonly string[];
  readonly provenance: "index";
}

export interface SessionSearchResult {
  readonly query: string;
  readonly filters: SessionSearchFilters;
  readonly sessions: readonly SessionSearchHit[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly provenance: "index";
}
```

**Checklist**:

- [x] Add search input, hit, and result types.
- [x] Reuse existing `SessionMode`, `SessionStatus`, and `CursorSessionRecord`.
- [x] Export types from the local type module used by persistence and CLI.

### 2. Session Index Search

#### `src/persistence/session-index.ts`

**Status**: COMPLETED

```typescript
searchSessions(options: SessionSearchOptions): SessionSearchResult;
```

**Checklist**:

- [x] Reject missing or blank query before executing search.
- [x] Refresh callers can continue using `importTranscriptsFromFilesystem()` before search.
- [x] Filter by normalized workspace path and derived `workspaceSlug`.
- [x] Filter exactly by `model`, `mode`, and `status`.
- [x] Query match is case-insensitive substring over `recordId`, `localSessionId`, `cursorChatId`, `workspaceSlug`, `workspacePath`, `model`, `mode`, `status`, `source`, `firstUserText`, and `lastAssistantText`.
- [x] Return `matchFields` for each hit and `provenance: "index"`.
- [x] Order by `updated_at DESC`, then `record_id ASC`, then apply `offset` and `limit`.
- [x] Return an empty result, not an error, when no sessions are indexed.

### 3. CLI Command

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
cursor-cli-agent session search <query> [--workspace <path>] [--model <model>] [--mode <default|plan|ask>] [--status <pending|active|completed|failed|unknown>] [--limit <n>] [--offset <n>] [--json]
```

**Checklist**:

- [x] Add `session search` to usage text.
- [x] Parse required query and supported filters.
- [x] Validate `--mode`, `--status`, positive `--limit`, and non-negative `--offset`.
- [x] Use existing repository open/import lifecycle.
- [x] JSON output emits `query`, `filters`, `sessions`, `total`, `offset`, `limit`, and `provenance`.
- [x] Human output shows selected display ID, pending marker when applicable, workspace slug, status, updated timestamp, and matched fields.
- [x] Unknown flags continue to follow existing parser behavior.

### 4. Tests and Verification

#### `src/persistence/session-index.test.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
describe("session metadata search", () => {
  // repository search tests
  // CLI validation and rendering tests
});
```

**Checklist**:

- [x] Test empty query rejection.
- [x] Test case-insensitive metadata matching.
- [x] Test workspace, model, mode, and status filters.
- [x] Test deterministic ordering and limit/offset pagination.
- [x] Test pending chat-only records remain searchable by chat ID, workspace metadata, and source-derived metadata.
- [x] Test JSON contract includes `matchFields` and `provenance: "index"`.
- [x] Test human output includes pending marker and matched fields.

---

## Work Breakdown

### TASK-001: Search Types and Repository API

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/types/session-search.ts`, `src/persistence/session-index.ts`
**Dependencies**: None

Completion criteria:

- [x] Type contracts compile under strict TypeScript.
- [x] Repository method returns paginated `SessionSearchResult`.
- [x] Filters and query matching use indexed metadata only.
- [x] Pending chat-only records are included when they match.

### TASK-002: CLI Search Command

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`
**Dependencies**: TASK-001

Completion criteria:

- [x] `session search <query>` is documented in usage output.
- [x] Validation errors return usage exit code.
- [x] Human and JSON renderers follow the accepted design contract.

### TASK-003: Search Test Coverage

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/persistence/session-index.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-002

Completion criteria:

- [x] Repository tests cover query, filters, ordering, pagination, and pending records.
- [x] CLI tests cover validation and output contracts.
- [x] Tests avoid network access and use temporary local state.

### TASK-004: Progress and Documentation Refresh

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/session-search.md`, README or user-facing skill docs if implementation changes require discoverability updates
**Dependencies**: TASK-001, TASK-002, TASK-003

Completion criteria:

- [x] Plan progress log records completed tasks and verification results.
- [x] README and user-facing skill refresh step is evaluated by the later workflow node.
- [x] Any intentional design divergence discovered during implementation is documented before review.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Search types | `src/types/session-search.ts` | COMPLETED | `task typecheck` |
| Session index search | `src/persistence/session-index.ts` | COMPLETED | `src/persistence/session-index.test.ts` |
| CLI command | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Plan progress | `impl-plans/completed/session-search.md` | COMPLETED | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-SESSION-SEARCH | Phase 1 session index foundation | Available |
| CLI command | Session index search API | Completed |
| CLI tests | CLI search command | Completed |
| Documentation refresh | Implementation and verification results | Deferred to later workflow node |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts session search <query> --json`
- Manual smoke: `bun run src/main.ts session search <query> --workspace <path> --status pending`

## Completion Criteria

- [x] `session search <query>` searches indexed metadata only.
- [x] Workspace, model, mode, status, limit, and offset inputs are validated.
- [x] JSON output matches `design-docs/specs/design-session-search.md`.
- [x] Human output includes display ID, pending marker, workspace slug, status, updated timestamp, and matched fields.
- [x] Search results are deterministic and newest updated sessions sort first.
- [x] Pending chat-only records are searchable before transcript materialization.
- [x] Transcript full-text search remains out of scope.
- [x] `task ci` passes.

## Progress Log

### Session: 2026-05-05

**Tasks Completed**: Step 4 implementation plan created for `P2-SESSION-SEARCH`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan follows accepted Step 3 design and maps Codex transcript-search reference behavior to Cursor metadata-only index search.

### Session: 2026-05-05 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, and TASK-004 implementation-plan progress update.
**Tasks In Progress**: None.
**Blockers**: Full `task test`/`task ci` currently traverse `divedra/` and `.direnv/flake-inputs/` test suites and fail before/around unrelated submodule runtime dependencies (`bun:sqlite`, `bun:test`, `@anthropic-ai/sdk`, `openai`) and codex adapter dynamic import setup.
**Notes**: Implemented metadata-only `SessionIndexRepository.searchSessions()`, added `session search`, added Bun-focused repository/CLI tests, preserved transcript full-text search as out of scope, and fixed `SessionIndexRepository.upsert()` named-parameter binding so Bun SQLite writes populate the session index correctly.

### Session: 2026-05-05 Step 6 Review Rerun

**Tasks Completed**: Addressed Step 7 review feedback for executable verification by switching the target package test command to Bun-only source-test discovery, converting source tests to `bun:test`, adding strict repository pagination validation for non-integer `limit` and `offset`, and rerunning package CI.
**Tasks In Progress**: None.
**Blockers**: `task divedra-design-loop-validate` and `task divedra-parity-backlog-validate` are blocked in this sandbox because `nix run ./divedra` cannot connect to `/nix/var/nix/daemon-socket/socket`.
**Notes**: `task ci`, `git diff --check`, and an isolated `session search --json` smoke test passed after the rerun changes.

### Session: 2026-05-05 Step 6 Progress Metadata Rerun

**Tasks Completed**: Addressed Step 7 review feedback for plan progress metadata by marking `session-search` completed in `impl-plans/PROGRESS.json`, updating task statuses for TASK-001 through TASK-004, and changing `impl-plans/README.md` from Ready to Completed.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This rerun changed plan metadata only; no TypeScript source changes were required.

### Session: 2026-05-05 Step 3 Batch Planning Refresh

**Tasks Completed**: Preserved completed `P2-SESSION-SEARCH` plan as the canonical dependency for the phase-2 batch.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: No implementation changes required; downstream plans depend on this completed metadata-search slice.

## Related Plans

- **Depends On**: `impl-plans/completed/phase1-core-foundation.md`
- **Related**: `impl-plans/completed/parity-backlog-workflow.md`
