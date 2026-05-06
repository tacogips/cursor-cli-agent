# Cursor AI Tracking File Intelligence

This document defines the Phase 3 `P3-FILE-INTELLIGENCE` slice for local file intelligence in `curort-cli-agent`.

## Overview

File intelligence is a best-effort local view over Cursor conversations and the files Cursor recorded in `~/.cursor/ai-tracking/ai-code-tracking.db`.

The scope is limited to read-only Cursor data ingestion, repository-owned derived indexes, and the local CLI commands:

- `files list <session-id>`
- `files snapshots <session-id>`
- `files deleted <session-id>`
- `files find <path>`
- `files rebuild`

Included:

- normalized file-intelligence types with explicit provenance
- read-only `ai-tracking` adapter behavior for touched files, tracked snapshots, and deleted files
- repository-owned file index rebuild and lookup behavior
- graceful degradation when `ai-code-tracking.db`, tables, or rows are missing
- CLI output for human-readable and JSON modes
- tests for missing enrichment, sparse rows, rebuilds, path lookup, deleted files, and snapshots

Excluded:

- transcript parsing for file changes
- mutation of Cursor transcript files or Cursor-managed `ai-tracking` state
- server routes, daemon watches, SDK exports, commit attribution analytics, or scored commit reporting
- exact patch history reconstruction equivalent to Codex rollout tool logs

## Data Sources

Primary source:

- `~/.cursor/ai-tracking/ai-code-tracking.db`

Relevant tables:

- `ai_code_hashes`: per-conversation touched-file rows keyed by `conversationId`
- `tracked_file_content`: sparse full-content snapshots keyed by `conversationId` and `gitPath`
- `ai_deleted_files`: deleted-file rows keyed by `conversationId` and `gitPath`
- `conversation_summaries`: optional context used only for model/mode/timestamp enrichment

Session identity source:

- repository-owned `SessionIndexRepository`
- `localSessionId` is the preferred `conversationId`
- `cursorChatId` is the fallback when a transcript has not materialized or the local session id is absent
- `recordId` is retained in responses for stable local references but is not treated as a Cursor conversation id unless no better id exists

Repository-owned derived state:

- `files rebuild` may persist a local index under the repository state database or data directory
- derived state must be safe to delete and rebuild
- Cursor-owned files and SQLite rows are read-only inputs

## File Intelligence Model

Every response must expose provenance rather than implying complete ground truth.

Provenance values:

- `ai_tracking`: rows were read from `ai-code-tracking.db`
- `index`: row came from the repository-owned file index built from `ai-tracking`
- `missing_ai_tracking`: the DB was absent, unreadable, or had an incompatible schema
- `missing_rows`: the DB was readable, but no relevant rows existed for the conversation or path
- `unknown`: the session can be resolved, but file state cannot be determined from available local sources

Operations:

- `touched`: a file appears in `ai_code_hashes`
- `deleted`: a file appears in `ai_deleted_files`
- `snapshot`: a file appears in `tracked_file_content`
- `unknown`: only partial file identity is available

Rules:

- Missing enrichment is `unknown`, not `no changes`.
- An empty command result is only a true empty set when the data source was available and relevant rows were checked.
- Absolute paths from `ai_code_hashes.fileName` should be normalized to workspace-relative paths when the session workspace is known; otherwise preserve the recorded path and mark that path provenance as raw.
- `tracked_file_content.content` may be large, so human output should summarize metadata and JSON output should include content only when the command explicitly requests it.
- Deleted files must remain findable even if no tracked snapshot exists.

## CLI Contract

### `files list <session-id>`

Lists touched files for a known Cursor session.

Behavior:

- resolves `<session-id>` through `localSessionId`, `cursorChatId`, or `recordId`
- reads `ai_code_hashes` rows for the resolved conversation id
- groups rows by normalized path
- returns per-file operation, touch count, first/last observed timestamps, model values when present, and provenance
- returns a successful `unknown` response when the session exists but `ai-tracking` data is unavailable

### `files snapshots <session-id>`

Lists tracked file snapshots for a known Cursor session.

Behavior:

- reads `tracked_file_content` rows for the resolved conversation id
- defaults to metadata-only human output
- JSON output may include snapshot content behind an explicit implementation flag such as `--include-content`
- includes `createdAt`, model, extension, path, content byte count, and provenance

### `files deleted <session-id>`

Lists deleted files for a known Cursor session.

Behavior:

- reads `ai_deleted_files` rows for the resolved conversation id
- returns path, deletion timestamp, model, and provenance
- treats missing rows separately from missing DB/schema

### `files find <path>`

Finds sessions associated with a file path.

Behavior:

- uses the repository-owned file index when present
- matches normalized workspace-relative paths and exact raw paths
- includes touched, deleted, and snapshot operations
- reports index freshness and whether results require `files rebuild`
- does not scan transcript content

### `files rebuild`

Rebuilds the repository-owned file intelligence index from local sessions and `ai-tracking`.

Behavior:

- refreshes/imports known Cursor transcript sessions before indexing
- reads `ai_code_hashes`, `ai_deleted_files`, and `tracked_file_content`
- writes only repository-owned derived state
- returns counts for indexed sessions, touched files, deleted files, snapshots, skipped sessions, and provenance
- succeeds with degraded stats when `ai-tracking` is missing

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/service.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/service.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to preserve:

- file commands are local-only and scriptable
- session lookup failures are explicit
- path search uses a rebuildable local index
- rebuild returns deterministic counts and writes atomically
- command output supports structured JSON and compact human output

Intentional Cursor divergences:

- Codex reconstructs file changes from rollout tool events; this project derives file intelligence from Cursor `ai-tracking` tables.
- Codex exposes patch history; this slice exposes tracked snapshots and deleted-file records because Cursor transcripts do not provide reliable patch events.
- Codex can infer operation from tool output; this project must mark unknown or sparse evidence explicitly.
- Cursor `tracked_file_content` stores sparse snapshots, not a complete per-session patch timeline.

## Adapter and Persistence Boundaries

`src/cursor/ai-tracking-reader.ts` remains the only module that knows Cursor `ai-tracking` SQL table shapes.

Domain/service modules consume normalized records only:

- session identity
- file paths
- operation type
- timestamps
- models/extensions
- provenance flags

Persistence modules store only repository-owned derived indexes. They must not update Cursor databases, transcript files, `~/.cursor/skills-cursor`, or any Cursor-managed internal state.

## Verification

Implementation verification should use:

- `task typecheck`
- `task test`
- `task ci`
- `bun run src/main.ts files list <session-id> --json`
- `bun run src/main.ts files snapshots <session-id> --json`
- `bun run src/main.ts files deleted <session-id> --json`
- `bun run src/main.ts files rebuild --json`
- `bun run src/main.ts files find <path> --json`

## Risks

- Cursor may change `ai-code-tracking.db` schema without notice.
- `ai_code_hashes.fileName` may be absolute, workspace-relative, or missing for some rows.
- `tracked_file_content` is sparse and must not be presented as complete history.
- `files find` depends on a rebuildable index and can be stale until `files rebuild` runs.

## Open Questions

None. The design chooses metadata-only snapshot human output and explicit JSON content opt-in to avoid accidental large terminal output.

## References

See `design-docs/references/README.md` for external references.
