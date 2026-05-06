# Daemon Lifecycle Design

Design for `P4-DAEMON`: local daemon start, stop, status, PID metadata, stale process cleanup, server supervision, readiness checks, and CLI daemon commands.

## Overview

The daemon is the long-running local supervisor for the Phase 4 HTTP control plane. It starts the repository-owned server in a background process, records enough metadata for later CLI control, validates readiness before reporting success, and cleans up stale PID records without mutating Cursor-owned files.

This design maps the `codex-agent` Phase 4 daemon/app-server behavior onto this repository's Cursor-specific boundaries:

- server responses expose normalized repository models, not raw Cursor payloads
- persistence is repository-owned under `getDataDir()` and `getConfigDir()`
- Cursor state under `~/.cursor/projects`, `~/.cursor/ai-tracking`, and transcript directories remains read-only
- daemon supervision manages this tool's server process, not arbitrary Cursor-managed internal processes

## Feature Contract

- Feature id: `P4-DAEMON`
- Target area: daemon mode
- Requested behavior: daemon start, stop, status, PID metadata, stale process cleanup, server supervision, readiness checks, and CLI daemon commands
- Dependencies: `P4-HTTP-SERVER-CORE`, `P4-SSE`, `P4-TOKEN-AUTH`
- Assigned implementation plan: `impl-plans/active/daemon-lifecycle.md`

## Codex-Agent Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: daemon type contracts, start/stop/status lifecycle, readiness probing, stale PID recovery, and CLI integration.
- `/Users/taco/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`: Codex server, persistence, and process-manager architecture used as structural reference only.
- `/Users/taco/gits/tacogips/codex-agent/README.md`: user-facing command families and development verification commands.

Intentional divergences:

- No app-server transport bridge is included in this daemon slice; Cursor compatibility transports remain a later optional phase.
- The daemon supervises a local HTTP/SSE server process, not Codex `app-server`.
- Readiness probes target repository health endpoints and auth behavior rather than Codex protocol handshakes.
- PID metadata is stored in repository config/data locations, not in Cursor-managed directories.

## Scope

Included:

- daemon metadata model and atomic PID file lifecycle
- `daemon start`, `daemon stop`, and `daemon status` CLI commands
- stale PID detection and cleanup before start/status
- background server process spawning and termination
- readiness polling against the HTTP server health endpoint
- optional bearer token propagation to the supervised server
- testable process, filesystem, clock, and HTTP probe seams

Excluded:

- implementing HTTP route handlers from `P4-HTTP-SERVER-CORE`
- implementing SSE event derivation from `P4-SSE`
- implementing token creation, rotation, or permission checks from `P4-TOKEN-AUTH`
- remote daemon management across hosts
- direct writes to Cursor transcript, skill, or AI tracking locations
- cancellation of already-running `cursor-agent` subprocesses beyond server shutdown

## Lifecycle Model

Daemon states:

- `stopped`: no metadata file exists, or metadata was removed after a clean stop
- `starting`: metadata exists but readiness has not yet succeeded
- `running`: metadata exists, the PID is alive, and the health probe succeeds
- `stale`: metadata exists but the PID is missing, reused by another process, or the server readiness probe fails after cleanup checks
- `stopping`: stop command has signaled the process and is waiting for exit
- `failed`: start attempted but readiness failed or the child exited early

PID metadata should include:

- daemon PID
- parent CLI PID that started it
- host, port, base URL, and protocol
- data/config directory paths used by the daemon
- server mode and enabled feature flags
- token mode summary without storing raw secret values in status output
- started timestamp, last checked timestamp, and schema version

Metadata must be written atomically. A start command writes provisional `starting` metadata only after the child process has been spawned, then updates to `running` once readiness succeeds.

## Process Ownership and Stale Cleanup

The daemon manager must only terminate a process when metadata proves it is repository-owned. The metadata should carry a process marker, start timestamp, command path, and config/data directory values so PID reuse can be rejected.

Stale cleanup rules:

1. If no metadata file exists, status is `stopped`.
2. If metadata cannot be parsed, status is `stale` with a parse diagnostic; `daemon start --cleanup-stale` may replace it.
3. If the PID is not alive, status is `stale` and cleanup removes the metadata file.
4. If the PID is alive but the marker does not match, status is `stale` and the process must not be killed.
5. If the PID is alive and the marker matches but health fails, status is `stale` or `failed` depending on whether the process is still within startup grace.

`daemon start` should clean stale metadata by default before binding a new server. `daemon stop` should refuse to kill unknown PID owners unless `--force` is explicitly added in a later design.

## Server Supervision

The daemon starts the same server runtime defined by `P4-HTTP-SERVER-CORE`. It passes normalized configuration:

- host and port
- data directory and config directory
- Cursor home override
- auth configuration from `P4-TOKEN-AUTH`
- SSE enablement from `P4-SSE`
- log path and shutdown timeout

The server process should be a detached child of the CLI start command, but still write structured lifecycle diagnostics to repository-owned logs. Supervision for this slice is intentionally simple: one daemon process owns one server process. Automatic restart loops are out of scope unless a later review explicitly requests them.

## Readiness Checks

Readiness must be observable by CLI and tests. A start command succeeds only after:

1. PID metadata exists and is parseable.
2. The process is alive and still matches the daemon marker.
3. `GET /api/health` or the selected health endpoint returns a successful response.
4. When auth is enabled, the probe uses the configured bearer token and verifies unauthorized probes fail in server/auth tests.

Timeout, interval, and endpoint settings should have defaults and CLI overrides. Readiness failures must terminate the started process when ownership is known and report a clear failure status.

## CLI Contract

Command shape:

```bash
curort-cli-agent daemon start [--host <host>] [--port <port>] [--token <token>] [--timeout-ms <n>] [--json]
curort-cli-agent daemon stop [--timeout-ms <n>] [--json]
curort-cli-agent daemon status [--json]
```

Human output should be compact and operational:

- `start`: status, PID, URL, and readiness result
- `stop`: previous PID and whether shutdown was clean
- `status`: state, PID when known, URL when known, started time, and stale reason when present

JSON output must expose stable fields and omit raw token values.

## Persistence

Default paths:

- metadata: `getConfigDir()/daemon.json`
- logs: `getDataDir()/daemon.log` and server logs under `getDataDir()/logs/`

The path module should expose helpers rather than scattering path strings through CLI code. Tests should use `CURORT_CLI_AGENT_CONFIG_DIR` and `CURORT_CLI_AGENT_DATA_DIR` overrides.

## Dependencies

| Dependency | Required Contract |
|---|---|
| `P4-HTTP-SERVER-CORE` | startable server entrypoint, health endpoint, host/port config, graceful close |
| `P4-SSE` | optional event stream route that the daemon can leave enabled without owning event semantics |
| `P4-TOKEN-AUTH` | token validation middleware and safe token config propagation |
| Phase 1-3 local features | normalized sessions, search, group, queue, bookmark, activity, and file APIs exposed by server |

## Verification

Planned verification commands:

```bash
bun test src/daemon/manager.test.ts src/cli/cli.test.ts
task typecheck
task test
task ci
```

Manual smoke commands:

```bash
CURORT_CLI_AGENT_DATA_DIR=/private/tmp/curort-daemon-data \
CURORT_CLI_AGENT_CONFIG_DIR=/private/tmp/curort-daemon-config \
bun run src/main.ts daemon start --port 0 --json

bun run src/main.ts daemon status --json
bun run src/main.ts daemon stop --json
```

## Risks

- PID reuse can lead to unsafe termination if ownership markers are too weak.
- Health checks depend on the server/auth contracts staying stable.
- Parallel feature branches may define route or token names differently; this daemon plan must use dependency contracts when those plans land.
- Detached process behavior and signal handling can vary across local shells and CI environments.

## Open Questions

- Should `daemon start` choose a free port by default or require the server-core default port?
- Should `daemon stop` ever support `--force`, or should unsafe process ownership always require manual cleanup?
- Should logs be plain text, JSONL, or both for server dashboard consumption?

## References

See `design-docs/references/README.md` for external references.
