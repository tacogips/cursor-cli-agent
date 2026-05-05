# curort-cli-agent

`curort-cli-agent` is a Bun + TypeScript CLI/library for managing `cursor-agent` CLI session data and automation workflows.

This repository is the Cursor-oriented counterpart to `/g/gits/tacogips/codex-agent`.

Current status:

- Phase 1 local CLI implementation is active under `src/`
- Session discovery, metadata search, transcript full-text search, bookmark lifecycle, derived activity, group and queue orchestration, and skill catalog commands have repository-owned implementations
- Design is based on local inspection of `cursor-agent` in this environment on 2026-03-23

## Project Workflows

This repository also ships project-local `divedra` workflows under
`.divedra/workflows`.

- `design-and-implement-review-loop` supports issue intake, design updates,
  implementation-plan authoring, implementation, review gates, README and
  user-facing workflow-skill refresh, and final commit/push.
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
- Headless run/resume orchestration via `cursor-agent --print`
- Live transcript watching and normalized event streaming
- Group and queue orchestration on top of Cursor Agent
- Read-only skill catalog support for `~/.cursor/skills-cursor`, `~/.cursor/skills`, and project `.cursor/skills`

Planned capabilities:

- Markdown/task extraction from transcript content
- File intelligence
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

## Design Documents

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `design-docs/specs/design-bookmarks.md`
- `design-docs/specs/design-activity.md`

## Implementation Plan

- `impl-plans/active/phase1-core-foundation.md`
- `impl-plans/active/parity-backlog-workflow.md`
- `impl-plans/active/parity-global-design-plan-workflow.md`
- `impl-plans/active/session-search.md`
- `impl-plans/active/transcript-search.md`
- `impl-plans/active/bookmarks.md`
- `impl-plans/active/activity.md`

## Reference Project

Primary reference:

- `/g/gits/tacogips/codex-agent`

Important difference:

- `codex-agent` is built around Codex rollout files plus a SQLite state DB
- `curort-cli-agent` must treat `cursor-agent` transcripts and headless JSON streams as the source of truth

## Cursor Agent Notes

- `~/.cursor/projects/*/agent-transcripts/*.jsonl` can be used as the primary local conversation log source
- `~/.cursor/ai-tracking/ai-code-tracking.db` can enrich sessions with file-touch, deleted-file, and commit-scoring data keyed by `conversationId`
- `~/.cursor/skills-cursor/` exists locally and contains built-in Cursor-managed skills
- those built-in skills are useful as discoverable metadata
- they should not be treated as a stable public API or as a writable location for user skills
