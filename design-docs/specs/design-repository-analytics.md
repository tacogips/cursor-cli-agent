# Cursor Repository Analytics

This document defines the Phase 3 `P3-REPO-ANALYTICS` slice for best-effort repository and commit analytics in `curort-cli-agent`.

## Overview

Repository analytics is a local-only view over Cursor `ai-tracking` data and repository-owned session/file indexes. It summarizes commit-level AI attribution, session/file attribution, provenance, and degraded states without treating Cursor's private SQLite schema as a stable public API.

The scope is limited to read-only Cursor data ingestion, repository-owned derived analytics, and scriptable CLI commands:

- `repo analytics summary`
- `repo analytics commits`
- `repo analytics sessions`
- `repo analytics files`
- `repo analytics rebuild`

Included:

- normalized repository analytics types with explicit provenance
- read-only `scored_commits` access through the Cursor `ai-tracking` adapter
- joins to `P3-FILE-INTELLIGENCE` outputs when available
- repository-owned analytics index for commit, session, and file rollups
- graceful degradation when `ai-code-tracking.db`, `scored_commits`, file intelligence, or Git metadata is missing
- tests for missing enrichment, sparse rows, commit sorting, summary totals, and provenance

Excluded:

- runtime code implementation in this design branch
- mutation of Cursor transcript files, Cursor-managed `ai-tracking` tables, or Git history
- exact per-line authorship beyond the percentages Cursor records
- server routes, daemon watches, SDK exports, dashboards, or remote analytics upload
- replacing the `P3-FILE-INTELLIGENCE` file index

## Data Sources

Primary Cursor source:

- `~/.cursor/ai-tracking/ai-code-tracking.db`

Relevant tables:

- `scored_commits`: commit hash, branch, message, commit date, composer line counts, and AI percentage columns
- `ai_code_hashes`: per-conversation touched-file rows for session/file attribution
- `ai_deleted_files`: deleted-file rows for session/file attribution
- `tracked_file_content`: sparse snapshot metadata for session/file attribution

Repository-owned sources:

- `SessionIndexRepository` for local session identity, workspace, and transcript metadata
- `P3-FILE-INTELLIGENCE` service and index for normalized file operations
- optional Git command output for commit existence checks and current repository metadata

Identity rules:

- `localSessionId` is the preferred Cursor conversation id.
- `cursorChatId` is the fallback conversation id.
- `recordId` remains the stable repository-owned session reference.
- `scored_commits` rows are not conversation-keyed, so commit analytics must report them as repository-scoped unless a later observed schema adds reliable joins.

Repository-owned derived state:

- `repo analytics rebuild` may persist a local analytics index under the repository state database or data directory.
- derived state must be safe to delete and rebuild.
- Cursor-owned files and SQLite rows remain read-only inputs.

## Analytics Model

Every response must state provenance and completeness.

Provenance values:

- `ai_tracking`: rows were read from Cursor `ai-code-tracking.db`
- `file_intelligence`: session/file attribution came from the normalized file-intelligence layer
- `git`: supplemental commit metadata came from local Git commands
- `index`: row came from the repository-owned analytics index
- `missing_ai_tracking`: DB was absent, unreadable, or schema-incompatible
- `missing_scored_commits`: DB was readable but commit scoring rows or columns were unavailable
- `missing_file_intelligence`: file-intelligence dependency was unavailable or stale
- `missing_rows`: relevant tables were readable but no rows matched
- `unknown`: the repository or session can be resolved, but analytics cannot be determined from local data

Core entities:

- commit score: commit hash, branch, message, date, line counts, AI percentage fields, score version, provenance, and completeness notes
- repository summary: commit counts, line totals, weighted AI percentages, branch breakdowns, and stale/degraded flags
- session attribution: session identity plus touched/deleted/snapshot file counts and optional conversation summary metadata
- file attribution: path plus sessions, commits when inferable, operation counts, first/last observed timestamps, and provenance

Rules:

- Missing enrichment is `unknown` or a specific missing provenance state, not `0% AI`.
- A `0%` percentage is valid only when `scored_commits` explicitly contains that value.
- Weighted repository percentages must use line counts when present; otherwise report unweighted averages with a completeness note.
- Commit analytics must not imply session attribution unless a reliable local join exists.
- File analytics should reuse `P3-FILE-INTELLIGENCE` normalized paths and provenance instead of reparsing transcripts.
- Human output should be compact and sort by recency or score; JSON output should include full provenance and completeness details.

## CLI Contract

### `repo analytics summary`

Returns repository-level analytics.

Behavior:

