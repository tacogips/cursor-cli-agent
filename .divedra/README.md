# Project Divedra Workflows

This repository ships project-local `divedra` workflows under `.divedra/workflows`.

These workflows are discovered automatically when commands are run from the
repository root because `divedra` treats `<project>/.divedra/workflows` as the
project catalog.

## Available Workflows

- `design-and-implement-review-loop`: issue intake, design-doc update, design self-review, design review, implementation-plan creation, implementation-plan self-review, implementation-plan review, optional implementation, implementation self-review, README and user-facing workflow-skill refresh on the implementation path, and final commit/push.
- `codex-agent-concurrent-design-implement-loop`: decompose codex-agent functionality, review the decomposition, create feature-local design docs and implementation plans through a concurrency-10 fanout into `codex-agent-feature-design-plan-loop`, review the whole design/plan batch, implement ready plans one by one through `design-and-implement-review-loop`, and finish with an overall review.
- `codex-agent-feature-design-plan-loop`: callable feature-local branch workflow used by `codex-agent-concurrent-design-implement-loop` to create and review one design-doc and implementation-plan pair.
- `parity-backlog-design-implement-loop`: derive the remaining Cursor-agent parity backlog from repository design and plan state, pick one ready slice at a time, delegate each slice into `design-and-implement-review-loop`, and continue until no ready item remains or the run limit is reached.
- `parity-global-design-plan-implement-loop`: update the full selected parity design first, review that design, create all selected implementation plans, review the plan batch, then delegate ready plans one by one into `design-and-implement-review-loop` with parent review after each delegated result.
- `recent-change-quality-loop`: review recent committed and uncommitted changes, hand blocking findings into `design-and-implement-review-loop`, then re-review until only low-severity risks remain.

## Root Commands

List available workflows from this repository:

```bash
task divedra-workflows
```

Validate the bundled design-and-implement workflow:

```bash
task divedra-design-loop-validate
```

Validate the bundled recent-change workflow:

```bash
task divedra-recent-change-validate
```

Validate the bundled parity-backlog workflow:

```bash
task divedra-parity-backlog-validate
```

Validate the bundled global parity design-plan workflow:

```bash
task divedra-global-parity-validate
```

Validate the bundled codex-agent concurrent design/implementation workflow:

```bash
task divedra-codex-concurrent-validate
```

Run any `divedra` command through the local submodule:

```bash
task divedra -- workflow list
task divedra -- workflow inspect design-and-implement-review-loop --output json
task divedra -- workflow usage --output json
```

Run the bundled planning and implementation workflow with its deterministic mock
scenario:

```bash
task divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Run the bundled recent-change workflow with its deterministic mock scenario:

```bash
task divedra -- workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

Run the bundled parity-backlog workflow with its deterministic mock scenario:

```bash
task divedra -- workflow run parity-backlog-design-implement-loop \
  --mock-scenario .divedra/workflows/parity-backlog-design-implement-loop/mock-scenario.json \
  --variables '{"targetPhases":["2"],"maxItemsPerRun":1}' \
  --output json
```

Run the bundled global parity design-plan workflow for phase 2 with at most one
delegated implementation:

```bash
task divedra-global-parity -- \
  --variables '{"targetPhases":["2"],"maxItemsPerRun":1}' \
  --output json
```

Run the bundled global parity design-plan workflow for the phase-4 HTTP server
slice with at most one delegated implementation:

```bash
task divedra-global-parity -- \
  --variables '{"targetPhases":["4"],"maxItemsPerRun":1,"referenceRepositoryRoot":"/g/gits/tacogips/codex-agent"}' \
  --output json
```

Run the bundled codex-agent concurrent design/implementation workflow with at
most one delegated implementation:

```bash
task divedra-codex-concurrent -- \
  --variables '{"referenceRepositoryRoot":"/Users/taco/gits/tacogips/codex-agent","maxItemsPerRun":1}' \
  --output json
```

For direct `nix` usage without `task`, the equivalent entry point is:

```bash
nix run ./divedra -- workflow list
```

## Implementation Refresh Contract

On the full implementation path, `design-and-implement-review-loop` Step 6
updates runtime behavior and tests, Step 7 performs the independent
implementation review, and Step 8 refreshes README and user-facing workflow
skill guidance before commit preparation.

