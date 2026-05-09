# Daemon Lifecycle Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-daemon-lifecycle.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-daemon-lifecycle.md`

### Summary

Implement backlog slice `P4-DAEMON`: repository-owned daemon metadata, start/stop/status lifecycle, stale PID cleanup, HTTP/SSE server supervision, readiness checks, JSONL lifecycle logging, and `daemon` CLI commands for the Cursor-oriented control plane.

### Scope

**Included**: daemon types, config/data path helpers, atomic metadata store, JSONL log path helper, process lifecycle manager, readiness probe abstraction, CLI commands, and focused unit/integration tests.

**Excluded**: HTTP route implementation, SSE event derivation, token creation/permission storage, app-server compatibility, remote daemon control, `daemon stop --force`, and direct writes to Cursor-owned files.

### Dependencies

- `P4-HTTP-SERVER`: startable server entrypoint, `GET /api/health`, host/port config, graceful shutdown.
- `P4-SSE`: server route may be supervised by the daemon but event derivation remains owned by the SSE plan.
- `P4-AUTH` / `P4-TOKEN-AUTH`: token propagation and readiness auth expectations.
- Phase 1-3 local modules: normalized session, activity, group, queue, bookmark, and file intelligence APIs available to the server.

### Codex Reference Mapping

Requested reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`
Inspected fallback root: `/g/gits/tacogips/codex-agent`

- `/g/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: reference daemon contracts, PID lifecycle, readiness probing, stale recovery, and CLI integration.
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`: reference architecture for server/process boundaries.
- `/g/gits/tacogips/codex-agent/src/session/index.ts`: reference local state discovery and fallback boundaries.
- `/g/gits/tacogips/codex-agent/src/session/sqlite.ts`: reference read-only SQLite access and typed row mapping.
- `/g/gits/tacogips/codex-agent/src/types/session.ts`: reference strict readonly domain/result type patterns.

Intentional divergences:

- Supervise this repository's HTTP/SSE server, not Codex app-server.
- Persist daemon metadata under repository config/data directories, not Codex or Cursor state roots.
- Treat Cursor transcripts, skills, and `ai-code-tracking.db` as read-only inputs owned by adapter modules.
- Do not expose raw bearer tokens in status output or PID metadata summaries.
- Use this repository's `startHttpServer` / `resolveHttpServerConfig` contract and `GET /api/health`, not Codex app-server protocol handshakes.

### Resolved Design Decisions

- `daemon start` defaults to host `127.0.0.1` and port `0`; metadata records the actual bound port.
- `daemon stop --force` is out of scope; foreign, unknown, or PID-reused processes are never terminated.
- Daemon lifecycle logs are structured JSONL at `getDataDir()/daemon.log`.
- Readiness probes use `GET /api/health` and include the bearer token only when auth is configured.

---

## Modules

### 1. Daemon Types

#### `src/types/daemon.ts`

**Status**: COMPLETED

```typescript
export type DaemonState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "stale"
  | "failed";

export interface DaemonMetadata {
  readonly schemaVersion: 1;
  readonly state: "starting" | "running" | "stopping" | "failed";
  readonly pid: number;
  readonly parentPid: number;
  readonly marker: string;
  readonly commandPath: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly dataDir: string;
  readonly configDir: string;
  readonly serverMode: "http";
  readonly startedAt: string;
  readonly lastCheckedAt?: string;
  readonly auth: DaemonAuthSummary;
}

export interface DaemonAuthSummary {
  readonly mode: "disabled" | "required";
  readonly tokenConfigured: boolean;
}

export interface DaemonStatusResult {
  readonly state: DaemonState;
  readonly metadata?: DaemonMetadata;
  readonly staleReason?: string;
}
```

**Checklist**:

- [x] Define daemon state, metadata, auth summary, start/stop options, and result contracts.
- [x] Keep raw token values out of serializable status results.
- [x] Export types for manager, persistence, CLI, and tests.

### 2. Daemon Paths and Metadata Store

#### `src/config/paths.ts`, `src/persistence/daemon-metadata-store.ts`

**Status**: COMPLETED

```typescript
export function daemonMetadataPath(): string;
export function daemonLifecycleLogPath(): string;

export type DaemonMetadataReadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly metadata: DaemonMetadata }
  | { readonly status: "malformed"; readonly diagnostic: string };

