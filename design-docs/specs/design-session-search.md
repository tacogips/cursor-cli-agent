# Session Metadata Search

This document defines the phase-2 `P2-SESSION-SEARCH` slice for searching indexed Cursor session metadata.

## Overview

`session search` must first provide metadata-only search over the repository-owned Cursor session index. This slice deliberately excludes transcript full-text search, bookmarks, activity summaries, file intelligence, server APIs, and public SDK APIs. Those features remain separate phase-2 or later backlog items.

The goal is to let users find known Cursor sessions by indexed metadata without scanning transcript JSONL content. Results must be stable for both human output and JSON output, and must preserve Cursor-specific identity states such as pending chat-only records.

## Source Issue Mapping

- Backlog ID: `P2-SESSION-SEARCH`
- Parent workflow: `parity-backlog-design-implement-loop`
- Delegated workflow: `design-and-implement-review-loop`
- Requested behavior: implement metadata search across indexed Cursor sessions, including filters for workspace, model, mode, and status
- Scope boundary: metadata-only search against the local session index

## Codex Reference Mapping

Use `/Users/taco/gits/tacogips/codex-agent` as the local parity reference.

Relevant reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/types/session.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/sqlite.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/search.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/server/handlers/sessions.ts`

Reference behavior to preserve:

- return paginated result metadata with `total`, `offset`, and `limit`
- support deterministic ordering, newest updated sessions first for search candidates
- filter from a SQLite-backed index before falling back to heavier transcript work
- reject empty search queries instead of treating them as match-all text searches

Intentional Cursor adaptation:

- Codex filters by `cwd`, `source`, and branch over Codex rollout metadata; Cursor filters by `workspaceSlug` or `workspacePath`, `model`, `mode`, `status`, and identity-aware session metadata
- Codex transcript search returns matching session IDs after scanning rollout files; this Cursor slice returns session records matched from indexed metadata only
- Cursor results must expose `recordId`, `localSessionId`, `cursorChatId`, and `identityState` because a Cursor chat can exist before a transcript materializes

## Search Inputs

The CLI command is:

```bash
curort-cli-agent session search <query> [filters]
```

Primary filters for this slice:

- `--workspace <path>`: match sessions whose `workspacePath` resolves to the given absolute path or whose `workspaceSlug` matches the path-derived slug
- `--model <model>`: exact model match against indexed `model`
- `--mode <default|plan|ask>`: exact mode match
- `--status <pending|active|completed|failed|unknown>`: exact status match
- `--limit <n>`: positive integer page size, default aligned with existing session list behavior
- `--offset <n>`: non-negative integer page offset, default `0`
- `--json`: emit the structured result contract

The `<query>` argument is required and applies only to indexed metadata in this slice. It should match against the best available textual metadata:

- `recordId`
- `localSessionId`
- `cursorChatId`
- `workspaceSlug`
- `workspacePath`
- `model`
- `mode`
- `status`
- `firstUserText`
- `lastAssistantText`

Default matching is case-insensitive substring matching. Exact filters are applied in addition to the query.

## Result Contract

JSON output should return:

- `query`
- `filters`
- `sessions`
- `total`
- `offset`
- `limit`
- `provenance`

Each session result should use the existing `CursorSessionRecord` shape and include a match summary:

- `recordId`
- `localSessionId`
- `cursorChatId`
- `identityState`
- `workspaceSlug`
- `workspacePath`
- `transcriptPath`
- `createdAt`
- `updatedAt`
- `materializedAt`
- `source`
- `model`
- `mode`
- `status`
- `firstUserText`
- `lastAssistantText`
- `matchFields`
- `provenance: "index"`

Human output should include the selected display ID, workspace slug, status, updated timestamp, and a concise list of matched fields. Pending chat-only records must retain the same pending marker used by `session list`.

## Data Flow

1. CLI parses `session search <query>` and validates query and filter values.
2. `SessionIndexRepository` imports or refreshes known transcripts from local Cursor project state using the same index-refresh path as `session list`.
3. Search executes against the local `sessions` table only.
4. Workspace filtering resolves the supplied path to an absolute path and compares both `workspace_path` and path-derived `workspace_slug`.
5. Exact filters for model, mode, and status are applied before pagination.
6. Query matching is applied to indexed metadata fields.
7. Results are ordered by `updated_at DESC`, then by `record_id ASC` for deterministic ties.
8. The CLI renders human output or JSON output.

## Validation Rules

- Missing or blank `<query>` returns usage error.
- `--mode` accepts only `default`, `plan`, or `ask`.
- `--status` accepts only `pending`, `active`, `completed`, `failed`, or `unknown`.
- `--limit` must be a positive integer.
- `--offset` must be a non-negative integer.
- `--workspace` should be normalized before comparison.
- Unknown flags should continue to follow the existing CLI parse behavior.

## Cursor CLI Behavior Mapping

No new Cursor CLI invocation is required for this slice. Search reads repository-owned metadata derived from:

- `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- `~/.cursor/projects/*/worker.log`
- the local `state.db` session index

Cursor-specific behavior remains isolated behind existing adapter and persistence boundaries:

- transcript import and workspace resolution stay behind `src/cursor/` and `src/persistence/session-index.ts`
- CLI code should not parse raw Cursor transcript payloads directly for search
- transcript full-text scanning remains out of scope for this backlog item

## Rollout Constraints

- The feature must work when no sessions are indexed and return an empty result, not an error.
- Pending chat-only records are searchable by chat ID, workspace metadata, status, and source even without transcript paths.
- Missing optional fields must not exclude a record unless the caller filters on that field.
- Search must not require network access or remote issue inspection.
- This slice should not introduce server, daemon, or SDK contracts; later phases can reuse the repository search API.

## Open Questions

None for this slice. Transcript full-text search semantics and server/API exposure are separate backlog items.

## References

See `design-docs/specs/command.md`, `design-docs/specs/architecture.md`, and `design-docs/specs/design-codex-agent-parity-gap.md`.
