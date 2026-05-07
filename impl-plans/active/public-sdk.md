# Public SDK Facade Implementation Plan

**Status**: Completed
**Issue Reference**: `parity-global-design-plan-implement-loop#P4-PUBLIC-SDK`
**Design Reference**: `design-docs/specs/design-public-sdk.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-public-sdk.md`

### Summary

Implement Phase 4 `P4-PUBLIC-SDK`: stable, import-safe package exports for normalized sessions, search, groups, queues, bookmarks, files, activity, agent runner events, server helpers, and deterministic testing mocks.

### Scope

**Included**: import-safe library entrypoints, SDK barrels, facade contracts and factories, runner abstraction, server helper exports bound to local HTTP/SSE contracts, testing mocks, package export metadata, and import/export smoke tests.
**Excluded**: raw Cursor adapter payload exports, codex-agent compatibility aliases, remote cloud APIs, GUI automation, writes to Cursor-managed state, and compatibility bridge behavior reserved for `P5-COMPAT-BRIDGE`.

### Accepted Implementation Defaults

- Root `.` is an import-safe compatibility barrel and must not bootstrap CLI behavior.
- `./sdk` is the preferred SDK facade entrypoint.
- Server helper contracts are exported from `./server` only for this slice.
- `./sdk` does not re-export server helpers until a later design opts in.
- Public runner payloads use this repository's Cursor-neutral `AgentEvent` model, not Codex rollout payloads.

## Codex Reference Mapping

Workflow-provided reference root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`.

The workflow-provided root exists but is empty in this checkout. Implementation must use the inspected fallback root `/g/gits/tacogips/codex-agent` as structural reference only.

Reference files: `/g/gits/tacogips/codex-agent/src/main.ts`, `/g/gits/tacogips/codex-agent/src/sdk/index.ts`, `/g/gits/tacogips/codex-agent/src/sdk/agent-runner.ts`, `/g/gits/tacogips/codex-agent/src/sdk/session-runner.ts`, and `/g/gits/tacogips/codex-agent/package.json`.

Intentional divergences accepted by the design:

- The SDK exposes Cursor session identity fields: `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.
- Public agent events use local `AgentEvent` contracts from `src/types/agent-event.ts`.
- Server helpers bind to local `P4-HTTP-SERVER` and `P4-SSE` contracts.
- Testing mocks live under `./sdk/testing` and never read or write Cursor-managed directories.

---

## Modules

### 1. Import-Safe Package Entry

#### `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json`

**Status**: COMPLETED

```typescript
export * from "./sdk/index";
export { runCli } from "./cli/cli";

export async function main(argv: readonly string[]): Promise<number>;
```

**Checklist**: [x] import-safe root exports only; [x] bin-only process startup; [x] CLI executable behavior preserved; [x] package metadata updated.

### 2. SDK Public Types and Barrel

#### `src/sdk/types.ts`, `src/sdk/index.ts`

**Status**: COMPLETED

```typescript
export interface CursorAgentSdk {
  readonly sessions: SessionFacade;
  readonly search: SearchFacade;
  readonly groups: GroupFacade;
  readonly queues: QueueFacade;
  readonly bookmarks: BookmarkFacade;
  readonly files: FileFacade;
  readonly activity: ActivityFacade;
  readonly runner: AgentRunnerFacade;
}

export interface CursorAgentSdkOptions {
  readonly stateRoot?: string;
  readonly cursorHome?: string;
  readonly cursorBinary?: string;
  readonly now?: () => Date;
}
```

**Checklist**: [x] normalized `src/types/*` exports only; [x] dependency-injected construction; [x] side-effect-free module load; [x] `createCursorAgentSdk(options?: CursorAgentSdkOptions): CursorAgentSdk`.

### 3. Domain Facades

#### `src/sdk/facades.ts`

**Status**: COMPLETED

```typescript
export interface SessionFacade {
  list(): Promise<readonly CursorSessionRecord[]>;
  get(sessionId: string): Promise<CursorSessionRecord | null>;
  refresh(): Promise<readonly CursorSessionRecord[]>;
}

export interface SearchFacade {
  sessions(options: SessionSearchOptions): Promise<SessionSearchResult>;
  transcripts(
    options: TranscriptSearchOptions,
  ): Promise<TranscriptSearchResult>;
}
```

**Checklist**: [x] wrap existing repositories/managers; [x] preserve pending and materialized session identity; [x] include groups, queues, bookmarks, files, and activity facades; [x] use explicit unsupported/dependency errors only where a local dependency contract is absent.

### 4. Agent Runner Facade

#### `src/sdk/agent-runner.ts`

**Status**: COMPLETED

```typescript
export type CursorAgentStreamMode = "event" | "normalized";

export interface CursorAgentRequest {
  readonly prompt?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly mode?: "default" | "plan" | "ask";
  readonly streamMode?: CursorAgentStreamMode;
}

export interface CursorRunningAgent {
  readonly sessionId: string;
  messages(): AsyncGenerator<AgentEvent, void, undefined>;
  waitForCompletion(): Promise<CursorAgentRunResult>;
  cancel(): Promise<void>;
  interrupt(): Promise<void>;
}
```

