# Phase 1: Core Foundation Implementation Plan

**Status**: In Progress
**Created**: 2026-03-23
**Design References**:

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`

## Goal

Deliver a usable first version of `cursor-cli-agent` that can discover sessions, create and materialize chat-backed sessions, run/resume Cursor Agent headlessly, expose stable normalized events, and support foundational group/queue orchestration.

## Scope

### Included

- project scaffolding with Bun + TypeScript
- Cursor transcript reader
- Cursor stream normalizer
- local SQLite session index
- pending chat-only session records for `session create`
- optional `ai-code-tracking.db` enrichment
- local skill catalog reader
- process manager for `run`, `create`, `resume`, `continue`
- initial session CLI commands
- foundational group and queue commands

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
- message view model with `rawText`, `displayText`, and optional `structured.userQueryText`
- fixtures based on observed transcript shapes

Completion criteria:

- can read first user and latest assistant text
- preserves wrapper-marked transcript text such as `<user_query>...</user_query>` without information loss
- derives `displayText` and `structured.userQueryText` when the wrapper format is recognized
- ignores unknown content blocks safely

### TASK-003: Cursor Stream Normalizer

Deliverables:

- parser for `stream-json`
- normalized internal event types
- normalized live message model aligned with transcript replay
- usage/result extraction

Completion criteria:

- handles `system`, `user`, `thinking`, `assistant`, `result`
- emits the same message shape for replayed and live messages
- deduplicates repeated assistant terminal payloads

### TASK-004: Session Index

Deliverables:

- SQLite-backed index
- filesystem scan of `~/.cursor/projects`
- workspace path resolution from `worker.log`
- alias resolution across `localSessionId` and `cursorChatId`
- pending `chat_only` records created before transcript materialization

Completion criteria:

- `session list` works for imported sessions and pending chat-only records
- `session show <session-id-or-chat-id>` resolves indexed records through either ID form
- transcript materialization links back to an existing pending chat record instead of creating a duplicate
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
- chat creation without transcript materialization
- resume by session/chat ID
- continue latest
- trust failure detection

Completion criteria:

- `session create`, `session run`, and `session resume` work end-to-end
- `session resume <chatId>` upgrades the existing pending record when the transcript appears
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
- `session attach`

Completion criteria:

- commands produce human and JSON output modes
- `session list` clearly labels pending chat-only records
- `session show` exposes display-oriented text for humans and raw/display message data in JSON output
- watch mode accepts transcript IDs and chat IDs, follows pending-to-materialized transitions, and then follows transcript append plus live process events
- `session attach` resolves both transcript-backed session IDs and pending/materialized chat IDs

### TASK-007: Group Commands

Deliverables:

- `group create`
- `group list`
- `group show`
- `group add`
- `group remove`
- `group run`

Completion criteria:

- groups can persist workspace membership independently of transient Cursor state
- `group run` can execute a prompt across member workspaces using the phase-1 session/process foundation

### TASK-008: Queue Commands

Deliverables:

- `queue create`
- `queue list`
- `queue show`
- `queue add`
- `queue remove`
- `queue run`

Completion criteria:

- queues can persist prompt items independently of transient Cursor state
- `queue run` can execute queued prompts for the target workspace using the phase-1 session/process foundation

## Verification

- fixture-based parser tests
- process integration tests against installed `cursor-agent`
- manual smoke tests in a temp workspace
- manual smoke tests for pending chat creation plus transcript materialization
- manual smoke tests for minimal group/queue run flows

## Risks

1. Cursor CLI stream schema may change without notice
2. imported transcripts may omit metadata needed for rich listing
3. `worker.log` parsing may be brittle if log format changes

## Progress Log

### Session: 2026-03-23

**Tasks completed**: Core implementation landed for TASK-001 through TASK-008 in code (CLI, adapters, SQLite index, JSON group/queue stores, Vitest coverage for parsers).

**Still open in this phase**: Process integration tests against a real `cursor-agent` install remain manual. `session watch` uses polling for transcript append and blocks until the process is interrupted; tighter integration with live `cursor-agent` streams is a follow-up refinement.

**Update**: TASK-004.25 (AI tracking enricher) and TASK-004.5 (skill catalog reader) are implemented: `session show` JSON includes optional `aiTracking` enrichment keyed by `localSessionId`/`cursorChatId`; `skill list` and `skill show` expose discovered skills from built-in, user, and project roots (read-only for `skills-cursor`).

### Session: 2026-03-23 (follow-up)

**Alignment and fixes**: Documented phase-1 layering in `architecture.md` (CLI orchestrates repositories until service extraction). Removed unused `SessionIndexRepository.linkChatToTranscript` (import path already merges chat-only rows). Hardened `session watch` (interruptible pending wait; clear polling interval on SIGINT/SIGTERM; `unref` on poll timer) and `session attach` (catch spawn errors). Updated `AGENTS.md` project layout and tacit knowledge to match current `src/` tree.

### Session: 2026-03-23 (architecture review)

**Review**: Confirmed `src/` implementation matches `architecture.md` phase-1 note (CLI orchestrates adapters and repositories) and phase-1 plan scope (session, group, queue, skill, index, AI tracking, parsers). `git diff` tracked changes align with prior scaffold removal and entrypoint wiring; untracked `src/cli/`, `src/cursor/`, `src/persistence/`, etc. carry the substantive implementation.

**Fix**: `session watch` no longer dropped SIGINT/SIGTERM handlers before the first transcript `pump()`; listeners stay active until after the initial read, `watchInterrupted` is honored inside `pump`, and early exit returns `EXIT.OK` before polling starts.

### Session: 2026-03-23 (command-spec alignment)

**Gap**: `design-docs/specs/command.md` shared flags table documents `--sandbox`, `--approve-mcps`, and worktree-related options for headless/resume flows; `process-runner` previously omitted them.

**Change**: Forward `--sandbox`, `--approve-mcps`, `--worktree`, `--worktree-base`, and `--skip-worktree-setup` from CLI flags into `cursor-agent` argv for `session run` and `session resume` (and group/queue runs that delegate to headless streaming). Add `--json` output for `group`/`queue` list, show, create, and structured event lines for `group run` / `queue run` when `--json` is set.

### Session: 2026-03-23 (design/code alignment pass)

**Architecture**: Clarified that `cursor/command-builder` is folded into `process-runner` for phase 1, and that session/group/queue domain behavior lives in `src/cli/` with `src/types/` until extraction.

**Code**: Consolidated `src/cli/cli.ts` imports; use static `spawn` for `session attach`; set `watchInterrupted` when stopping the transcript poll loop on SIGINT/SIGTERM so in-flight `pump` exits promptly; emit errors for missing `group`/`queue` subcommands.

### Session: 2026-03-23 (design implementation review)

**Architecture/design**: Confirmed phase-1 intent (scriptable `cursor-agent`, local index, adapters, pending chat records) matches `architecture.md`, `command.md`, and `design-cursor-session-management.md`; CLI orchestration in `src/cli/` is documented as the phase-1 layering choice.

**Git/diff review**: Tracked changes remove scaffold `lib.ts` and wire `main.ts` to `runCli`; substantive implementation lives in previously untracked `src/cli/`, `src/cursor/`, `src/persistence/`, etc. `bun.lock` should be committed with `package.json` for reproducible installs.

**Fix**: `session watch` registered new SIGINT/SIGTERM handlers for the polling phase before removing the initial `stopWatch` listeners, eliminating a brief window where default signal behavior could run.

**Docs**: `command.md` skill commands section updated from "Phase-1.5" to phase-1 read-only discovery to match shipped `skill list` / `skill show`.

### Session: 2026-03-23 (design verification and attach exit code)

**Architecture**: Re-verified phase-1 goals (`architecture.md`, `command.md`, session management spec) against `src/cli/`, `src/cursor/`, `src/persistence/`, `src/types/`; layering note (CLI orchestrates repositories/adapters) holds. Untracked tree contains the full phase-1 implementation; tracked diff is scaffold removal and entrypoint wiring.

**Fix**: `session attach` now maps the child `cursor-agent` process outcome to CLI exit codes (`EXIT.OK` on success or signal-terminated interactive session; `EXIT.CURSOR` on non-zero exit). `task ci` (fmt-check, typecheck, vitest, build) passes.

### Session: 2026-03-23 (design implementation iteration)

**Architecture**: Re-checked `architecture.md` goals (scriptable `cursor-agent`, transcript index, adapter isolation, pending chat records, optional AI tracking and skill discovery) against `src/cli/`, `src/cursor/`, `src/persistence/`, `src/types/`; behavior matches the documented phase-1 layering (CLI orchestrates repositories and adapters).

**Git/diff**: Previously untracked `src/**` and `bun.lock` carry the phase-1 implementation; they are staged with tracked doc and entrypoint changes so installs and CI are reproducible.

**Fix**: `session watch` polling-phase shutdown handler no longer takes an unused exit-code parameter (same behavior, clearer intent).

### Session: 2026-03-23 (stream parity and continue selection)

**Architecture/design**: Phase-1 intent unchanged; `command.md` updated so `session continue` documents `--stream` / `--json` parity with other headless flows.

**Fix**: `session continue` picks the latest indexed session via `listSessionsForWorkspace` order (`rows[0]`) instead of filtering by `workspaceSlug`, so rows matched only by `workspace_path` still continue correctly. Centralized `resolveStreamMode` / `emitStreamedAgentEvents` so `session run`, `resume`, `continue`, `group run`, and `queue run` share the same `text` / `json` / `events` behavior (`--json` aliases `--stream json`).

### Session: 2026-03-23 (CLI parity with command.md top-level)

**Architecture/design**: `command.md` lists `server` and `daemon` at the top level for phase 2; phase 1 now responds with an explicit not-implemented message and non-zero exit instead of an unknown-command error. `version` reads `package.json` so the printed version stays in sync.

**Docs**: `command.md` documents phase-1 behavior for `server` / `daemon`. `package.json` repository/homepage URLs point at `tacogips/cursor-cli-agent`.

### Session: 2026-03-23 (design alignment and stream validation)

**Architecture/design**: Re-verified `architecture.md` phase-1 layering (CLI orchestrates adapters and repositories; services extracted later) and `command.md` stream contract (`text` | `json` | `events`; `--json` aliases json mode). Implementation matches intended scriptable control plane and session index goals.

**Git/diff review**: Staged diff continues stream-parity work (`resolveStreamMode`, `emitStreamedAgentEvents`, `session continue` via `listSessionsForWorkspace` order, `server`/`daemon` stubs, `version` from package metadata). No contradictions with prior task; repository URLs corrected.

**Fix**: Invalid explicit `--stream <value>` (not `text`, `json`, or `events`) now fails with exit code 2 (usage) and a clear error instead of silently defaulting to `events`.

### Session: 2026-03-23 (architecture verification and command.md clarity)

**Architecture/design**: Phase-1 goals in `architecture.md` (adapters, SQLite index, pending chat records, optional AI tracking and skills, CLI orchestration) remain aligned with `src/`; `listSessionsForWorkspace` orders by `updated_at DESC`, so `session continue` using `rows[0]` matches "most recently updated in the local index" in `command.md`.

**Git/diff review**: Stream helpers (`resolveStreamMode`, `emitStreamedAgentEvents`), `session continue` workspace matching fix, invalid `--stream` handling, `server`/`daemon` phase-1 stubs, and `version` from `package.json` are consistent with prior stream-parity work; no regressions found.

**Docs**: `command.md` shared-flags table clarifies `--json` dual role (structured results vs `--stream json` alias on headless/group/queue runs) and documents invalid `--stream` rejection.

### Session: 2026-03-23 (import record id and headless validation order)

**Architecture/design**: Phase-1 layering unchanged; session index import remains the foreign-session discovery path from `architecture.md`.

**Git/diff review**: Stream helpers and `session continue` selection are consistent; no regressions in intent.

**Fix**: `importTranscriptsFromFilesystem` used `existing?.recordId ?? randomUUID()`, which kept an empty `record_id` from the DB and could violate `NOT NULL` on upsert. Replaced with `stableRecordId()` so only non-empty strings are reused. `session run` / `session resume` / `session continue` now validate prompt, session id, and `--stream` before `openRepo()` and import, so invalid `--stream` returns usage without touching SQLite.

### Session: 2026-03-23 (diff review fixes: text stream and workspace fallback)

**Git/diff review**: Follow-up review found two user-visible issues in the current diff: text-mode headless streaming could print assistant output twice (`session.assistant_message` plus matching `session.completed.result`), and `session resume` / `session attach` ignored indexed `workspacePath` when the caller omitted `--workspace`.

**Fix**: Added per-session text render state in `src/cli/cli.ts` so text-mode output suppresses a duplicate final `session.completed.result` when it matches the already printed assistant message. `session resume` and `session attach` now use `explicit --workspace ?? indexed workspacePath ?? current cwd`, preserving explicit override while making known sessions resume/attach in the correct workspace by default.

**Verification**: `bun run typecheck`, `bun run test`, and `bun run build` pass after the fix.

## Exit Criteria

Phase 1 is complete when a user can:

1. list local Cursor sessions
2. inspect a session summary through either transcript ID or chat ID
3. create a pending chat-backed session and materialize it later
4. start a new headless session
5. resume an existing session
6. attach to a requested session interactively
7. watch a running session as normalized events
8. run a prompt through a saved group
9. run a prompt through a saved queue