- reads the repository-owned analytics index when present
- reports commit count, scored commit count, total composer lines, weighted AI percentages, top branches, last indexed timestamp, and provenance
- returns degraded success when the repository is known but analytics sources are missing
- accepts `--json`

### `repo analytics commits`

Lists scored commits.

Behavior:

- reads `scored_commits` through the Cursor adapter or the analytics index
- sorts by `commitDate` descending by default
- supports optional limits and JSON output
- includes `commitHash`, `branchName`, `commitMessage`, `commitDate`, `composerLinesAdded`, `composerLinesDeleted`, `v1AiPercentage`, `v2AiPercentage`, and provenance
- distinguishes missing scoring rows from a valid empty result

### `repo analytics sessions`

Summarizes session/file attribution.

Behavior:

- resolves sessions through `SessionIndexRepository`
- joins file counts from `P3-FILE-INTELLIGENCE` when available
- reports touched, deleted, snapshot, and unknown file counts per session
- includes conversation id, record id, workspace path, and provenance
- degrades to session metadata only when file intelligence is missing

### `repo analytics files`

Summarizes file-level attribution.

Behavior:

- reads normalized file history from `P3-FILE-INTELLIGENCE`
- groups by path and operation
- reports session count, operation counts, first/last observed timestamps, and provenance
- does not claim commit-level file attribution unless future local evidence can support it

### `repo analytics rebuild`

Rebuilds the repository-owned analytics index.

Behavior:

- refreshes/imports known Cursor sessions before deriving session/file rollups
- reads `scored_commits` read-only through `src/cursor/ai-tracking-reader.ts`
- reuses the file-intelligence index and reports if it is missing or stale
- writes only repository-owned derived state
- returns counts for indexed commits, indexed sessions, indexed files, skipped rows, and degraded sources

## Codex Reference Mapping

Reference repository root for this workflow run: `/g/gits/tacogips/cursor-cli-agent/codex-agent`.

Relevant files:

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/types.ts` (requested reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.ts` (requested reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/file-changes/service.test.ts` (requested reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/usage-stats.ts` (requested reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/index.ts` (workflow-supplied reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/sqlite.ts` (workflow-supplied reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts` (workflow-supplied reference; missing locally during Step 2)
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/design-docs/specs/design-codex-session-management.md` (workflow-supplied reference; missing locally during Step 2)

Reference behavior to preserve:

- local-only, scriptable analytics over locally available agent data
- explicit session lookup and recoverable missing-source behavior
- grouping by file/session with deterministic sorting
- rebuildable derived state with deterministic stats
- compact human output and stable JSON output

Intentional Cursor divergences:

- Codex derives file changes from rollout tool events; this project derives file/session attribution from Cursor `ai-tracking` and the file-intelligence layer.
- Codex file-change indexes are session-centric; Cursor `scored_commits` is repository-centric and not reliably linked to conversations.
- Codex usage stats aggregate rollout token events; this slice aggregates commit/file/session analytics and does not infer token usage.
- Cursor analytics must identify degraded evidence rather than presenting sparse private tables as complete ground truth.

## Adapter and Persistence Boundaries

`src/cursor/ai-tracking-reader.ts` remains the only module that knows Cursor `ai-tracking` SQL table shapes.

Domain/service modules consume normalized records only:

- scored commit rows
- repository analytics summaries
- session/file attribution summaries
- provenance and completeness flags

Persistence modules store only repository-owned derived indexes. They must not update Cursor databases, transcript files, `~/.cursor/skills-cursor`, or Git repository history.

## Dependencies

- `P1-CORE-FOUNDATION`: session index, Cursor path config, state path config, and CLI structure
- `P3-FILE-INTELLIGENCE`: normalized file/session attribution, file index rebuild, and provenance contracts

## Verification

Implementation verification should use:

- `task typecheck`
- `task test`
- `task ci`
- `bun run src/main.ts repo analytics summary --json`
- `bun run src/main.ts repo analytics commits --json`
- `bun run src/main.ts repo analytics sessions --json`
- `bun run src/main.ts repo analytics files --json`
- `bun run src/main.ts repo analytics rebuild --json`

## Risks

- Cursor may change `ai-code-tracking.db` schema without notice.
- `scored_commits` may be absent, stale, sparse, or not associated with the active workspace.
- Commit rows are not conversation-keyed in the observed schema, so session attribution must remain separate from commit scoring.
- File-intelligence indexes can be stale until rebuilt.
- AI percentages must not be interpreted as exact authorship or policy signals.

## Open Questions

None. The design treats commit scoring and session/file attribution as related but separately provenanced analytics until a reliable local join is observed.

## References

See `design-docs/references/README.md` for external references.
