# cursor-cli-agent

`cursor-cli-agent` is a planned Bun + TypeScript CLI/library for managing `cursor-agent` CLI session data and automation workflows.

This repository is the Cursor-oriented counterpart to `/g/gits/tacogips/codex-agent`.

Current status:

- Design complete enough to start implementation
- No production code in this repository yet
- Design is based on local inspection of `cursor-agent` in this environment on 2026-03-23

Planned capabilities:

- Session discovery from `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- Metadata enrichment from `~/.cursor/ai-tracking/ai-code-tracking.db` when available
- Headless run/resume orchestration via `cursor-agent --print`
- Live transcript watching and normalized event streaming
- Group and queue orchestration on top of Cursor Agent
- Optional read-only skill catalog support for `~/.cursor/skills-cursor`, `~/.cursor/skills`, and project `.cursor/skills`
- Optional daemon/server surface after core CLI stabilizes

## Design Documents

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`

## Implementation Plan

- `impl-plans/active/phase1-core-foundation.md`

## Reference Project

Primary reference:

- `/g/gits/tacogips/codex-agent`

Important difference:

- `codex-agent` is built around Codex rollout files plus a SQLite state DB
- `cursor-cli-agent` must treat `cursor-agent` transcripts and headless JSON streams as the source of truth

## Cursor Agent Notes

- `~/.cursor/projects/*/agent-transcripts/*.jsonl` can be used as the primary local conversation log source
- `~/.cursor/ai-tracking/ai-code-tracking.db` can enrich sessions with file-touch, deleted-file, and commit-scoring data keyed by `conversationId`
- `~/.cursor/skills-cursor/` exists locally and contains built-in Cursor-managed skills
- those built-in skills are useful as discoverable metadata
- they should not be treated as a stable public API or as a writable location for user skills
