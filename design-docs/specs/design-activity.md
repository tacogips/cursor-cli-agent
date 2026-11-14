# Activity Derivation

This document defines the Phase 2 `P2-ACTIVITY` slice for deriving local Cursor session activity in `cursor-cli-agent`.

## Overview

Activity tracking is a best-effort local view over known Cursor sessions. Cursor does not expose a durable activity table equivalent to the `codex-agent` rollout-derived activity model, so every activity record must identify its provenance as `derived` and explain the signals used to reach the status.

The scope is limited to local CLI and persistence behavior for backlog item `P2-ACTIVITY`.

Included:

- activity status and signal model
- activity derivation service
- optional local signal cache for stream/process observations
- `cursor-cli-agent activity` command
- tests for status derivation, fallback behavior, filtering, and JSON output

Excluded:

- server routes, SSE, daemon supervision, public SDK exports, and remote activity tables
- group or queue pause/resume lifecycle semantics
- mutation of Cursor transcript files or Cursor-managed internal state

## Status Model

Activity statuses:

- `idle`: no active process or recent waiting/failure/completion signal is known
- `running`: a managed Cursor process or normalized stream event indicates active work
- `waiting_trust`: Cursor is blocked by workspace trust or approval-like trust gating
- `waiting_input`: Cursor is blocked waiting for user input, clarification, or an interactive prompt
- `completed`: the latest known run for the session completed successfully
- `failed`: the latest known run failed, exited unsuccessfully, or emitted an error signal

Each activity record must include:

- `recordId`: stable local activity record identity
- `localSessionId`: repository-owned session identity when available
- `cursorChatId`: Cursor chat identity when available
- `status`: one of the supported activity statuses
- `updatedAt`: ISO timestamp for the newest signal used by the current status
- `signals`: ordered signal provenance from process, transcript, stream, stderr/stdout, or index sources
- `provenance`: always `derived`

## Signal Sources

The derivation service should combine available local signals without requiring all of them to exist.

Required input families:

- local session index records, including `chat_only` pending records and indexed status
- managed process state for `session run`, `session resume`, `group run`, and `queue run` executions that this wrapper starts
- transcript metadata such as transcript file path and latest modification time
- normalized stream events emitted by Cursor process adapters
- stderr/stdout patterns that indicate workspace trust, approval, user input, completion, or failure

Optional cache:

- may persist derived stream/process/stderr signals under repository-owned state
- must be treated as a cache, not Cursor ground truth
- absence, corruption, or stale cache entries must not prevent `activity` listing or lookup

## Derivation Rules

Derivation priority is:

1. active managed process state
2. explicit waiting signals from normalized stream or stderr/stdout
3. explicit failure or completion signals from process exit or normalized stream events
4. transcript modification time and indexed session status
5. default `idle` fallback for known sessions with no stronger signal

Rules:

- `running` wins while an active managed process is known for the session.
- `waiting_trust` is used for workspace-trust or approval-style gating that prevents the Cursor process from continuing.
- `waiting_input` is used only for user-input or interactive-prompt waits distinct from trust gating.
- `failed` is used for non-zero process exits, stream error events, or indexed failure state.
- `completed` is used when the latest known execution ended successfully.
- `idle` is used for known sessions without active, waiting, failed, or completed run evidence.
- If two signals have the same timestamp, prefer the stronger status in this order: `failed`, `waiting_trust`, `waiting_input`, `running`, `completed`, `idle`.

Every returned record must carry enough signals for a caller to understand why a status was selected.

## CLI Contract

Top-level command:

```bash
cursor-cli-agent activity [--session <id>] [--status <status>] [--limit <n>] [--json]
```

Behavior:

- without `--session`, list derived activity for known indexed sessions
- with `--session`, return the derived activity for the resolved `localSessionId` or `cursorChatId`
- `--status` filters list output to one supported status
- `--limit` bounds list output and rejects non-positive or non-integer values
- `--json` emits stable structured records with `provenance: "derived"` and signal source details
- human-readable output should show status, updated time, session identity, and signal sources

Validation:

- unknown sessions return the existing session-not-found behavior
- unknown status values are invalid CLI usage
- missing optional signal sources are reported through reduced signal provenance, not command failure

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/activity/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/activity/manager.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/activity/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`

Reference behavior to preserve:

- activity is derived from local session evidence instead of requested from a remote service
- status derivation is deterministic and testable
- activity lookup can return `null` or session-not-found behavior for unknown sessions

Intentional Cursor divergence:

- `codex-agent` derives from rollout events; this project derives from Cursor session index, transcript mtimes, managed process state, normalized stream events, and stderr/stdout patterns.
- `codex-agent` uses `waiting_approval`; this project splits Cursor blocking states into `waiting_trust` and `waiting_input`.
- This project must expose signal provenance and `provenance: "derived"` because Cursor has no durable activity table.

## Rollout Constraints

- Keep Cursor-specific parsing behind adapter modules; domain and persistence modules must consume normalized signals rather than raw Cursor CLI payloads.
- Do not broaden this slice into server, daemon, SDK, group lifecycle, or queue lifecycle work.
- Use project automation for verification: `task typecheck`, `task test`, and `task ci`.
- Manual smoke commands after implementation: `bun run src/main.ts activity --json` and `bun run src/main.ts activity --session <id> --json`.

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
- `design-docs/specs/design-parity-backlog-workflow.md#canonical-backlog`
- `impl-plans/active/activity.md`
