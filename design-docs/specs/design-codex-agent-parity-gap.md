# Codex-Agent Parity Gap Analysis for Curort CLI Agent

This document compares `/g/gits/tacogips/codex-agent` to the planned `cursor-cli-agent` and defines the multi-phase parity roadmap for the Cursor-oriented variant.

## Summary

`codex-agent` is the feature baseline. `cursor-cli-agent` should preserve the orchestration shape, but it cannot copy the Codex implementation mechanically because Cursor has a different session model.

The current repository already covers the phase-1 foundation in design and mostly in code. The remaining gap is that the design set did not yet define the post-foundation parity path clearly enough.

Main blockers to direct reuse:

- no observed Cursor equivalent to Codex's SQLite state DB
- no observed Cursor equivalent to `fork`
- much thinner persisted transcript format
- workspace trust gate in headless mode
- dual-ID lifecycle around `create-chat`
- file intelligence must be derived from `ai-tracking`, not native rollout tool logs

## Capability Inventory

Status labels:

- `Phase 1`: foundation
- `Phase 2`: local search, bookmarks, and activity
- `Phase 3`: derived file intelligence and advanced orchestration controls
- `Phase 4`: server, auth, daemon, and public SDK
- `Phase 5`: optional compatibility and extension layer
- `Partial`: intentionally narrower than `codex-agent` because Cursor lacks a native primitive

| Capability Area | `codex-agent` baseline | `cursor-cli-agent` status | Notes |
|---|---|---|---|
| Session discovery and summary | Implemented | Phase 1 | scan `~/.cursor/projects/*/agent-transcripts` |
| Session detail and transcript read | Implemented | Phase 1 | transcript schema is simpler, but directly usable |
| Live session watch | Implemented | Phase 1 | combine transcript watch with stdout event stream |
| New session execution | Implemented | Phase 1 | use `cursor-agent --print` |
| Pre-materialized chat creation | Not needed | Phase 1 | persist pending `cursorChatId` before transcript materialization |
| Resume existing session | Implemented | Phase 1 | support both session ID and chat ID |
| Continue latest session | Implemented in spirit | Phase 1 | use Cursor `--continue` |
| Session metadata enrichment | rollout/state DB native | Phase 1 | use `ai-code-tracking.db` when present |
| Local skill catalog inspection | Not core baseline | Phase 1 | inspect `skills-cursor`, user skills, project skills |
| Session search across indexed metadata | Implemented | Phase 2 | search session summaries, workspace, model, mode, and status |
| Transcript full-text search | Implemented | Phase 2 | stream-scan transcript JSONL plus cached summary data |
| Bookmark system | Implemented | Phase 2 | bookmarks target sessions, messages, or transcript ranges |
| Activity tracking | Implemented | Phase 2 | infer from process state, transcript mtimes, and stream events |
| Markdown/task extraction utility | Implemented | Phase 2 | parse assistant markdown into task views without mutating transcripts |
| Advanced group controls | Implemented | Phase 3 | pause, resume, delete, and watch semantics |
| Advanced queue controls | Implemented | Phase 3 | pause, resume, update, move, mode, delete, and stop semantics |
| File-change intelligence | Implemented | Phase 3 | derive from `ai-tracking` DB instead of rollout tool logs |
| Commit/repository analytics | Partial | Phase 3 | derive from `scored_commits` when joins are possible |
| Fork session | Implemented | Partial | no native Cursor fork; emulate later only if replay proves reliable |
| HTTP server | Implemented | Phase 4 | expose normalized session, search, group, queue, bookmark, and file APIs |
| Token/auth management | Implemented | Phase 4 | only meaningful once a remote control plane exists |
| Daemon mode | Implemented | Phase 4 | supervise server plus background watchers/processes |
| Public SDK facade | Implemented | Phase 4 | re-export stable domain APIs and SDK event contracts |
| GraphQL or app-server transport bridge | Partial | Phase 5 | optional compatibility layer after REST/SSE and SDK are stable |
| Tool registry / model-availability helpers | Implemented | Phase 5 | only if Cursor exposes enough stable metadata to justify it |

