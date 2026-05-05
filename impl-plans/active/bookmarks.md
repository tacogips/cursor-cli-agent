# Bookmark Lifecycle Implementation Plan

**Status**: Blocked
**Design Reference**: `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
**Created**: 2026-05-05
**Last Updated**: 2026-05-05

---

## Design Document Reference

**Source**: `design-docs/specs/design-codex-agent-parity-gap.md`, `design-docs/specs/design-parity-backlog-workflow.md`, `design-docs/specs/command.md`

### Summary

Implement backlog slice `P2-BOOKMARKS`: local bookmark CRUD and search for sessions, transcript messages, and transcript ranges with Cursor-aware constraints for pending chat-only records.

### Scope

**Included**: bookmark types, JSON persistence, manager validation, CLI `bookmark add/list/show/delete/search`, transcript-backed message/range validation, excerpts, and tests.

**Excluded**: server bookmark APIs, SDK exports, remote sync, and transcript mutation.

### Codex Reference Mapping

- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/repository.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/manager.test.ts`

Intentional divergence: Cursor bookmarks must allow session-level bookmarks on `chat_only` records but reject message/range bookmarks until transcript materialization.

---

## Modules

### 1. Bookmark Types

#### `src/types/bookmark.ts`

**Status**: NOT_STARTED

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
```

**Checklist**:

- [ ] Define bookmark data contracts.
- [ ] Include raw and display excerpts.
- [ ] Export validator helpers for CLI and manager use.

### 2. Bookmark Store

#### `src/persistence/bookmarks-store.ts`

**Status**: NOT_STARTED

```typescript
export interface BookmarksStore {
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  get(id: string): Promise<BookmarkRecord | null>;
  save(record: BookmarkRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
```

**Checklist**:

- [ ] Persist bookmarks under repository-owned local state.
- [ ] Use deterministic IDs and stable ordering.
- [ ] Search name, description, tags, session IDs, and excerpts.
- [ ] Keep persistence independent of raw Cursor payloads.

### 3. Bookmark Manager

#### `src/bookmarks/manager.ts`

**Status**: NOT_STARTED

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

- [ ] Resolve sessions through the session index.
- [ ] Reject message/range bookmarks for chat-only records.
- [ ] Validate message IDs created by transcript search.
- [ ] Capture excerpts for message and range bookmarks.

### 4. CLI Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent bookmark add --type <session|message|range> --session <id> --name <name> [--message <id>] [--from <id>] [--to <id>] [--tag <tag>] [--json]
curort-cli-agent bookmark list [--session <id>] [--type <type>] [--tag <tag>] [--json]
curort-cli-agent bookmark show <id> [--json]
curort-cli-agent bookmark delete <id> [--json]
curort-cli-agent bookmark search <query> [--limit <n>] [--json]
```

**Checklist**:

- [ ] Add command usage and flag parsing.
- [ ] Render concise human output and structured JSON.
- [ ] Return usage errors for invalid bookmark shapes.

### 5. Tests and Verification

#### `src/persistence/bookmarks-store.test.ts`
#### `src/bookmarks/manager.test.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
describe("bookmark lifecycle", () => {
  // persistence, validation, and CLI contract tests
});
```

**Checklist**:

- [ ] Cover session, message, and range bookmarks.
- [ ] Cover pending chat-only restrictions.
- [ ] Cover search, delete, and not-found behavior.

---

## Work Breakdown

### TASK-001: Bookmark Types and Validators

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/bookmark.ts`
**Dependencies**: `transcript-search:TASK-001`

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Validators enforce session/message/range field constraints.
- [ ] Excerpt fields preserve raw and display text.

### TASK-002: Bookmark Persistence

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/bookmarks-store.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [ ] Store supports CRUD and search.
- [ ] Writes are deterministic and local-only.
- [ ] Tests cover empty, corrupt, and existing store states.

### TASK-003: Bookmark Manager

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/bookmarks/manager.ts`
**Dependencies**: TASK-001, TASK-002, `transcript-search:TASK-002`

**Completion Criteria**:

- [ ] Manager resolves sessions and transcript message IDs.
- [ ] Pending chat-only restrictions are enforced.
- [ ] Excerpts are captured for message and range bookmarks.

### TASK-004: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [ ] All bookmark subcommands are available.
- [ ] Human and JSON output are tested.
- [ ] Invalid operations produce clear usage or not-found errors.

### TASK-005: Test Coverage

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/bookmarks-store.test.ts`, `src/bookmarks/manager.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [ ] Persistence, manager, and CLI tests pass.
- [ ] `task typecheck`, `task test`, and `task ci` expectations are recorded.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Bookmark types | `src/types/bookmark.ts` | NOT_STARTED | - |
| Bookmark store | `src/persistence/bookmarks-store.ts` | NOT_STARTED | `src/persistence/bookmarks-store.test.ts` |
| Bookmark manager | `src/bookmarks/manager.ts` | NOT_STARTED | `src/bookmarks/manager.test.ts` |
| CLI commands | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-BOOKMARKS | P2-TRANSCRIPT-SEARCH | Blocked |
| Server bookmark APIs | P2-BOOKMARKS | Future phase |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts bookmark add --type session --session <id> --name <name> --json`
- Manual smoke: `bun run src/main.ts bookmark search <query> --json`

## Completion Criteria

- [ ] Bookmark CRUD works for session, message, and range bookmarks.
- [ ] Chat-only records only accept session bookmarks.
- [ ] Message/range bookmarks validate transcript-backed stable message IDs.
- [ ] Search returns deterministic local bookmark matches.
- [ ] Bookmark data preserves raw and display excerpts.

## Progress Log

### Session: 2026-05-05 Step 3 Batch Planning

**Tasks Completed**: Created implementation plan for `P2-BOOKMARKS`.
**Tasks In Progress**: None.
**Blockers**: Waiting for `P2-TRANSCRIPT-SEARCH` stable message IDs.
**Notes**: Plan is blocked by design dependency, not missing design coverage.

## Related Plans

- **Depends On**: `impl-plans/active/transcript-search.md`
- **Future**: Phase-4 server and SDK plans expose bookmark APIs after local lifecycle is complete.
