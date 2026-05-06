# Best-Effort Session Replay and Fork

This document defines the phase-5 `P5-SESSION-REPLAY-FORK` slice for an explicitly degraded Cursor-local replay/fork experiment.

## Overview

`session fork` must let a user select a transcript-backed Cursor session, slice the replayable conversation through a known message boundary, and start a new Cursor headless session with a generated replay prompt plus explicit provenance.

This is not native Codex fork semantics. Cursor does not expose a confirmed local `fork <sessionId>` command equivalent. The feature therefore replays transcript text into a new session and reports that tool state, hidden system state, model context, attachments, approvals, and unnormalized Cursor internals may not be preserved.

## Source Issue Mapping

- Backlog ID: `P5-SESSION-REPLAY-FORK`
- Workflow ID: `codex-agent-feature-design-plan-loop`
- Requested behavior: design and plan a degraded Cursor-local replay/fork experiment that slices transcript-backed messages, starts a new session with replay provenance, reports limitations, and avoids pretending Cursor has native Codex fork semantics
- Scope boundary: transcript-backed local Cursor sessions only
- Dependencies: `P1-CORE-FOUNDATION`, `P2-TRANSCRIPT-SEARCH`, `P2-MARKDOWN-TASKS`

## Codex Reference Mapping

Use `/Users/taco/gits/tacogips/codex-agent` as the local parity reference.

Relevant reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/rollout/reader.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to understand:

- `ProcessManager.spawnFork(sessionId, nthMessage, options)` shells out to native `codex fork <sessionId> [--nth-message N]`.
- Codex session discovery reads rollout files and session metadata before CLI operations.
- Codex rollout readers normalize JSONL lines into message-like events.
- The Codex CLI exposes `session fork <id> [--nth-message N]` as an actual fork operation.

Intentional Cursor adaptation:

- Cursor has no confirmed native fork command, so this feature must label output as `best_effort_replay`.
- Cursor source material is `~/.cursor/projects/*/agent-transcripts/*.jsonl`, not Codex rollout files.
- Cursor message boundaries use stable transcript message IDs such as `event-<offset>-<role>`.
- A new session is launched through existing headless `cursor-agent --print --output-format stream-json --prompt ...` behavior.
- Replay provenance is repository-owned metadata; Cursor transcript files remain read-only and are never rewritten.

## CLI Behavior

The CLI command is:

```bash
curort-cli-agent session fork <id> --prompt <text> [--through-message <message-id>] [--nth-message <n>] [--dry-run] [--json] [process options]
```

Primary flags:

- `<id>`: required; resolves a known `recordId`, `localSessionId`, or `cursorChatId`
- `--prompt <text>`: required continuation prompt for the new session
- `--through-message <message-id>`: optional inclusive stable message boundary
- `--nth-message <n>`: optional Codex-compatible 1-based transcript message boundary
- `--dry-run`: render the replay plan and limitations without starting Cursor
- `--json`: emit the structured result contract
- process options: reuse the existing session run options where applicable, including workspace, model, mode, trust, force, yolo, stream, sandbox, and MCP approval flags

Exactly one of `--through-message` or `--nth-message` may be supplied. If neither is supplied, the replay slice includes all currently searchable transcript messages.

## Result Contract

JSON output should return:

- `mode: "best_effort_replay"`
- `sourceSession`
- `forkPoint`
- `replay`
- `newSession` when not a dry run
- `provenance`
- `limitations`
- `warnings`

`sourceSession` should include `recordId`, `localSessionId`, `cursorChatId`, `workspacePath`, and `transcriptPath` when available.

`forkPoint` should include `messageId`, `nthMessage`, `eventOffset`, `role`, and `inclusive`.

`replay` should include `messageCount`, `truncated`, `omittedMessageCount`, and `promptPreview` for dry-run and JSON output. Human output should avoid dumping full private transcript text by default.

`provenance` should include a local replay/fork id, source ids, selected boundary, generated prompt hash, created timestamp, and `semantics: "replay_not_native_fork"`.

## Data Flow

1. CLI parses `session fork` and validates the required source id, prompt, boundary flags, and process options.
2. The service refreshes the local session index with `importTranscriptsFromFilesystem()`.
3. Source identity is resolved through `SessionIndexRepository.resolveSessionKey`.
4. Pending `chat_only` records fail with a clear transcript-not-materialized error because there is no replayable transcript.
5. Transcript rows are streamed through `src/cursor/transcript-reader.ts`; CLI code must not parse raw Cursor JSONL.
6. The slicer filters to replayable user and assistant rows and stops at the selected boundary.
7. The prompt builder creates a continuation prompt containing explicit warnings, source identity, the replayed transcript slice, and the new continuation prompt.
8. Dry runs return the replay plan without invoking Cursor.
9. Non-dry runs launch a new headless Cursor session through the existing process runner.
10. The new session stream is normalized through existing stream normalization and imported back into the session index when possible.
11. Replay provenance is recorded in repository-owned storage and included in output.

## Validation Rules

- Missing source id returns usage error.
- Missing or blank `--prompt` returns usage error.
- Unknown source id returns not-found.
- Source records without `transcriptPath` return a transcript-not-materialized error.
- `--through-message` must match the stable transcript message id convention.
- `--nth-message` must be a positive integer.
- `--through-message` and `--nth-message` are mutually exclusive.
- Boundary values beyond the available replayable messages return usage error rather than silently replaying a different slice.
- Empty replay slices are rejected.
- Malformed transcript rows remain non-fatal scan input.

## Limitation Reporting

Every human and JSON result must make these limitations visible:

- Cursor native fork semantics are not available through the confirmed local CLI surface.
- Replayed context is plain transcript text, not hidden model state.
- Tool calls, tool outputs, approvals, file diffs, attachments, and transient runtime state may be absent or incomplete.
- The new session may answer differently from the source session because the model receives a synthetic replay prompt.
- Transcript files are local Cursor state and may be incomplete until materialization finishes.

## Cursor Boundary Rules

The feature reads local state from:

- `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- repository-owned `state.db`

The feature writes only repository-owned provenance metadata and normal session index records. It must never mutate Cursor transcript files or Cursor-managed skill directories.

Cursor-specific behavior remains isolated:

- transcript slicing stays under `src/cursor/`
- process invocation stays behind `src/cursor/process-runner.ts`
- provenance persistence stays under `src/persistence/`
- CLI code coordinates validation and rendering only

## Open Questions

- Should a later release expose a `--include-tool-like-rows` option if Cursor transcripts begin normalizing tool rows?
- Should replay prompts be allowed to exceed a configurable byte or message budget, or should this slice enforce a conservative default cap?

## References

See `design-docs/specs/design-cursor-session-management.md`, `design-docs/specs/design-transcript-search.md`, `design-docs/specs/design-markdown-tasks.md`, `design-docs/specs/design-codex-agent-parity-gap.md`, and `design-docs/references/README.md`.
