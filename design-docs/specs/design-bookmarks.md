# Bookmark Lifecycle Design

This document defines the bounded Phase 2 design for backlog slice `P2-BOOKMARKS`.

## Overview

`cursor-cli-agent` will provide local bookmark CRUD and search for Cursor sessions, transcript messages, and transcript ranges. The feature mirrors the useful `codex-agent` bookmark lifecycle while preserving Cursor-specific session identity and transcript materialization rules.

The primary user-facing surface is:

- `bookmark add`
- `bookmark list`
- `bookmark show`
- `bookmark delete`
- `bookmark search`

This slice remains local-only. It does not add server APIs, SDK exports, remote sync, or mutation of Cursor transcript files.

## Behavior

Bookmark targets:

- `session`: references a repository-owned session record, including pending `chat_only` records.
- `message`: references one stable transcript message ID in a transcript-backed session.
- `range`: references inclusive start and end stable transcript message IDs in a transcript-backed session.

Validation rules:

- `session` bookmarks require `sessionId` and must not include message or range fields.
- `message` bookmarks require `sessionId` and `messageId`.
- `range` bookmarks require `sessionId`, `fromMessageId`, and `toMessageId`.
- `message` and `range` bookmarks must resolve against transcript-backed sessions.
- Pending `chat_only` records may only receive `session` bookmarks until a transcript materializes.
- Message and range IDs must use the stable message identity produced by transcript search/reading, not raw Cursor payload object identity.

Bookmark records must preserve:

- type and target identity
- user-facing name
- optional description
- normalized tags
- created and updated timestamps
- raw and display excerpts for message and range bookmarks

## Data Flow

1. CLI parses `bookmark` subcommands and validates basic shape.
2. Bookmark manager resolves the session through the repository-owned session index.
3. For `message` and `range` bookmarks, the manager reads the normalized transcript through Cursor adapter boundaries and validates stable message IDs.
4. Bookmark persistence writes local bookmark records under repository-owned state.
5. Search evaluates stored bookmark metadata and excerpts without scanning or mutating Cursor transcript files.

## Boundaries

Cursor-specific behavior stays behind adapter modules:

- session resolution uses the local session index and Cursor identity adapters
- transcript message lookup uses transcript reader/search normalization
- raw Cursor JSONL payloads are not stored directly in bookmark records

Domain and persistence modules should consume stable repository-owned record shapes rather than Cursor CLI payloads.

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/repository.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/manager.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reused concepts:

- bookmark target types: `session`, `message`, `range`
- add/list/show-or-get/delete/search lifecycle
- local JSON persistence
- tag filtering and text search across bookmark metadata

Intentional divergences:

- `cursor-cli-agent` uses `show` in the command contract where `codex-agent` uses `get`.
- Cursor pending `chat_only` records are valid for `session` bookmarks only.
- Message and range bookmarks require transcript-backed stable Cursor message IDs.
- Bookmark excerpts preserve both raw and display text because Cursor transcript rendering can differ from raw event content.

## Rollout Constraints

- This design depends on the stable transcript message identity from `P2-TRANSCRIPT-SEARCH`.
- Bookmark storage is local-only and should be safe to delete or rebuild independently from Cursor-owned files.
- Server, daemon, GraphQL, SDK, and auth permission surfaces remain future work.

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
- `design-docs/specs/command.md#bookmark-commands`
- `impl-plans/active/bookmarks.md`
- `design-docs/references/README.md`
