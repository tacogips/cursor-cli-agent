# Daemon Lifecycle Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-daemon-lifecycle.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-daemon-lifecycle.md`

### Summary

Implement backlog slice `P4-DAEMON`: repository-owned daemon metadata, start/stop/status lifecycle, stale PID cleanup, HTTP server supervision, readiness checks, and `daemon` CLI commands for the Cursor-oriented control plane.

### Scope

**Included**: daemon types, config/data path helpers, atomic metadata store, process lifecycle manager, readiness probe abstraction, CLI commands, and focused unit/integration tests.

**Excluded**: runtime code implementation in this planning branch, HTTP route implementation, SSE event semantics, token creation/permission storage, app-server compatibility, remote daemon control, and direct writes to Cursor-owned files.

### Dependencies

- `P4-HTTP-SERVER-CORE`: startable server entrypoint, health route, host/port config, graceful shutdown.
- `P4-SSE`: server route may be supervised by the daemon but event derivation remains owned by the SSE plan.
- `P4-TOKEN-AUTH`: token propagation and readiness auth expectations.
- Phase 1-3 local modules: normalized session, activity, group, queue, bookmark, and file intelligence APIs available to the server.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: reference daemon contracts, PID lifecycle, readiness probing, and CLI integration.
- `/Users/taco/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`: reference architecture for server/process boundaries.
- `/Users/taco/gits/tacogips/codex-agent/README.md`: reference CLI command family and verification commands.

Intentional divergences:

- Supervise this repository's HTTP/SSE server, not Codex app-server.
- Persist daemon metadata under repository config/data directories, not Codex or Cursor state roots.
- Treat Cursor transcripts, skills, and `ai-code-tracking.db` as read-only inputs owned by adapter modules.
- Do not expose raw bearer tokens in status output or PID metadata summaries.

---

## Modules

### 1. Daemon Types

#### `src/types/daemon.ts`

**Status**: NOT_STARTED

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
  readonly pid: number;
  readonly parentPid: number;
  readonly marker: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly dataDir: string;
  readonly configDir: string;
  readonly startedAt: string;
  readonly lastCheckedAt?: string;
  readonly auth: DaemonAuthSummary;
}

export interface DaemonStatusResult {
  readonly state: DaemonState;
  readonly metadata?: DaemonMetadata;
  readonly staleReason?: string;
}
```

**Checklist**:

- [ ] Define daemon state, metadata, auth summary, start/stop options, and result contracts.
- [ ] Keep raw token values out of serializable status results.
- [ ] Export types for manager, persistence, CLI, and tests.

### 2. Daemon Paths and Metadata Store

#### `src/config/paths.ts`, `src/persistence/daemon-metadata-store.ts`

**Status**: NOT_STARTED

```typescript
export function daemonMetadataPath(): string;
export function daemonLogPath(): string;

export interface DaemonMetadataStore {
  read(): Promise<DaemonMetadata | null>;
  write(metadata: DaemonMetadata): Promise<void>;
  remove(): Promise<void>;
}
```

**Checklist**:

- [ ] Add config/data path helpers using existing environment override behavior.
- [ ] Implement atomic metadata writes through a repository-owned JSON file.
- [ ] Treat missing metadata as stopped and malformed metadata as stale.
- [ ] Add tests for missing, valid, malformed, and remove behavior.

### 3. Process Ownership and Readiness Interfaces

#### `src/daemon/process.ts`, `src/daemon/readiness.ts`

**Status**: NOT_STARTED

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

- [ ] Isolate process lookup, owner matching, and termination for deterministic tests.
- [ ] Implement HTTP health polling with timeout and interval options.
- [ ] Support auth-enabled probes without logging token values.
- [ ] Cover PID reuse, timeout, early child exit, and successful readiness tests.

### 4. Daemon Manager

#### `src/daemon/manager.ts`

**Status**: NOT_STARTED

```typescript
export interface DaemonManager {
  start(options?: DaemonStartOptions): Promise<DaemonStartResult>;
  stop(options?: DaemonStopOptions): Promise<DaemonStopResult>;
  status(options?: DaemonStatusOptions): Promise<DaemonStatusResult>;
}

