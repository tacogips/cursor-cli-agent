# Phase 1: Core Foundation Implementation Plan

**Status**: Proposed
**Created**: 2026-03-23
**Design References**:

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`

## Goal

Deliver a usable first version of `cursor-cli-agent` that can discover sessions, run/resume Cursor Agent headlessly, and expose stable normalized events.

## Scope

### Included

- project scaffolding with Bun + TypeScript
- Cursor transcript reader
- Cursor stream normalizer
- local SQLite session index
- optional `ai-code-tracking.db` enrichment
- local skill catalog reader
- process manager for `run`, `create`, `resume`, `continue`
- initial session CLI commands

### Excluded

- HTTP server
- daemon management
- bookmarks
- token/auth layer
- file-change indexing

## Work Breakdown

### TASK-001: Project Scaffold

Deliverables:

- package manifest
- TypeScript config
- source tree layout
- test harness

Completion criteria:

- `bun test` runs
- `bun run typecheck` runs

### TASK-002: Cursor Transcript Reader

Deliverables:

- parser for `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- summary extraction helpers
- fixtures based on observed transcript shapes

Completion criteria:

- can read first user and latest assistant text
- ignores unknown content blocks safely

### TASK-003: Cursor Stream Normalizer

Deliverables:

- parser for `stream-json`
- normalized internal event types
- usage/result extraction

Completion criteria:

- handles `system`, `user`, `thinking`, `assistant`, `result`
- deduplicates repeated assistant terminal payloads

### TASK-004: Session Index

Deliverables:

- SQLite-backed index
- filesystem scan of `~/.cursor/projects`
- workspace path resolution from `worker.log`

Completion criteria:

- `session list` works for imported sessions
- imported sessions show reduced-fidelity metadata clearly

### TASK-004.25: AI Tracking Enricher

Deliverables:

- reader for `~/.cursor/ai-tracking/ai-code-tracking.db`
- per-conversation touched-file aggregates
- deleted-file summaries
- optional tracked-file snapshot lookup

Completion criteria:

- can join DB rows to transcript sessions by `conversationId`
- absence of the DB does not break any command
- session detail can expose enriched metadata when available

### TASK-004.5: Skill Catalog Reader

Deliverables:

- parser for built-in/user/project `SKILL.md`
- metadata model for skill listing
- enforcement that internal `skills-cursor` is read-only

Completion criteria:

- can list built-in skills from `~/.cursor/skills-cursor`
- can distinguish `builtin`, `user`, and `project` scope

### TASK-005: Process Manager

Deliverables:

- headless new run
- resume by session/chat ID
- continue latest
- trust failure detection

Completion criteria:

- `session run` and `session resume` work end-to-end
- exit codes map correctly for trust and process failures

### TASK-006: Session CLI

Deliverables:

- `session list`
- `session show`
- `session watch`
- `session run`
- `session create`
- `session resume`
- `session continue`

Completion criteria:

- commands produce human and JSON output modes
- watch mode follows both transcript append and live process events

## Verification

- fixture-based parser tests
- process integration tests against installed `cursor-agent`
- manual smoke tests in a temp workspace

## Risks

1. Cursor CLI stream schema may change without notice
2. imported transcripts may omit metadata needed for rich listing
3. `worker.log` parsing may be brittle if log format changes

## Exit Criteria

Phase 1 is complete when a user can:

1. list local Cursor sessions
2. inspect a session summary
3. start a new headless session
4. resume an existing session
5. watch a running session as normalized events
