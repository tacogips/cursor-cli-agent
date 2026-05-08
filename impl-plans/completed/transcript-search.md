# Transcript Full-Text Search Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-transcript-search.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-transcript-search.md`

### Summary

Implement backlog slice `P2-TRANSCRIPT-SEARCH`: read-only full-text search across local Cursor transcript JSONL files, with role filters, stable synthetic message IDs, deterministic pagination, scan budgets, and explicit `provenance: "transcript"` results.

### Scope

**Included**: transcript candidate selection from the session index, streaming Cursor transcript scanning, single-session filtering through `--session`, role filters, byte/event/session budgets, pagination, human and JSON CLI output, malformed-line tolerance, and focused service/CLI tests.

**Excluded**: changes to `session search`, bookmark storage, markdown/task extraction, activity summaries, file intelligence, server APIs, SDK exports, daemon work, and any mutation of Cursor transcript files.

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.test.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts`

Reference behavior to preserve:

- reject blank queries
- filter transcript text by role
- enforce `limit`, `offset`, `maxSessions`, `maxBytes`, and `maxEvents`
- surface scan counters plus `truncated` and `timedOut`
- keep candidate ordering and pagination deterministic
- treat malformed or partial transcript input as non-fatal

Intentional Cursor divergences accepted by the design:

- Cursor scans `~/.cursor/projects/*/agent-transcripts/*.jsonl` through Cursor adapter modules instead of Codex rollout files.
- Cursor results include `recordId`, `localSessionId`, `cursorChatId`, and `transcriptPath` instead of only Codex session IDs.
- Cursor message IDs are synthetic and stable from transcript position because observed transcript rows do not provide per-message IDs.
- `system` and `tool` are accepted Cursor-specific role filters, but only match when the transcript adapter can normalize observed rows into those roles.
- Pending `chat_only` records have no transcript hits until materialized.

---

## Modules

### 1. Transcript Search Types

#### `src/types/transcript-search.ts`

**Status**: COMPLETED

```typescript
export type TranscriptSearchRole = "user" | "assistant" | "system" | "tool";

export interface TranscriptSearchOptions {
  readonly query: string;
  readonly sessionId?: string;
  readonly role?: TranscriptSearchRole;
  readonly limit: number;
  readonly offset: number;
  readonly maxSessions?: number;
  readonly maxBytes?: number;
  readonly maxEvents?: number;
  readonly timeoutMs?: number;
}

export interface TranscriptSearchHit {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath: string;
  readonly messageId: string;
  readonly role: TranscriptSearchRole;
  readonly excerpt: string;
  readonly eventOffset: number;
  readonly byteOffset?: number;
  readonly provenance: "transcript";
}

export interface TranscriptSearchResult {
  readonly query: string;
  readonly hits: readonly TranscriptSearchHit[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly scannedSessions: number;
  readonly scannedBytes: number;
  readonly scannedEvents: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
}
```

`timeoutMs` is a service-level deadline input matching the Codex reference. The CLI does not add a user-facing timeout flag in this slice; CLI calls should use a local default constant so `timedOut` is meaningful without expanding the accepted command surface.

**Checklist**:

- [x] Define role, options, hit, and result contracts.
- [x] Include service-level `timeoutMs` support while keeping the CLI flag set limited to the accepted design.
- [x] Keep all Cursor identity fields optional except `recordId` and `transcriptPath`.
- [x] Export contracts for CLI now and bookmark/markdown/server reuse later.

### 2. Transcript Reader Streaming Adapter

#### `src/cursor/transcript-reader.ts`

**Status**: COMPLETED

```typescript
export interface TranscriptSearchLine {
  readonly role: TranscriptSearchRole;
  readonly text: string;
  readonly eventOffset: number;
  readonly byteOffset?: number;
}

export function streamTranscriptSearchLines(
  transcriptPath: string,
): AsyncGenerator<TranscriptSearchLine, void, undefined>;
```

**Checklist**:

- [x] Add a streaming reader path for search without replacing the existing summary reader.
- [x] Preserve current `readTranscriptFile` behavior for session indexing.
- [x] Skip malformed JSONL rows without aborting the scan.
- [x] Normalize observed roles without coercing unknown roles into user/assistant.
- [x] Track event offsets and byte offsets when available.

### 3. Transcript Search Service

#### `src/cursor/transcript-search.ts`

**Status**: COMPLETED

```typescript
export interface TranscriptSearchService {
  search(options: TranscriptSearchOptions): Promise<TranscriptSearchResult>;
}

export const DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS = 30_000;
```

**Checklist**:

- [x] Resolve `--session` through `recordId`, `localSessionId`, or `cursorChatId`.
- [x] Select transcript-backed candidates from `SessionIndexRepository` in `updatedAt DESC, recordId ASC` order.
- [x] Exclude pending `chat_only` records that have no `transcriptPath`.
- [x] Apply role, byte, event, and session budgets during scanning.
- [x] Compute a deadline from `timeoutMs ?? DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS`, check it before and during transcript iteration, stop scanning when exceeded, and surface `timedOut: true`.
- [x] Build stable `messageId` values from transcript event position and role.
- [x] Apply `offset` and `limit` after deterministic hit ordering.
- [x] Return scan counters, `truncated`, and `timedOut` in every result.

### 4. CLI Command

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
curort-cli-agent transcript search <query> [--session <id>] [--role <role>] [--limit <n>] [--offset <n>] [--max-sessions <n>] [--max-bytes <n>] [--max-events <n>] [--json]
```

**Checklist**:

- [x] Add `transcript search` command routing and usage.
- [x] Validate blank query, role enum, positive budget values, positive limit, and non-negative offset.
- [x] Pass the default service timeout; do not add a public `--timeout` flag unless the design is revised.
- [x] Render human output with display session ID, role, message ID, excerpt, and truncation notice.
- [x] Emit the full `TranscriptSearchResult` for `--json`.
- [x] Keep existing `session search` metadata behavior unchanged.

### 5. Tests and Verification Fixtures

#### `src/cursor/transcript-search.test.ts`
#### `src/cursor/transcript-reader.test.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
describe("transcript full-text search", () => {
  // service, reader, and CLI contract tests
});
```

**Checklist**:

- [x] Cover case-insensitive matching, role filters, and no-match behavior.
- [x] Cover deterministic ordering and pagination.
- [x] Cover `maxSessions`, `maxBytes`, and `maxEvents` truncation.
- [x] Cover deadline timeout behavior by injecting a tiny `timeoutMs` or controllable clock and asserting `timedOut: true`.
- [x] Cover malformed transcript lines as skipped non-fatal input.
- [x] Cover `--session` resolution by `recordId`, `localSessionId`, and `cursorChatId`.
- [x] Cover pending chat-only records returning no transcript hits.

---

## Work Breakdown

### TASK-001: Search Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/transcript-search.ts`
**Dependencies**: `impl-plans/completed/session-search.md`

**Completion Criteria**:

- [x] Type contracts compile under strict TypeScript.
- [x] Service options include timeout input compatible with `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts`.
- [x] Hit contract includes stable message IDs and transcript provenance.
- [x] Contracts preserve Cursor identity fields needed by bookmarks and markdown tasks.

### TASK-002: Streaming Transcript Reader

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/transcript-reader.ts`, `src/cursor/transcript-reader.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Search reader streams JSONL and avoids loading large transcript files fully.
- [x] Existing transcript summary tests keep passing.
- [x] Malformed rows and unknown roles are skipped without throwing.
- [x] Event offsets and byte offsets are deterministic.

### TASK-003: Search Service

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/transcript-search.ts`, `src/cursor/transcript-search.test.ts`, any needed candidate helper in `src/persistence/session-index.ts`
**Dependencies**: TASK-001, TASK-002, `impl-plans/completed/session-search.md`

**Completion Criteria**:

- [x] Service scans transcript-backed Cursor sessions through adapter boundaries.
- [x] `--session` identity narrowing works for record, local session, and Cursor chat IDs.
- [x] Role filters, pagination, and scan budgets are enforced.
- [x] Timeout deadline handling follows `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.ts` by setting `timedOut` and stopping the scan.
- [x] Pending chat-only records are skipped for transcript content with clear empty results.
- [x] Result ordering is deterministic across test runs.

### TASK-004: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [x] CLI command validates all supported flags.
- [x] Human and JSON output match the design contract.
- [x] Usage text documents `transcript search`.
- [x] Existing `session search` tests continue to pass unchanged.

### TASK-005: Final Verification and Plan Progress Update

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/transcript-search.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] Completion criteria below are checked as implementation lands.
- [x] Progress log records implemented tasks, verification commands, blockers, and any intentional design deviations.
- [x] `P2-BOOKMARKS` and `P2-MARKDOWN-TASKS` dependency notes remain accurate.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Search types | `src/types/transcript-search.ts` | COMPLETED | `task typecheck` |
| Streaming transcript reader | `src/cursor/transcript-reader.ts` | COMPLETED | `src/cursor/transcript-reader.test.ts` |
| Search service | `src/cursor/transcript-search.ts` | COMPLETED | `src/cursor/transcript-search.test.ts` |
| CLI command | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Plan progress | `impl-plans/completed/transcript-search.md` | COMPLETED | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-TRANSCRIPT-SEARCH | `P2-SESSION-SEARCH` / `impl-plans/completed/session-search.md` | Available |
| P2-BOOKMARKS | Stable transcript message IDs from this plan | Available |
| P2-MARKDOWN-TASKS | Stable transcript extraction boundary from this plan | Available |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts transcript search <query> --json`
- Manual smoke: `bun run src/main.ts transcript search <query> --role assistant --max-events 100`
- Manual smoke: `bun run src/main.ts transcript search <query> --session <recordId-or-chatId> --json`
- Focused test expectation: service timeout coverage asserts `timedOut: true` and bounded scan counters.

## Completion Criteria

- [x] Full-text search scans transcript JSONL content, not only indexed metadata.
- [x] Search supports `--session`, role filters, pagination, and scan budgets.
- [x] Results include stable message IDs, excerpts, transcript provenance, scan counters, and Cursor session identity.
- [x] Timeout checks are implemented with service-level `timeoutMs`, default CLI timeout, `timedOut` results, and focused tests.
- [x] Malformed transcript rows are skipped without aborting the search.
- [x] Pending chat-only sessions do not produce transcript hits until materialized.
- [x] Existing `session search` metadata behavior remains unchanged.
- [x] Verification commands are run or any skipped command is recorded with a reason.

## Progress Log

### Session: 2026-05-05 Step 4 Implementation Plan Creation

**Tasks Completed**: Revised active implementation plan for `P2-TRANSCRIPT-SEARCH` after accepted design review.
**Tasks In Progress**: None.
**Blockers**: None after completed `P2-SESSION-SEARCH`.
**Notes**: Plan now traces directly to `design-docs/specs/design-transcript-search.md`, preserves Codex reference mapping, and makes reader streaming, candidate ordering, identity narrowing, and progress-update work explicit.

### Session: 2026-05-05 Step 4 Review Rerun

**Tasks Completed**: Addressed Step 5 plan review feedback by adding explicit timeout planning, a service-level `timeoutMs`, default CLI timeout guidance, deadline scan behavior, timeout tests, and completion criteria.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The plan keeps the accepted CLI surface unchanged while mapping timeout behavior to `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts` and `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/search.ts`.

### Session: 2026-05-05 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `bun run format`, `task typecheck`, `task test`, `task ci`.
**Notes**: Implemented read-only transcript full-text search with streaming Cursor transcript parsing, stable `event-<offset>-<role>` message IDs, deterministic candidate ordering, role/session filters, pagination, scan budgets, timeout state, human and JSON CLI output, recursive transcript discovery for the observed nested Cursor `agent-transcripts/<id>/<id>.jsonl` layout, and focused reader/service/repository/CLI coverage. No public `--timeout` flag was added; CLI uses `DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS` per the accepted plan.

### Session: 2026-05-05 Step 6 Review Revision

**Tasks Completed**: Addressed Step 7 revision rerun by tightening transcript scan accounting.
**Tasks In Progress**: None.
**Blockers**: Latest Step 7 payload was truncated in the provided execution context and no matching local candidate artifact existed for execution `div-design-and-implement-review-loop-1777949666-19515852`; revision used visible review decision plus design and Codex-reference alignment.
**Verification**: `bun run format`, `bun test src/cursor/transcript-reader.test.ts src/cursor/transcript-search.test.ts`, `task typecheck`, `task test`, `task ci`, `CURORT_CLI_AGENT_DATA_DIR=/tmp/curort-cli-agent-smoke-data CURORT_CLI_AGENT_CURSOR_HOME=/tmp/curort-cli-agent-smoke-cursor bun run src/main.ts transcript search needle --json`.
**Notes**: Added scan-row streaming metadata so malformed and unknown-role transcript rows count toward scan counters and budgets without becoming hits, preserved the searchable-line adapter API, and accepted `input_text` transcript content blocks alongside `text` and `output_text`.

## Related Plans

- **Depends On**: `impl-plans/completed/session-search.md`
- **Next**: `impl-plans/completed/bookmarks.md`, `impl-plans/completed/markdown-tasks.md`