export function createDaemonManager(deps?: DaemonManagerDeps): DaemonManager;
```

**Checklist**:

- [ ] Clean stale metadata before start when safe.
- [ ] Spawn the server process with normalized host, port, data/config, auth, and Cursor home settings.
- [ ] Write `starting` metadata after spawn and update to `running` after readiness succeeds.
- [ ] On readiness failure, terminate owned process and return `failed`.
- [ ] Stop only owned daemon processes and remove metadata after clean shutdown.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
async function runDaemon(argv: readonly string[]): Promise<number>;
```

**Checklist**:

- [ ] Replace the current daemon not-implemented stub with `start`, `stop`, and `status`.
- [ ] Add `--host`, `--port`, `--token`, `--timeout-ms`, and `--json` parsing where applicable.
- [ ] Validate positive integer timeout/port values and reject unknown subcommands.
- [ ] Render compact human output and stable JSON output.
- [ ] Preserve existing exit-code conventions.

### 6. Tests and Verification

#### `src/daemon/manager.test.ts`, `src/persistence/daemon-metadata-store.test.ts`, `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
interface DaemonLifecycleTestMatrix {
  readonly metadata: "missing" | "valid" | "malformed" | "stale";
  readonly processOwner: "owned" | "foreign" | "missing";
  readonly readiness: "ready" | "timeout" | "unauthorized";
}
```

**Checklist**:

- [ ] Cover metadata store behavior and malformed JSON recovery.
- [ ] Cover start success, stale cleanup, readiness timeout, and early process failure.
- [ ] Cover stop success, already stopped, stale metadata, and foreign PID refusal.
- [ ] Cover CLI JSON/human output and validation errors.
- [ ] Run focused tests, `task typecheck`, `task test`, and `task ci`.

---

## Task Breakdown

### TASK-001: Daemon Contracts and Paths

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/daemon.ts`, `src/config/paths.ts`
**Dependencies**: `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`

**Description**: Define daemon state, metadata, start/stop/status option/result types, auth summaries, and repository-owned path helpers.
**Completion Criteria**:
- [ ] Daemon type contracts compile under strict TypeScript.
- [ ] Metadata path and log path helpers use existing config/data directory conventions.
- [ ] Raw token values are absent from status result types.

### TASK-002: Metadata Store

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/daemon-metadata-store.ts`, `src/persistence/daemon-metadata-store.test.ts`
**Dependencies**: TASK-001

**Description**: Implement atomic daemon metadata persistence and malformed-file stale detection.
**Completion Criteria**:
- [ ] Store reads missing metadata as stopped/null.
- [ ] Store detects malformed metadata without throwing through CLI status.
- [ ] Atomic write and remove behavior is covered by tests.

### TASK-003: Process and Readiness Adapters

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/daemon/process.ts`, `src/daemon/readiness.ts`
**Dependencies**: TASK-001, `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`

**Description**: Create testable process ownership and health-readiness seams for the daemon manager.
**Completion Criteria**:
- [ ] Process ownership rejects foreign or reused PIDs.
- [ ] Readiness probe supports timeout, interval, health URL, and auth token options.
- [ ] Tests cover ready, timeout, unauthorized, missing PID, and owner mismatch cases.

