# Bookmark Lifecycle Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-bookmarks.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-bookmarks.md`

### Summary

Implement backlog slice `P2-BOOKMARKS`: local bookmark CRUD and search for repository-owned Cursor sessions, stable transcript messages, and inclusive transcript message ranges.

### Scope

**Included**: bookmark contracts, local JSON persistence, transcript message/range lookup, manager validation, CLI `bookmark add/list/show/delete/search`, raw/display excerpts, and focused tests.

**Excluded**: server APIs, SDK exports, daemon events, remote sync, auth/permissions, and mutation of Cursor-owned transcript files.

### Accepted Design References

- `design-docs/specs/design-bookmarks.md`
- `design-docs/specs/command.md#bookmark-commands`
- `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
- `design-docs/specs/design-transcript-search.md`
- `impl-plans/completed/transcript-search.md`

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/bookmark/types.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/bookmark/repository.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/bookmark/manager.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/bookmark/manager.test.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/index.ts`

Reused concepts: target types `session`, `message`, and `range`; local JSON persistence; add/list/show/delete/search lifecycle; tag filtering; text search across bookmark metadata.

Intentional divergences: `cursor-cli-agent` uses `bookmark show` where `codex-agent` uses `get`; pending Cursor `chat_only` records accept only session bookmarks; message/range bookmarks must resolve against stable Cursor transcript IDs (`event-<offset>-<role>`); bookmark excerpts preserve both raw and display text.

---

## Modules

### 1. Bookmark Types

#### `src/types/bookmark.ts`

**Status**: IMPLEMENTED

```typescript
export type BookmarkType = "session" | "message" | "range";

export interface BookmarkExcerpt {
  readonly rawText: string;
  readonly displayText: string;
}

export interface BookmarkRecord {
  readonly id: string;
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly fromMessageId?: string;
  readonly toMessageId?: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly excerpt?: BookmarkExcerpt;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBookmarkInput {
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly fromMessageId?: string;
  readonly toMessageId?: string;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface BookmarkFilter {
  readonly sessionId?: string;
  readonly type?: BookmarkType;
  readonly tag?: string;
}

export interface BookmarkSearchOptions {
  readonly limit?: number;
}

export interface BookmarkSearchHit {
  readonly bookmark: BookmarkRecord;
  readonly score: number;
}

export interface BookmarkSearchResult {
  readonly query: string;
  readonly hits: readonly BookmarkSearchHit[];
  readonly total: number;
  readonly limit?: number;
}
```

**Checklist**:

- [x] Define bookmark data contracts and exported type guards.
- [x] Normalize and deduplicate tags.
- [x] Validate target-specific input shapes without reaching into Cursor payloads.
- [x] Preserve raw/display excerpt fields for message and range bookmarks.

### 2. Bookmark Store

#### `src/config/paths.ts`
#### `src/persistence/bookmarks-store.ts`

**Status**: IMPLEMENTED

```typescript
export function bookmarksJsonPath(): string;

export interface BookmarksStore {
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  get(id: string): Promise<BookmarkRecord | null>;
  save(record: BookmarkRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
```

**Checklist**:

- [x] Store bookmarks in repository-owned local state, expected path `~/.local/share/cursor-cli-agent/bookmarks.json`.
- [x] Use atomic JSON writes and tolerate a missing file as an empty store.
- [x] Preserve deterministic ordering for list/search output.
- [x] Search name, description, tags, session IDs, target IDs, and excerpts.
- [x] Do not persist raw Cursor JSONL payloads.

### 3. Transcript Bookmark Lookup

#### `src/cursor/transcript-bookmark-lookup.ts`

**Status**: IMPLEMENTED