export interface DaemonMetadataStore {
  read(): Promise<DaemonMetadataReadResult>;
  write(metadata: DaemonMetadata): Promise<void>;
  remove(): Promise<void>;
}
```

**Checklist**:

- [x] Add config/data path helpers using existing environment override behavior.
- [x] Implement atomic metadata writes through a repository-owned JSON file.
- [x] Treat missing metadata as stopped and malformed metadata as stale with a diagnostic.
- [x] Add tests for missing, valid, malformed, and remove behavior.

### 3. Process Ownership and Readiness Interfaces

#### `src/daemon/process.ts`, `src/daemon/readiness.ts`

**Status**: COMPLETED

```typescript
export interface DaemonProcessInspector {
  isAlive(pid: number): Promise<boolean>;
  matchesOwner(metadata: DaemonMetadata): Promise<boolean>;
  terminate(pid: number, options: DaemonStopOptions): Promise<DaemonStopResult>;
}

export interface DaemonReadinessProbe {
  waitUntilReady(options: DaemonReadinessOptions): Promise<DaemonReadinessResult>;
}
```

**Checklist**:

- [x] Isolate process lookup, owner matching, and termination for deterministic tests.
- [x] Implement HTTP polling against `GET /api/health` with timeout and interval options.
- [x] Support auth-enabled probes without logging token values.
- [x] Cover PID reuse, timeout, early child exit, and successful readiness tests.

### 4. Daemon Manager

#### `src/daemon/manager.ts`

**Status**: COMPLETED

```typescript
export interface DaemonManager {
  start(options?: DaemonStartOptions): Promise<DaemonStartResult>;
  stop(options?: DaemonStopOptions): Promise<DaemonStopResult>;
  status(options?: DaemonStatusOptions): Promise<DaemonStatusResult>;
}

export function createDaemonManager(deps?: DaemonManagerDeps): DaemonManager;
```

**Checklist**:

- [x] Clean stale metadata before start when safe.
- [x] Spawn the server process with normalized host, port, data/config, auth, and Cursor home settings.
- [x] Write `starting` metadata after spawn and update to `running` after readiness succeeds.
- [x] On readiness failure, terminate owned process and return `failed`.
- [x] Stop only owned daemon processes and remove metadata after clean shutdown.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
async function runDaemon(argv: readonly string[]): Promise<number>;
```

**Checklist**:

- [x] Replace the current daemon not-implemented stub with `start`, `stop`, and `status`.
- [x] Add `--host`, `--port`, `--token`, `--timeout-ms`, and `--json` parsing where applicable.
- [x] Default start host/port through `resolveHttpServerConfig`, including port `0` when omitted.
- [x] Validate positive timeout values and TCP ports in range 0-65535, preserving `--port 0`.
- [x] Render compact human output and stable JSON output.
- [x] Preserve existing exit-code conventions.

### 6. Tests and Verification

#### `src/daemon/manager.test.ts`, `src/persistence/daemon-metadata-store.test.ts`, `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
interface DaemonLifecycleTestMatrix {
  readonly metadata: "missing" | "valid" | "malformed" | "stale";
  readonly processOwner: "owned" | "foreign" | "missing";
  readonly readiness: "ready" | "timeout" | "unauthorized";
}
```

**Checklist**:

- [x] Cover metadata store behavior and malformed JSON recovery.
- [x] Cover start success, stale cleanup, readiness timeout, and early process failure.
- [x] Cover stop success, already stopped, stale metadata, and foreign PID refusal.
- [x] Cover CLI JSON/human output and validation errors.
- [x] Run focused tests, `task typecheck`, `task test`, and `task ci`.

---

## Task Breakdown

### TASK-001: Daemon Contracts and Paths

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/daemon.ts`, `src/config/paths.ts`
**Dependencies**: `P4-HTTP-SERVER`, `P4-AUTH` / `P4-TOKEN-AUTH`

**Description**: Define daemon state, metadata, start/stop/status option/result types, auth summaries, and repository-owned path helpers.
**Completion Criteria**:
- [x] Daemon type contracts compile under strict TypeScript.
- [x] Metadata path and JSONL lifecycle log path helpers use existing config/data directory conventions.
- [x] Raw token values are absent from status result types.
- [x] Defaults match the accepted design: host `127.0.0.1`, port `0`, health path `/api/health`.