### TASK-004: Daemon Manager

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/daemon/manager.ts`, `src/daemon/manager.test.ts`
**Dependencies**: TASK-002, TASK-003, `P4-SSE`

**Description**: Orchestrate start, stop, status, stale cleanup, server process spawn, readiness update, and owned shutdown.
**Completion Criteria**:
- [ ] Start cleans safe stale metadata and refuses active running daemon conflicts.
- [ ] Start writes starting metadata and promotes to running after readiness.
- [ ] Failed readiness terminates owned child process and records failure status.
- [ ] Stop removes metadata only after owned shutdown or safe stale cleanup.
- [ ] Status returns stopped, running, stale, and failed states deterministically.

### TASK-005: Daemon CLI

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004

**Description**: Expose `curort-cli-agent daemon start|stop|status` with validation, JSON output, human output, and existing exit-code conventions.
**Completion Criteria**:
- [ ] Current daemon stub is replaced by implemented subcommands.
- [ ] Start/stop/status support `--json`; start supports host, port, token, and timeout options.
- [ ] Unknown subcommands and invalid numeric options return usage errors.
- [ ] CLI tests cover success and error paths.

### TASK-006: End-to-End Verification

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/daemon/manager.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-005

**Description**: Run package verification and manual isolated-directory daemon smoke tests once dependency plans provide the server/auth/SSE runtime.
**Completion Criteria**:
- [ ] `bun test src/daemon/manager.test.ts src/persistence/daemon-metadata-store.test.ts src/cli/cli.test.ts` passes.
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes or environment blockers are documented.
- [ ] Isolated `daemon start/status/stop --json` smoke passes with temp config/data dirs.

---

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Daemon types | `src/types/daemon.ts` | NOT_STARTED | Typecheck |
| Path helpers | `src/config/paths.ts` | NOT_STARTED | Metadata store tests |
| Metadata store | `src/persistence/daemon-metadata-store.ts` | NOT_STARTED | `src/persistence/daemon-metadata-store.test.ts` |
| Process adapter | `src/daemon/process.ts` | NOT_STARTED | `src/daemon/manager.test.ts` |
| Readiness probe | `src/daemon/readiness.ts` | NOT_STARTED | `src/daemon/manager.test.ts` |
| Daemon manager | `src/daemon/manager.ts` | NOT_STARTED | `src/daemon/manager.test.ts` |
| CLI commands | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| `P4-DAEMON` | `P4-HTTP-SERVER-CORE` | Required before implementation |
| `P4-DAEMON` | `P4-SSE` | Required for server supervision config compatibility |
| `P4-DAEMON` | `P4-TOKEN-AUTH` | Required for auth-aware readiness |
| TASK-002 | TASK-001 | BLOCKED |
| TASK-003 | TASK-001 | BLOCKED |
| TASK-004 | TASK-002, TASK-003 | BLOCKED |
| TASK-005 | TASK-004 | BLOCKED |
| TASK-006 | TASK-005 | BLOCKED |

## Parallelizable Tasks

- TASK-001 is parallelizable once dependency feature contracts are available.
- TASK-002 and TASK-003 can be developed in separate branches after TASK-001 because their write sets are disjoint.
- TASK-004, TASK-005, and TASK-006 are sequential.

## Completion Criteria

- [ ] Daemon metadata model and store are implemented with atomic writes.
- [ ] Stale PID cleanup is safe and refuses foreign PID termination.
- [ ] Daemon manager starts, stops, and reports status through testable seams.
- [ ] Readiness checks validate server health and auth behavior.
- [ ] CLI daemon commands provide human and JSON output.
- [ ] No runtime code writes to Cursor-managed transcript, skill, or AI tracking directories.
- [ ] Focused daemon tests, `task typecheck`, `task test`, and `task ci` pass.

## Verification Commands

```bash
bun test src/daemon/manager.test.ts src/persistence/daemon-metadata-store.test.ts src/cli/cli.test.ts
task typecheck
task test
task ci
```

Manual smoke after implementation and dependency completion:

```bash
CURORT_CLI_AGENT_DATA_DIR=/private/tmp/curort-daemon-data \
CURORT_CLI_AGENT_CONFIG_DIR=/private/tmp/curort-daemon-config \
bun run src/main.ts daemon start --port 0 --json

bun run src/main.ts daemon status --json
bun run src/main.ts daemon stop --json
```

## Open Questions

- Should `daemon start` default to a fixed server-core port or select an available port when `--port` is omitted?
- Should `daemon stop --force` exist in the first implementation, or should foreign/ambiguous PID cleanup stay manual?
- Should daemon/server logs be JSONL, plain text, or both?

## Risks

- PID reuse creates unsafe shutdown risk unless owner markers are strict.
- Server/auth/SSE dependency plans may settle on different health route or config names.
- Detached process behavior can differ between local shells and CI.
- Concurrent Phase 4 planning branches may require later reconciliation in `impl-plans/PROGRESS.json` and `impl-plans/README.md`.

## Progress Log

### Session: 2026-05-06 12:45
**Tasks Completed**: Planning artifact created for `P4-DAEMON`.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation depends on `P4-HTTP-SERVER-CORE`, `P4-SSE`, and `P4-TOKEN-AUTH` contracts.
**Notes**: This plan intentionally does not implement runtime code and keeps Cursor-owned state read-only.