```typescript
export interface TranscriptBookmarkMessage {
  readonly messageId: string;
  readonly role: TranscriptSearchRole;
  readonly eventOffset: number;
  readonly rawText: string;
  readonly displayText: string;
}

export interface TranscriptBookmarkLookup {
  findMessage(transcriptPath: string, messageId: string): Promise<TranscriptBookmarkMessage | null>;
  findRange(
    transcriptPath: string,
    fromMessageId: string,
    toMessageId: string,
  ): Promise<readonly TranscriptBookmarkMessage[]>;
}
```

**Checklist**:

- [x] Reuse transcript-reader normalization and the stable `event-<offset>-<role>` identity used by `P2-TRANSCRIPT-SEARCH`.
- [x] Return `null` for missing message IDs and an empty range for invalid order or missing bounds.
- [x] Keep Cursor transcript parsing behind `src/cursor/` adapter boundaries.
- [x] Produce raw/display text suitable for bookmark excerpts.

### 4. Bookmark Manager

#### `src/bookmarks/manager.ts`

**Status**: IMPLEMENTED

```typescript
export interface BookmarkManager {
  add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  show(id: string): Promise<BookmarkRecord | null>;
  delete(id: string): Promise<boolean>;
  search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
```

**Checklist**:

- [x] Resolve `sessionId` through `SessionIndexRepository.resolveSessionKey`.
- [x] Allow session bookmarks for `chat_only`, `transcript_only`, and `linked` records.
- [x] Reject message/range bookmarks for pending `chat_only` records.
- [x] Validate message/range IDs against transcript-backed sessions before saving.
- [x] Capture raw/display excerpts for message and range bookmarks.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: IMPLEMENTED

```text
cursor-cli-agent bookmark add --type <session|message|range> --session <id> --name <name> [--message <id>] [--from <id>] [--to <id>] [--tag <tag>] [--json]
cursor-cli-agent bookmark list [--session <id>] [--type <type>] [--tag <tag>] [--json]
cursor-cli-agent bookmark show <id> [--json]
cursor-cli-agent bookmark delete <id> [--json]
cursor-cli-agent bookmark search <query> [--limit <n>] [--json]
```

**Checklist**:

- [x] Add command dispatch, usage text, and flag parsing.
- [x] Render concise human output and stable JSON output.
- [x] Return usage errors for invalid bookmark shapes.
- [x] Return not-found errors consistently for missing sessions, messages, ranges, and bookmark IDs.

### 6. Tests

#### `src/persistence/bookmarks-store.test.ts`
#### `src/cursor/transcript-bookmark-lookup.test.ts`
#### `src/bookmarks/manager.test.ts`
#### `src/cli/cli.test.ts`

**Status**: IMPLEMENTED

```typescript
describe("bookmark lifecycle", () => {
  // persistence, transcript lookup, manager validation, and CLI contract tests
});
```

**Checklist**:

- [x] Cover session, message, and range bookmark creation.
- [x] Cover pending `chat_only` restrictions.
- [x] Cover stable `event-<offset>-<role>` lookup and missing message IDs.
- [x] Cover search, delete, not-found behavior, and JSON CLI output.

---

## Work Breakdown

### TASK-001: Bookmark Types and Validators

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/bookmark.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Validators enforce session/message/range field constraints.
- [x] Tag normalization and bookmark type guards are exported.
- [x] Excerpt contracts preserve raw and display text.

### TASK-002: Bookmark Persistence

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/config/paths.ts`, `src/persistence/bookmarks-store.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Store supports list/get/save/delete/search.
- [x] Missing store files read as empty bookmark collections.
- [x] Atomic writes preserve valid JSON.
- [x] Search ordering is deterministic.