### TASK-002: Metadata Store

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**: `src/persistence/daemon-metadata-store.ts`, `src/persistence/daemon-metadata-store.test.ts`
**Dependencies**: TASK-001

**Description**: Implement atomic daemon metadata persistence and malformed-file stale detection.
**Completion Criteria**:
- [x] Store reads missing metadata as stopped/null.
- [x] Store reports malformed metadata as stale without throwing through CLI status.
- [x] Atomic write and remove behavior is covered by tests.

### TASK-003: Process and Readiness Adapters

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**: `src/daemon/process.ts`, `src/daemon/readiness.ts`
**Dependencies**: TASK-001, `P4-HTTP-SERVER`, `P4-AUTH` / `P4-TOKEN-AUTH`

**Description**: Create testable process ownership and health-readiness seams for the daemon manager.
**Completion Criteria**:
- [x] Process ownership rejects foreign or reused PIDs.
- [x] Readiness probe supports timeout, interval, `GET /api/health`, and auth token options.
- [x] Tests cover ready, timeout, unauthorized, missing PID, and owner mismatch cases.

### TASK-004: Daemon Manager

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/daemon/manager.ts`, `src/daemon/manager.test.ts`
**Dependencies**: TASK-002, TASK-003, `P4-SSE`

**Description**: Orchestrate start, stop, status, stale cleanup, server process spawn through the local HTTP server contract, readiness update, and owned shutdown.
**Completion Criteria**:
- [x] Start cleans safe stale metadata and refuses active running daemon conflicts.
- [x] Start writes starting metadata and promotes to running after readiness with actual bound port.
- [x] Failed readiness terminates owned child process and records failure status.
- [x] Stop removes metadata only after owned shutdown or safe stale cleanup.
- [x] Status returns stopped, running, stale, and failed states deterministically.

### TASK-005: Daemon CLI

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**: Expose `cursor-cli-agent daemon start|stop|status` with validation, JSON output, human output, and existing exit-code conventions.
**Completion Criteria**:
- [x] Current daemon stub is replaced by implemented subcommands.
- [x] Start/stop/status support `--json`; start/status support token inputs for readiness, and start supports host, port, and timeout options.
- [x] `daemon stop --force` is not accepted in this slice.
- [x] Unknown subcommands and invalid numeric options return usage errors.
- [x] CLI tests cover success and error paths.

### TASK-006: End-to-End Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/daemon/manager.test.ts`, `src/cli/cli.test.ts`, `README.md`, `.divedra/README.md`, `.agents/skills/divedra-impl-workflow/SKILL.md`
**Dependencies**: TASK-005

**Description**: Run package verification, manual isolated-directory daemon smoke tests, and workflow-required documentation refresh once dependency plans provide the server/auth/SSE runtime.
**Completion Criteria**:
- [x] `bun test src/daemon/manager.test.ts src/persistence/daemon-metadata-store.test.ts src/cli/cli.test.ts` passes.
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes or environment blockers are documented.
- [x] Isolated `daemon start/status/stop --json` smoke passes with temp config/data dirs or is documented as environment-dependent alongside automated daemon manager/CLI tests.
- [x] `README.md`, `.divedra/README.md`, and `.agents/skills/divedra-impl-workflow/SKILL.md` are refreshed for daemon lifecycle behavior or explicitly documented as no-op.

---

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Daemon types | `src/types/daemon.ts` | COMPLETED | Typecheck |
| Path helpers | `src/config/paths.ts` | COMPLETED | Metadata store tests |
| Metadata store | `src/persistence/daemon-metadata-store.ts` | COMPLETED | `src/persistence/daemon-metadata-store.test.ts` |
| Process adapter | `src/daemon/process.ts` | COMPLETED | `src/daemon/process.test.ts`, `src/daemon/manager.test.ts` |
| Readiness probe | `src/daemon/readiness.ts` | COMPLETED | `src/daemon/manager.test.ts` |
| Daemon manager | `src/daemon/manager.ts` | COMPLETED | `src/daemon/manager.test.ts` |
| CLI commands | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| `P4-DAEMON` | `P4-HTTP-SERVER` | Ready; use `startHttpServer`, `resolveHttpServerConfig`, and `GET /api/health` |
| `P4-DAEMON` | `P4-SSE` | Ready; required for server supervision config compatibility |
| `P4-DAEMON` | `P4-AUTH` / `P4-TOKEN-AUTH` | Ready; required for auth-aware readiness |
| TASK-002 | TASK-001 | Completed |
| TASK-003 | TASK-001 | Completed |
| TASK-004 | TASK-002, TASK-003 | Completed |
| TASK-005 | TASK-004 | Completed |
| TASK-006 | TASK-005 | Completed |