## Canonical Backlog Coverage

The phase-2 through phase-5 parity backlog is a single dependency graph. Global
design and batch implementation planning must cover every selected item before
any one item is implemented.

| Backlog ID | Phase | Design doc | Expected implementation plan | Codex reference areas | Dependencies |
|---|---:|---|---|---|---|
| `P2-SESSION-SEARCH` | 2 | `design-docs/specs/design-session-search.md` | `impl-plans/active/session-search.md` | `src/session/search.ts`, `src/session/sqlite.ts`, `src/types/session.ts` | - |
| `P2-TRANSCRIPT-SEARCH` | 2 | `design-docs/specs/design-transcript-search.md` | `impl-plans/active/transcript-search.md` | `src/session/search.ts`, `src/session/search.test.ts`, `src/types/session.ts` | `P2-SESSION-SEARCH` |
| `P2-BOOKMARKS` | 2 | `design-docs/specs/design-bookmarks.md` | `impl-plans/active/bookmarks.md` | `src/bookmark/*`, `src/cli/index.ts` bookmark commands | `P2-TRANSCRIPT-SEARCH` |
| `P2-ACTIVITY` | 2 | `design-docs/specs/design-activity.md` | `impl-plans/active/activity.md` | `src/activity/*`, `src/process/manager.ts` | - |
| `P2-MARKDOWN-TASKS` | 2 | `design-docs/specs/design-markdown-tasks.md` | `impl-plans/active/markdown-tasks.md` | `src/markdown/*`, `src/cli/index.ts` `session show --tasks` behavior | `P2-TRANSCRIPT-SEARCH` |
| `P3-GROUP-LIFECYCLE` | 3 | `design-docs/specs/design-group-lifecycle.md` | `impl-plans/completed/group-lifecycle.md` | `src/group/*`, `src/cli/index.ts` group commands | `P2-ACTIVITY` |
| `P3-QUEUE-LIFECYCLE` | 3 | `design-docs/specs/design-queue-lifecycle.md` | `impl-plans/active/queue-lifecycle.md` | `src/queue/*`, `src/cli/index.ts` queue commands | `P2-ACTIVITY` |
| `P3-FILE-INTELLIGENCE` | 3 | `design-docs/specs/design-file-intelligence.md` | `impl-plans/completed/file-intelligence.md` | `src/file-changes/*`, `src/cli/index.ts` files commands | `P2-SESSION-SEARCH` |
| `P3-REPO-ANALYTICS` | 3 | `design-docs/specs/design-repository-analytics.md` | `impl-plans/active/repository-analytics.md` | `src/file-changes/*`, completed plan `session-file-patch-history.md` | `P3-FILE-INTELLIGENCE` |
| `P4-HTTP-SERVER` | 4 | `design-docs/specs/design-http-server-core.md` | `impl-plans/completed/http-server-core.md` | `src/server/*`, `src/cli/index.ts` server command | `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE` |
| `P4-SSE` | 4 | `design-docs/specs/design-server-event-streaming.md` | `impl-plans/active/server-event-streaming.md` | `src/server/sse.ts`, `src/server/websocket.ts`, `src/sdk/events.ts` | `P4-HTTP-SERVER`, `P2-ACTIVITY` |
| `P4-AUTH` | 4 | `design-docs/specs/design-token-auth.md` | `impl-plans/completed/token-auth.md` | `src/auth/*`, `src/server/auth.ts` | `P4-HTTP-SERVER` |
| `P4-DAEMON` | 4 | `design-docs/specs/design-daemon-lifecycle.md` | `impl-plans/completed/daemon-lifecycle.md` | `src/daemon/*`, `src/cli/index.ts` daemon command | `P4-HTTP-SERVER`, `P4-SSE` |
| `P4-PUBLIC-SDK` | 4 | `design-docs/specs/design-public-sdk.md` | `impl-plans/active/public-sdk.md` | `src/sdk/*`, `src/main.ts`, `package.json` exports | `P4-HTTP-SERVER` |
| `P5-COMPAT-BRIDGE` | 5 | `design-docs/specs/design-compat-bridge.md` | `impl-plans/active/compat-bridge.md` | `src/graphql/*`, `src/cli/graphql.ts`, server app transport files | `P4-HTTP-SERVER`, `P4-PUBLIC-SDK` |
| `P5-TOOL-REGISTRY` | 5 | `design-docs/specs/design-tool-registry-model-helpers.md` | `impl-plans/active/tool-registry-model-helpers.md` | `src/sdk/tool-registry.ts`, `src/sdk/model-availability.ts`, `src/sdk/tool-versions.ts` | `P4-PUBLIC-SDK` |