### TASK-003: Transcript Bookmark Lookup

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/cursor/transcript-bookmark-lookup.ts`
**Dependencies**: `impl-plans/completed/transcript-search.md`

**Completion Criteria**:

- [x] Lookup recognizes stable transcript message IDs from `P2-TRANSCRIPT-SEARCH`.
- [x] Message lookup returns raw/display excerpts.
- [x] Range lookup returns inclusive messages in transcript order.
- [x] Malformed transcript rows are tolerated consistently with transcript search.

### TASK-004: Bookmark Manager

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/bookmarks/manager.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [x] Manager resolves session IDs through the session index.
- [x] Session bookmarks work for pending and transcript-backed records.
- [x] Message/range bookmarks are rejected for `chat_only` records.
- [x] Message/range bookmarks validate stable IDs before persistence.
- [x] Excerpts are captured and persisted.

### TASK-005: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] All phase-2 bookmark subcommands are available.
- [x] Human output includes bookmark identity, target, name, and tags.
- [x] JSON output returns full bookmark records/search results.
- [x] Invalid operations map to usage or not-found exit paths.

### TASK-006: Test Coverage and Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/persistence/bookmarks-store.test.ts`, `src/cursor/transcript-bookmark-lookup.test.ts`, `src/bookmarks/manager.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Persistence, transcript lookup, manager, and CLI tests pass.
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes or any environment blocker is recorded.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Bookmark types | `src/types/bookmark.ts` | IMPLEMENTED | covered by manager/CLI tests |
| Bookmark store | `src/persistence/bookmarks-store.ts` | IMPLEMENTED | `src/persistence/bookmarks-store.test.ts` |
| Transcript bookmark lookup | `src/cursor/transcript-bookmark-lookup.ts` | IMPLEMENTED | `src/cursor/transcript-bookmark-lookup.test.ts` |
| Bookmark manager | `src/bookmarks/manager.ts` | IMPLEMENTED | `src/bookmarks/manager.test.ts` |
| CLI commands | `src/cli/cli.ts` | IMPLEMENTED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-BOOKMARKS | `P2-TRANSCRIPT-SEARCH` stable message IDs | Available via `impl-plans/completed/transcript-search.md` |
| Phase-4 server bookmark APIs | P2-BOOKMARKS | Future phase |
| SDK exports | P2-BOOKMARKS | Future phase |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts bookmark add --type session --session <id> --name <name> --json`
- Manual smoke: `bun run src/main.ts bookmark add --type message --session <id> --message event-0-user --name <name> --json`
- Manual smoke: `bun run src/main.ts bookmark search <query> --limit 5 --json`
- Manual smoke: verify `chat_only` records reject `bookmark add --type message` and accept `bookmark add --type session`

## Completion Criteria

- [x] Bookmark CRUD works for session, message, and range bookmarks.
- [x] Pending `chat_only` records only accept session bookmarks.
- [x] Message/range bookmarks validate transcript-backed stable message IDs.
- [x] Search returns deterministic local bookmark matches.
- [x] Bookmark data preserves raw and display excerpts without raw Cursor JSONL payloads.
- [x] CLI human and JSON outputs match `design-docs/specs/command.md#bookmark-commands`.
- [x] `task typecheck`, `task test`, and `task ci` pass or blockers are documented.

## Progress Log

### Session: 2026-05-05 Step 4 Implementation Plan Creation

**Tasks Completed**: Revised implementation plan for `P2-BOOKMARKS`.
**Tasks In Progress**: None.
**Blockers**: None; `P2-TRANSCRIPT-SEARCH` plan is completed and provides stable message IDs.
**Notes**: Plan is ready for implementation after Step 3 accepted `design-docs/specs/design-bookmarks.md`.

### Session: 2026-05-05 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-006 for `P2-BOOKMARKS`.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**: `task typecheck`, `task test`, and `task ci` passed.
**Notes**: Implemented local bookmark lifecycle, Cursor transcript lookup, manager validation, CLI commands, and focused tests. Ready for Step 7 implementation review.

## Related Plans

- **Depends On**: `impl-plans/completed/transcript-search.md`
- **Related**: `impl-plans/completed/activity.md`
- **Related**: `impl-plans/completed/markdown-tasks.md`
- **Future**: Phase-4 server and SDK plans expose bookmark APIs after local lifecycle is complete.
