# Codex-Agent Parity Gap Analysis for Cursor CLI Agent

This document compares `/g/gits/tacogips/codex-agent` to the planned `cursor-cli-agent` and defines the first implementation scope.

## Summary

`codex-agent` is the feature baseline. `cursor-cli-agent` should preserve the orchestration shape, but it cannot copy the Codex implementation mechanically because Cursor has a different session model.

Main blockers to direct reuse:

- no observed Cursor equivalent to Codex's SQLite state DB
- no observed Cursor equivalent to `fork`
- much thinner persisted transcript format
- workspace trust gate in headless mode
- dual-ID lifecycle around `create-chat`

## Capability Inventory

Status labels:

- `Planned`: explicitly designed in this repository
- `Partial`: possible, but with narrower scope than `codex-agent`
- `Deferred`: intentionally later phase

| Capability Area | `codex-agent` baseline | `cursor-cli-agent` status | Notes |
|---|---|---|---|
| Session discovery and summary | Implemented | Planned | scan `~/.cursor/projects/*/agent-transcripts` |
| Session detail and transcript read | Implemented | Planned | transcript schema is simpler, but directly usable |
| Live session watch | Implemented | Planned | combine transcript watch with stdout event stream |
| New session execution | Implemented | Planned | use `cursor-agent --print` |
| Pre-materialized chat creation | Not needed | Planned | persist pending `cursorChatId` before transcript materialization |
| Resume existing session | Implemented | Planned | support both session ID and chat ID |
| Continue latest session | Implemented in spirit | Planned | use Cursor `--continue` |
| Session metadata enrichment | rollout/state DB native | Planned | use `ai-code-tracking.db` when present |
| Local skill catalog inspection | Not core baseline | Planned | inspect `skills-cursor`, user skills, project skills |
| Fork session | Implemented | Partial | no native Cursor fork; out of phase 1 |
| Group orchestration | Implemented | Planned | built on top of headless run/resume |
| Queue orchestration | Implemented | Planned | built on top of headless run/resume |
| Bookmark system | Implemented | Deferred | not required for first usable release |
| Token/auth management | Implemented | Deferred | only needed once server exists |
| File-change indexing | Implemented | Deferred | Cursor transcripts do not yet expose enough detail |
| Activity tracking | Implemented | Partial | infer from process state, mtimes, and stream events |
| SDK facade | Implemented | Planned | normalize Cursor events behind stable APIs |
| HTTP server | Implemented | Deferred | after session/process core is stable |
| Daemon mode | Implemented | Deferred | after session/process core is stable |

## Phase 1 Scope

### Included

- Cursor transcript reader
- Cursor stream normalizer
- Local session index
- Pending chat-only records for `session create`
- AI tracking DB enrichment
- Headless process manager
- `session list/show/watch/run/create/resume/continue/attach`
- Read-only skill catalog discovery
- foundational group and queue CRUD/run

### Excluded

- fork/replay branch semantics
- auth server and API tokens
- file-change extraction
- bookmark/search subsystems
- protocol-level compatibility with `codex-agent`

## Design Consequences of Cursor Differences

### 1. Session index is an application responsibility

`codex-agent` can lean on Codex rollouts plus state DB. `cursor-cli-agent` must build and own an index.

### 2. Metadata capture must happen at execution time

For managed sessions, the best metadata arrives over stdout while the process is running. If that stream is ignored, information is lost.

### 3. Imported sessions will always be weaker than managed sessions

Sessions created outside this tool may only provide transcript text plus filesystem metadata. That is acceptable, but the design must surface this reduced fidelity.

With `ai-code-tracking.db`, some imported sessions can be upgraded with:

- touched-file counts
- deleted-file lists
- tracked file snapshots

### 4. Resume semantics must be ID-flexible

The tool must accept:

- transcript-backed `localSessionId`
- pre-materialized `cursorChatId`

This flexibility also applies to:

- `session show`
- `session attach`
- session index deduplication during transcript materialization

## Delivery Strategy

1. Build a strong session/process foundation first.
2. Reintroduce `codex-agent` orchestration concepts only after Cursor ingestion is stable.
3. Treat advanced parity items as opt-in expansions, not phase-1 requirements.