**Checklist**: [x] start and resume through `src/cursor/process-runner.ts`; [x] expose normalized `AgentEvent` streams; [x] preserve pending/materialized identity transitions; [x] avoid Codex rollout line types.

### 5. Server Helper Exports

#### `src/sdk/server.ts`

**Status**: COMPLETED

```typescript
export interface SdkServerHelpers {
  createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
  createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}
```

**Checklist**: [x] export helper contracts against `P4-HTTP-SERVER` and `P4-SSE`; [x] keep helper outputs on the SDK facade boundary; [x] avoid invented transport behavior or raw adapter routes; [x] publish from `./server` only.

### 6. Testing Mocks

#### `src/sdk/testing.ts`

**Status**: COMPLETED

```typescript
export interface MockCursorRunningAgentOptions {
  readonly sessionId: string;
  readonly events?: readonly AgentEvent[];
  readonly result?: CursorAgentRunResult;
  readonly autoComplete?: boolean;
}

export function createMockCursorAgentSdk(
  input?: Partial<CursorAgentSdk>,
): CursorAgentSdk;
```

**Checklist**: [x] deterministic mock SDK, runner, running session, and event stream helpers; [x] in-memory facade mocks; [x] `./sdk/testing` isolation; [x] no Cursor-managed state access.

### 7. Export and Import Verification

#### `src/sdk/*.test.ts`, `scripts/check-package-exports.ts`

**Status**: COMPLETED

**Checklist**: [x] root import does not execute CLI startup; [x] root, SDK, testing, server, and types imports resolve; [x] declarations emit for public paths; [x] public barrels do not export raw Cursor adapter symbols.

---

## Module Status

| Module                      | File Path                                                   | Status    | Tests                                     |
| --------------------------- | ----------------------------------------------------------- | --------- | ----------------------------------------- |
| Import-safe package entry   | `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json` | COMPLETED | `src/sdk/index.test.ts`, smoke imports    |
| SDK public types and barrel | `src/sdk/types.ts`, `src/sdk/index.ts`                      | COMPLETED | `task typecheck`, `src/sdk/index.test.ts` |
| Domain facades              | `src/sdk/facades.ts`                                        | COMPLETED | `src/sdk/index.test.ts`                   |
| Agent runner facade         | `src/sdk/agent-runner.ts`                                   | COMPLETED | `src/sdk/agent-runner.test.ts`            |
| Server helpers              | `src/sdk/server.ts`                                         | COMPLETED | package export and server import smoke    |
| Testing mocks               | `src/sdk/testing.ts`                                        | COMPLETED | `src/sdk/testing.test.ts`                 |
| Export verification         | `src/sdk/*.test.ts`, `scripts/check-package-exports.ts`     | COMPLETED | `task ci`, export checker, smoke imports  |

## Work Breakdown

### TASK-001: Split Import-Safe Entry from CLI Startup

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json`
**Dependencies**: None

**Completion Criteria**:

- [x] Root package import does not parse CLI argv, spawn Cursor, write state, or set process exit state.
- [x] CLI executable still invokes `runCli(process.argv)`.
- [x] Package metadata exposes root, SDK, testing, server, and types subpaths.

### TASK-002: Define SDK Public Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/sdk/types.ts`, `src/sdk/index.ts`
**Dependencies**: P2/P3 domain contracts and accepted design defaults

**Completion Criteria**:

- [x] `CursorAgentSdk`, options, runner, and facade types compile under strict TypeScript.
- [x] Public barrels export normalized sessions, search, groups, queues, bookmarks, files, activity, and agent-event contracts.
- [x] Raw `src/cursor/*` adapter payload symbols are not exported.

### TASK-003: Implement Domain Facade Factory

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/sdk/facades.ts`, `src/sdk/index.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Facade methods call existing repository, manager, store, and config APIs.
- [x] Returned records preserve Cursor session identity fields.
- [x] Queue, file, bookmark, group, activity, and search facades use their existing domain result contracts.

### TASK-004: Implement Cursor Agent Runner Facade

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/sdk/agent-runner.ts`
**Dependencies**: TASK-002, existing process runner and `AgentEvent` contracts

**Completion Criteria**:

- [x] Runner supports start, resume, messages, completion, cancel, and interrupt.
- [x] Runner emits normalized `AgentEvent` values.
- [x] Tests cover normalized runner events and existing server event tests cover pending and materialized session identity events.

### TASK-005: Add Server Helper Export Shell

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/sdk/server.ts`, package `./server` export
**Dependencies**: TASK-002, `P4-HTTP-SERVER`, `P4-SSE`

**Completion Criteria**:

- [x] `./server` resolves and exports normalized helper contracts.
- [x] Helpers use SDK facade contracts as their domain boundary.
- [x] Server-helper dependency wording matches the accepted design.