The runtime-provided `referenceRepositoryRoot` should be used when it points to
a populated `codex-agent` checkout. If the in-repository `codex-agent/`
placeholder is empty, use `/g/gits/tacogips/codex-agent` as the local reference
checkout for review and planning evidence.

## Phase 1 Scope

### Included

- Cursor transcript reader
- Cursor stream normalizer
- local session index
- pending chat-only records for `session create`
- AI tracking DB enrichment
- headless process manager
- `session list/show/watch/run/create/resume/continue/attach`
- read-only skill catalog discovery
- foundational group and queue CRUD/run

### Excluded

- fork/replay branch semantics
- auth server and API tokens
- file-change extraction
- bookmark/search subsystems
- protocol-level compatibility with `codex-agent`

## Missing Design Coverage Added In This Review

The previous design set was strong on ingestion and basic orchestration, but it did not yet define:

- how transcript search should work without a Codex-style rollout DB
- how bookmarks map onto Cursor transcript messages and pending chat-only sessions
- how advanced queue and group lifecycle controls should be modeled
- how file-change intelligence should be derived from `ai-tracking` rather than transcript text
- how auth, server, daemon, and SDK layers fit together after phase 1
- which features are intentionally partial because Cursor lacks a native equivalent

Those areas are now part of the target design and should be treated as planned functionality rather than open-ended future ideas.

## Phase 2: Search, Bookmarks, and Activity

Phase 2 closes the highest-value parity gaps that remain entirely local and do not require a networked control plane.

### Included

- `session search` over indexed metadata
- transcript full-text search with role filters and byte/event limits
- bookmark CRUD and search
- activity status derivation
- markdown/task extraction utilities for assistant output

### Cursor-Specific Design

#### Search

`codex-agent` can search rollout files with richer typed events. `cursor-cli-agent` must search two layers:

1. SQLite session index for metadata filters
2. transcript JSONL files for message-text matches

Search results should distinguish:

- metadata match only
- transcript content match
- enriched file/activity match

#### Bookmarks

Bookmarks should support:

- `session`
- `message`
- `range`

Constraints:

1. `chat_only` records may only accept session-level bookmarks until a transcript materializes
2. message/range bookmarks must reference transcript-backed message offsets or stable synthetic message IDs derived from transcript position
3. bookmarks must preserve both raw and display text excerpts for later rendering

#### Activity

Cursor lacks a durable activity table. Activity must be derived from:

- active managed process state
- latest transcript append time
- latest normalized stream event
- trust/approval waiting conditions inferred from stderr/stdout

The activity model should expose at least:

- `idle`
- `running`
- `waiting_trust`
- `waiting_input`
- `completed`
- `failed`

See `design-docs/specs/design-activity.md` for the bounded `P2-ACTIVITY` behavior, validation rules, CLI contract, and Codex-reference mapping.

## Phase 3: File Intelligence and Orchestration Expansion

Phase 3 adds the next parity tier: advanced control surfaces and derived file intelligence.

### Included

- group pause/resume/delete/watch
- queue pause/resume/delete/update/move/mode/stop
- file-change summaries per session
- repository-level file history lookup
- commit scoring and AI-attribution summaries when available

### Cursor-Specific Design

#### File Intelligence