For `P3-GROUP-LIFECYCLE`, that refresh covers Cursor-local `group pause`,
`group resume`, `group delete`, `group watch`, paused-run guards, and
activity-derived watch snapshots. For `P3-QUEUE-LIFECYCLE`, it covers
Cursor-local `queue pause`, `queue resume`, `queue delete`, `queue update`,
`queue move`, `queue mode`, `queue stop`, paused/stopped run guards,
cooperative stop between queue items, retained completed/failed items,
manual-mode skips, and queue progress summaries derived from repository-owned
queue state plus optional activity signals. For `P3-FILE-INTELLIGENCE`, it
covers local-only `files list`, `files snapshots`, `files deleted`, `files
find`, and `files rebuild` behavior derived from Cursor `ai-tracking`, explicit
provenance and degraded-state reporting, snapshot content opt-in, and the
repository-owned rebuildable file index. For `P3-REPO-ANALYTICS`, it covers
local-only `repo analytics summary`, `repo analytics commits`, `repo analytics
sessions`, `repo analytics files`, and `repo analytics rebuild` behavior derived
from Cursor `scored_commits` plus file-intelligence attribution, explicit
provenance and completeness notes, repository-owned analytics indexes, valid
`0%` AI preservation, TEXT numeric column handling, and degraded-state
reporting.

For `P4-HTTP-SERVER`, it covers `curort-cli-agent server start`, foreground
Bun HTTP server startup/shutdown, loopback tokenless operation, non-loopback
startup token requirements, `GET /api/health`, `GET /api/version`,
normalized `GET /api/sessions`, `GET /api/sessions/:id`, `GET
/api/sessions/:id/messages`, `GET /api/search/sessions?q=<query>`, `GET
/api/search/transcripts?q=<query>`, shared JSON error envelopes, and the
accepted sandbox limitation that real socket smoke checks may need to be rerun
outside restricted workflow execution environments.

For `P4-AUTH`, it covers local `token create`, `token list`, `token revoke`,
and `token rotate` commands, repository-owned `tokens.json` persistence under
the config directory, metadata-only listing, hash-only secret storage, raw token
display exactly once on create/rotate, default `session:read` permissions,
wildcard family permissions, managed bearer verification for HTTP requests,
`401` invalid/missing credential envelopes, `403` missing-permission envelopes,
and route permission mapping for session, group, queue, bookmark, file, and
server-admin routes. The refresh should also document that startup `--token` or
`CURORT_CLI_AGENT_SERVER_TOKEN` enables required auth mode for exposed servers,
while request credentials come from `token create` or `token rotate`, and that
unmapped API paths currently fall through to normal `404` handling.

For `P4-SSE`, it covers live Server-Sent Events routes on the existing local
HTTP server: `GET /api/events/sessions/:id`, `GET /api/events/activity`, `GET
/api/events/activity/:id`, `GET /api/events/groups/:name`, and `GET
/api/events/queues/:name`. The refresh includes normalized event envelopes,
transcript tailing, pending-to-materialized session events, activity updates,
group and queue progress snapshots, `replay=latest|none`, `heartbeatMs`,
`startOffset`, standard `Last-Event-ID` resume support with `lastEventId` query
fallback, and the accepted sandbox limitation that real curl SSE smoke checks
may need to be rerun outside restricted workflow execution environments.

For `P4-DAEMON`, it covers `curort-cli-agent daemon start`, `daemon status`,
and `daemon stop` on top of the existing local HTTP/SSE server. The refresh
includes config-owned PID metadata at `daemon.json`, data-owned JSONL lifecycle
logs at `daemon.log`, default host `127.0.0.1`, default port `0` with actual
bound port persistence, `GET /api/health` readiness, auth-aware start/status
probes using runtime token input without persisting raw token values, stale
metadata cleanup, and the accepted safety rule that foreign or PID-reused
processes are never terminated because ownership requires a daemon process
environment marker matching metadata. `daemon stop --force` remains
intentionally out of scope.

For `P4-PUBLIC-SDK`, it covers the import-safe public package facade and
package exports for `.`, `./sdk`, `./sdk/testing`, `./server`, and `./types`.
The refresh includes `createCursorAgentSdk`, normalized Cursor-domain SDK
contracts for sessions, search, groups, queues, bookmarks, files, activity, and
runner events, deterministic `createMockCursorAgentSdk` testing helpers, server
helper exports such as `createResourceHandlers`, and the rule that public SDK
imports must not parse CLI arguments, spawn Cursor, start the daemon, or expose
raw `src/cursor` adapter payloads. It also covers the accepted daemon startup
regression fix: daemon server startup resolves an absolute executable
`src/bin.ts` or `dist/bin.js` entrypoint so module resolution does not depend on
the caller's current working directory.
