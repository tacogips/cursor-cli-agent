# curort-cli-agent

`curort-cli-agent` is a Bun + TypeScript CLI/library for managing `cursor-agent` CLI session data and automation workflows.

This repository is the Cursor-oriented counterpart to `/g/gits/tacogips/codex-agent`.

Current status:

- Phase 1 local CLI implementation is active under `src/`
- Session discovery, metadata search, transcript full-text search, bookmark lifecycle, derived activity, file intelligence, repository analytics, group and queue orchestration, and skill catalog commands have repository-owned implementations
- Design is based on local inspection of `cursor-agent` in this environment on 2026-03-23

## Project Workflows

This repository also ships project-local `divedra` workflows under
`.divedra/workflows`.

- `design-and-implement-review-loop` supports issue intake, design updates,
  self-review plus independent review gates for design, planning, and
  implementation, README and user-facing workflow-skill refresh, and final
  commit/push.
- `codex-agent-concurrent-design-implement-loop` decomposes codex-agent
  functionality, reviews the feature breakdown, fans out feature-local design
  docs and implementation plans at concurrency 10, reviews the full design/plan
  batch, delegates ready plans through `design-and-implement-review-loop`, and
  finishes with an overall review.
- `parity-backlog-design-implement-loop` derives the remaining parity backlog
  from repository design and plan state, selects one ready item at a time, and
  delegates each slice into `design-and-implement-review-loop`.
- `parity-global-design-plan-implement-loop` first updates the global parity
  design, reviews it, creates the full implementation-plan batch, reviews that
  batch, and only then delegates ready plans one at a time into
  `design-and-implement-review-loop`.
- `recent-change-quality-loop` reviews recent committed and uncommitted changes,
  delegates blocking findings into `design-and-implement-review-loop`, and then
  re-reviews until the change set is clean.

Run them from this repository root with:

```bash
task divedra-workflows
task divedra-design-loop-validate
task divedra-parity-backlog-validate
task divedra-global-parity-validate
task divedra-codex-concurrent-validate
task divedra-recent-change-validate
task divedra -- workflow inspect design-and-implement-review-loop --output json
```

Additional usage examples live in [`.divedra/README.md`](.divedra/README.md).

Implemented capabilities:

- Session discovery from `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- Metadata enrichment from `~/.cursor/ai-tracking/ai-code-tracking.db` when available
- Metadata-only `session search <query>` over the repository-owned session index
- Read-only `transcript search <query>` over local Cursor transcript JSONL files with role filters, session narrowing, pagination, scan budgets, transcript provenance, stable synthetic message IDs, and JSON output
- Local `bookmark add/list/show/delete/search` lifecycle for session, message, and transcript range bookmarks with local JSON persistence, tag filtering, deterministic search, and raw/display excerpts for transcript-backed targets
- Derived `activity` records from the session index, transcript mtimes, wrapper-recorded stream/process signals, and stderr/stdout wait patterns, with explicit `provenance: "derived"` signal details
- Local file intelligence from Cursor `~/.cursor/ai-tracking/ai-code-tracking.db`: `files list`, `files snapshots`, `files deleted`, `files find`, and `files rebuild` with explicit provenance, degraded-state reporting, sparse snapshot content opt-in, and a repository-owned rebuildable path index
- Local repository analytics from Cursor `~/.cursor/ai-tracking/ai-code-tracking.db` `scored_commits` plus file-intelligence attribution: `repo analytics summary`, `repo analytics commits`, `repo analytics sessions`, `repo analytics files`, and `repo analytics rebuild` with explicit provenance, completeness notes, repository-owned derived indexes, valid `0%` AI preservation, TEXT numeric column handling, and degraded-state reporting
- Cursor-local group lifecycle controls: `group pause`, `group resume`, `group delete`, and `group watch` with canonical `groups.json` lifecycle/run metadata, legacy group migration, paused-run guards, JSON output, and activity-derived watch summaries
- Cursor-local queue lifecycle controls: `queue pause`, `queue resume`, `queue delete`, `queue update`, `queue move`, `queue mode`, and `queue stop` with canonical `queues.json` lifecycle/item/run metadata, legacy queue migration, paused/stopped run guards, retained completed items, manual-mode skips, JSON output, and progress summaries
- Headless run/resume orchestration via `cursor-agent --print`
- Live transcript watching and normalized event streaming
- Group and queue orchestration on top of Cursor Agent
- Read-only skill catalog support for `~/.cursor/skills-cursor`, `~/.cursor/skills`, and project `.cursor/skills`

Planned capabilities:

- Markdown/task extraction from transcript content
- Optional daemon/server surface after core CLI stabilizes

Bookmark command examples:

```bash
bun run src/main.ts bookmark add --type session --session <id> --name <name> --json
bun run src/main.ts bookmark add --type message --session <id> --message event-0-user --name <name> --json
bun run src/main.ts bookmark list --session <id> --json
bun run src/main.ts bookmark show <bookmark-id> --json
bun run src/main.ts bookmark search <query> --limit 5 --json
bun run src/main.ts bookmark delete <bookmark-id> --json
```

Activity command examples:

```bash
bun run src/main.ts activity --json
bun run src/main.ts activity --session <id> --json
bun run src/main.ts activity --status running --limit 3 --json
```

`activity` supports `idle`, `running`, `waiting_trust`, `waiting_input`,
`completed`, and `failed` statuses. Output is derived from local Cursor evidence
only; optional cached stream/process signals are best-effort and fall back to
index/transcript-derived state when unavailable.

File intelligence command examples:

```bash
bun run src/main.ts files list <session-id> --json
bun run src/main.ts files snapshots <session-id> --json
bun run src/main.ts files snapshots <session-id> --json --include-content
bun run src/main.ts files deleted <session-id> --json
bun run src/main.ts files rebuild --json
bun run src/main.ts files find <path> --json
```

`files list`, `files snapshots`, and `files deleted` resolve known Cursor
sessions through the local session index and read Cursor `ai-tracking` data
without mutating Cursor-owned files or databases. `files rebuild` writes only
repository-owned derived index rows, and `files find` reports whether a stale or
missing index requires another rebuild. Snapshot content is included only when
`--include-content` is supplied.

Repository analytics command examples:

```bash
bun run src/main.ts repo analytics rebuild --json
bun run src/main.ts repo analytics summary --json
bun run src/main.ts repo analytics commits --json --limit 5
bun run src/main.ts repo analytics sessions --json --limit 5
bun run src/main.ts repo analytics files --json --limit 5
```

`repo analytics rebuild` refreshes/imports local Cursor sessions, reads
`scored_commits` through the read-only Cursor ai-tracking adapter, joins
session/file attribution through the file-intelligence layer, and writes only
repository-owned derived analytics. `summary`, `commits`, `sessions`, and
`files` report provenance and completeness notes so missing Cursor databases,
missing scored commits, missing file intelligence, and sparse rows are distinct
from valid zero-valued analytics.

Group lifecycle command examples:

```bash
bun run src/main.ts group pause <name> --json
bun run src/main.ts group resume <name> --json
bun run src/main.ts group delete <name> --force --json
bun run src/main.ts group watch <name> --once --json
```

`group run` refuses paused groups before launching Cursor and re-reads group
lifecycle before each workspace so a mid-run pause stops additional scheduling.
`group watch` derives latest-run workspace totals from repository-owned group
state plus `activity` signals and reports `provenance: "group-store+activity"`.

Queue lifecycle command examples:

```bash
bun run src/main.ts queue pause <name> --json
bun run src/main.ts queue resume <name> --json
bun run src/main.ts queue update <name> --item <id> --status pending --json
bun run src/main.ts queue move <name> --from 0 --to 1 --json
bun run src/main.ts queue mode <name> --item <id> --mode manual --json
bun run src/main.ts queue stop <name> --json
bun run src/main.ts queue delete <name> --force --json
```

`queue run` refuses paused or stopped queues before launching Cursor, re-reads
queue lifecycle before each item, retains completed and failed items with result
metadata, and skips manual-mode items by default. Queue progress derives item
totals from repository-owned queue state plus optional `activity` signals and
reports `provenance: "queue-store+activity"`.

## Design Documents

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `design-docs/specs/design-bookmarks.md`
- `design-docs/specs/design-activity.md`
- `design-docs/specs/design-group-lifecycle.md`
- `design-docs/specs/design-queue-lifecycle.md`
- `design-docs/specs/design-file-intelligence.md`
- `design-docs/specs/design-repository-analytics.md`

## Implementation Plan

- `impl-plans/active/phase1-core-foundation.md`
- `impl-plans/active/parity-backlog-workflow.md`
- `impl-plans/active/parity-global-design-plan-workflow.md`
- `impl-plans/active/session-search.md`
- `impl-plans/active/transcript-search.md`
- `impl-plans/active/bookmarks.md`
- `impl-plans/active/activity.md`
- `impl-plans/active/group-lifecycle.md`
- `impl-plans/active/queue-lifecycle.md`
- `impl-plans/active/file-intelligence.md`
- `impl-plans/active/repository-analytics.md`

## Reference Project

Primary reference:

- `/g/gits/tacogips/codex-agent`

Important difference:

- `codex-agent` is built around Codex rollout files plus a SQLite state DB
- `curort-cli-agent` must treat `cursor-agent` transcripts and headless JSON streams as the source of truth

## Cursor Agent Notes

- `~/.cursor/projects/*/agent-transcripts/*.jsonl` can be used as the primary local conversation log source
- `~/.cursor/ai-tracking/ai-code-tracking.db` can enrich sessions with file-touch and deleted-file data keyed by `conversationId`, and can provide repository-scoped `scored_commits` commit scoring that is not reliably conversation-keyed
- `~/.cursor/skills-cursor/` exists locally and contains built-in Cursor-managed skills
- those built-in skills are useful as discoverable metadata
- they should not be treated as a stable public API or as a writable location for user skills