Unlike `codex-agent`, `cursor-cli-agent` should not depend on tool call logs to infer file changes. The primary source should be:

- `ai_code_hashes` for touched files
- `ai_deleted_files` for deletions
- `tracked_file_content` for snapshots
- `scored_commits` for commit-level analytics

This yields a derived file index rather than an exact replay of every edit event. The UI and APIs must present it as best-effort intelligence, not perfect ground truth.

#### Advanced Group and Queue State

Group and queue records must gain explicit lifecycle state:

- `active`
- `paused`
- `completed`
- `failed`
- `archived` (optional later for groups)

Queue commands additionally require per-item execution mode:

- `auto`
- `manual`

## Phase 4: Server, Auth, Daemon, and Public SDK

Phase 4 introduces the remote control plane and public package surface.

### Included

- REST server
- SSE/live event streaming
- bearer-token auth with scoped permissions
- daemon lifecycle management
- public library exports for sessions, search, groups, queues, bookmarks, files, activity, and SDK events

### Cursor-Specific Design

#### Server

The server should expose normalized application entities only. It must not proxy raw Cursor payloads directly.

Primary route groups:

- `/api/health`
- `/api/sessions`
- `/api/search`
- `/api/groups`
- `/api/queues`
- `/api/bookmarks`
- `/api/files`

#### Auth

Auth should be optional in local single-user mode and mandatory only when the server is intentionally exposed beyond localhost.

Initial permission families:

- `session:*`
- `group:*`
- `queue:*`
- `bookmark:*`
- `files:*`
- `server:admin`

#### Public SDK

The package entrypoint should eventually re-export:

- stable domain types
- session/search APIs
- group/queue/bookmark/file APIs
- SDK event types and runner abstractions
- server/bootstrap helpers only once their contracts stabilize

## Phase 5: Compatibility Layer and Optional Extensions

Phase 5 is reserved for items that are valuable but should not block the main control plane.

Candidate items:

- GraphQL CLI or API surface
- app-server transport bridge
- model availability probes
- tool-registry metadata
- best-effort fork/replay experiments

These should ship only when they can be backed by stable Cursor behavior rather than wishful parity.

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

### 5. Search and file intelligence must be derived, not replayed

`codex-agent` can search and index richer native rollout events. `cursor-cli-agent` must derive those higher-level views from:

- transcript text
- local session index
- `ai-tracking` enrichment

That means some parity features are approximate by design and should surface provenance in the result model.

### 6. Server parity depends on local-first boundaries

The server and SDK must expose the repository's normalized models, not raw Cursor CLI internals. Otherwise every upstream Cursor format change would break external consumers directly.

## Delivery Strategy

1. Keep the current phase-1 session/process foundation as the mandatory base.
2. Implement phase 2 before server work so local parity is strong first.
3. Implement phase 3 only after derived indexes and lifecycle states are formalized.
4. Introduce server/auth/daemon/public SDK as phase 4 once local models are stable.
5. Treat phase-5 compatibility items as optional expansions, not core release blockers.

## Batch Planning and Review Strategy

For `parity-global-design-plan-implement-loop`, implementation planning is a
batch gate:

1. Step 1 owns this global design and must keep the backlog table above aligned
   with the focused `design-*.md` feature docs.
2. Step 2 reviews the global design for coverage, dependency correctness,
   adapter isolation, Cursor divergences, and test strategy before plans are
   authored.
3. Step 3 creates or updates every selected active plan path listed above before
   any implementation starts.
4. Step 4 reviews the complete plan batch. Design-level blockers return to Step
   1; plan-only blockers return to Step 3.
5. Step 5 selects the earliest ready active plan whose dependencies are
   complete, honoring `maxItemsPerRun`.
6. Step 6 delegates exactly one selected plan to
   `design-and-implement-review-loop` using `executionMode:
   "issue-resolution"`.

The child workflow input must include the backlog ID, selected active plan path,
design doc path, dependency state, requested behavior, and Codex reference files.
No implementation work should happen in the global design or batch planning
nodes.