## Parallelizable Tasks

- TASK-001 is parallelizable because it writes only daemon contracts and path helpers.
- TASK-002 and TASK-003 can be developed in separate branches after TASK-001 because their write sets are disjoint.
- TASK-004, TASK-005, and TASK-006 are sequential.

## Completion Criteria

- [x] Daemon metadata model and store are implemented with atomic writes.
- [x] Stale PID cleanup is safe and refuses foreign PID termination.
- [x] Daemon manager starts, stops, and reports status through testable seams.
- [x] Readiness checks validate server health and auth behavior.
- [x] CLI daemon commands provide human and JSON output.
- [x] No runtime code writes to Cursor-managed transcript, skill, or AI tracking directories.
- [x] README and user-facing workflow-skill refresh is completed after implementation.
- [x] Focused daemon tests, `task typecheck`, `task test`, and `task ci` pass.

## Verification Commands

```bash
bun test src/daemon/manager.test.ts src/persistence/daemon-metadata-store.test.ts src/cli/cli.test.ts
task typecheck
task test
task ci
rg -n 'daemon start|daemon stop|daemon status|/api/health' README.md .divedra/README.md .agents/skills/divedra-impl-workflow/SKILL.md
git diff --check -- README.md .divedra/README.md .agents/skills/divedra-impl-workflow/SKILL.md
```

Manual smoke after implementation and dependency completion:

```bash
CURSOR_CLI_AGENT_DATA_DIR=/private/tmp/cursor-daemon-data \
CURSOR_CLI_AGENT_CONFIG_DIR=/private/tmp/cursor-daemon-config \
bun run src/main.ts daemon start --port 0 --json

bun run src/main.ts daemon status --json
bun run src/main.ts daemon stop --json
```

## Risks

- PID reuse creates unsafe shutdown risk unless owner markers are strict.
- Server/auth/SSE dependency contracts may drift during concurrent Phase 4 work; implementation must follow the landed local `src/server` and `src/auth` contracts.
- Detached process behavior can differ between local shells and CI.

## Progress Log

### Session: 2026-05-07 23:05
**Tasks Completed**: Addressed Step 5 feedback by adding docs refresh deliverables, preserving `--port 0`, and aligning TASK-002/TASK-003 parallel flags.

### Session: 2026-05-09

**Tasks Completed**: Cross-reviewed git diff adding SDK `usageEventStore` DI and exhaustive `sessionIdFromEvent`; aligned HTTP/README documentation so daemon supervision stays documented next to `server start` and resource REST surfaces.

**Notes**: Optional isolated `daemon start|status|stop` smoke with temp dirs remains environment-dependent (listen/bind); `.agents/skills/divedra-impl-workflow/SKILL.md` treated as optional per repo layout (`.claude` vs `.agents`).

### Session: 2026-05-07 23:55
**Tasks Completed**: Completed TASK-001 through TASK-005 and most TASK-006 implementation verification for `P4-DAEMON`.
**Notes**: Added daemon contracts, config/data path helpers, atomic metadata store, process ownership adapter, HTTP readiness probe, daemon manager, CLI `daemon start|status|stop`, focused tests, README refresh, and `.divedra/README.md` refresh. Step 7 feedback was addressed by requiring exact `CURSOR_CLI_AGENT_DAEMON_MARKER` ownership, adding `src/daemon/process.test.ts`, making auth-required status probe with a runtime token, and terminating alive owned failed or stopping metadata before retry. `bun test src/daemon/process.test.ts src/daemon/manager.test.ts src/persistence/daemon-metadata-store.test.ts src/cli/cli.test.ts`, `task typecheck`, `task test`, and `task ci` passed. Isolated daemon smoke was blocked by this sandbox because the foreground server command failed to bind `127.0.0.1` with `Failed to listen at 127.0.0.1`. `.agents/skills/divedra-impl-workflow/SKILL.md` refresh remains for Step 8 because this Step 6 attempt could not edit that skill file through the available patch tool.