### TASK-006: Add Testing Mocks

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/sdk/testing.ts`, `src/sdk/testing.test.ts`
**Dependencies**: TASK-002, TASK-004

**Completion Criteria**:

- [x] `./sdk/testing` exports mock SDK and runner helpers.
- [x] Mocks are deterministic and avoid Cursor-managed directories.
- [x] Mock behavior is covered by focused tests.

### TASK-007: Verify Package Exports and Adapter Privacy

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `scripts/check-package-exports.ts`, `src/sdk/*.test.ts`
**Dependencies**: TASK-001 through TASK-006

**Completion Criteria**:

- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.
- [x] `bun run scripts/check-package-exports.ts` proves root, SDK, testing, server, and types paths resolve.

## Dependencies

| Feature                 | Depends On                                                                       | Status                                                      |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Public SDK base exports | P2 session/transcript search, bookmarks, activity, P3 group/queue/file contracts | READY per local active plans/source                         |
| Server helper facade    | `P4-HTTP-SERVER`, `P4-SSE`                                                       | READY per runtime review context and local server/SSE plans |
| Testing mocks           | TASK-002 and TASK-004 contracts                                                  | COMPLETED                                                   |
| Export verification     | TASK-001 through TASK-006                                                        | COMPLETED                                                   |

## Parallelization

- TASK-001 and TASK-002 are parallelizable because their write scopes are disjoint except for final package/barrel integration.
- TASK-003, TASK-004, TASK-005, TASK-006, and TASK-007 are not parallelizable until TASK-002 establishes the shared contracts they consume.

## Verification

Required commands:

```bash
task typecheck
task test
task ci
bun run scripts/check-package-exports.ts
```

Smoke commands:

```bash
bun -e 'import("curort-cli-agent").then(() => console.log("import ok"))'
bun -e 'import("curort-cli-agent/sdk/testing").then(() => console.log("testing ok"))'
```

Verification focus:

- Root import is side-effect safe and does not execute `src/main.ts` CLI startup behavior.
- CLI executable still invokes `runCli(process.argv)`.
- Package export metadata covers `.`, `./sdk`, `./sdk/testing`, `./server`, and `./types`.
- Public SDK barrels do not leak raw Cursor adapter payload shapes.

## Completion Criteria

- [x] Root package import is side-effect safe.
- [x] SDK exports cover sessions, search, groups, queues, bookmarks, files, activity, runner events, server helpers, and testing mocks.
- [x] Package subpath exports and declarations resolve.
- [x] No raw Cursor adapter payload shapes become public SDK contracts.
- [x] Verification commands pass or unrelated failures are documented.
- [ ] README and user-facing workflow skill refresh steps are completed in later workflow nodes after implementation.

## Addressed Review Feedback

- Step 2 self-review low feedback: reconciled stale implementation-plan server-helper dependency wording and the empty workflow codex-agent root.
- Step 3 design-review low finding: replaced workflow-root Codex paths with inspected fallback `/g/gits/tacogips/codex-agent` files and aligned server-helper dependencies with `P4-HTTP-SERVER` plus `P4-SSE`.
- Step 7 mid finding: updated daemon server spawning from `src/main.ts` to `src/bin.ts` after the import-safe entry split and added a regression test for daemon spawn arguments.

## Risks

1. Import-safe entry splitting can regress CLI startup if bin and library entrypoints are coupled incorrectly.
2. Public barrels can accidentally expose raw `src/cursor/*` adapter symbols without explicit export tests.
3. Package exports may typecheck but fail runtime resolution without smoke checks against built outputs.
4. SDK facade methods may duplicate manager logic instead of wiring existing domain services.

## Progress Log

### Session: 2026-05-06 12:45

**Tasks Completed**: Initial design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation was deferred pending dependency reconciliation.
**Notes**: Planning only; no TypeScript runtime code implemented in this branch.

### Session: 2026-05-07 Step 4 Plan Refresh

**Tasks Completed**: Reconciled the active implementation plan with accepted Step 3 design review for `parity-global-design-plan-implement-loop#P4-PUBLIC-SDK`.
**Tasks In Progress**: None.
**Blockers**: None for Step 4 planning.
**Notes**: Updated Codex reference mapping, server-helper dependencies, task breakdown, verification commands, completion criteria, and addressed feedback for the later implementation step.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented import-safe root and bin entrypoints, public SDK contracts and facade factory, normalized runner facade, server helper subpath, deterministic testing mocks, package export metadata, export checker, and focused SDK tests. Verification passed with `task typecheck`, `task test`, `task ci`, `bun run scripts/check-package-exports.ts`, and root/testing/server/types import smoke commands.

### Session: 2026-05-07 Step 6 Rerun After Step 7 Review

**Tasks Completed**: TASK-001 daemon executable-entry regression follow-up.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid finding by changing daemon server spawning to use `src/bin.ts` instead of import-safe `src/main.ts`, updating daemon process test references, adding a regression test for daemon spawn arguments, and running the required TypeScript, test, CI, export, import-smoke, and daemon-start smoke verification commands.

## Related Plans

- **Depends On**: `impl-plans/active/http-server-core.md`, `impl-plans/active/server-event-streaming.md`, P2/P3 domain feature plans.
- **Next**: Step 7 implementation review for `P4-PUBLIC-SDK`.
