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
- Daemon/server source-mode startup must target executable `src/bin.ts`, not import-safe `src/main.ts`.

## Codex Reference Mapping

Workflow-provided reference root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`.

The workflow-provided root exists but is empty in this checkout. Use inspected fallback root `/g/gits/tacogips/codex-agent` as structural reference only.

Reference files:

- `/g/gits/tacogips/codex-agent/src/sdk/index.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/agent-runner.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/session-runner.ts`
- `/g/gits/tacogips/codex-agent/src/main.ts`
- `/g/gits/tacogips/codex-agent/package.json`
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`

Intentional divergences accepted by the design:

- Preserve Cursor identity fields: `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.
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

**Checklist**: [x] import-safe root; [x] `src/bin.ts` owns process exit; [x] package exports; [x] daemon/server startup uses an absolute executable `src/bin.ts` path in source mode.

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

export function createCursorAgentSdk(
  options?: CursorAgentSdkOptions,
): CursorAgentSdk;
```

**Checklist**: [x] normalized `src/types/*` exports; [x] private `src/cursor/*` payloads; [x] DI options; [x] side-effect-free load.

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

**Checklist**: [x] use existing repositories/managers/stores/config; [x] preserve identity states; [x] reuse domain contracts; [x] typed missing-dependency behavior.

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

**Checklist**: [x] start/resume through `process-runner`; [x] normalized `AgentEvent`; [x] identity transitions; [x] no Codex rollout-line public types.

### 5. Server Helper Exports

#### `src/sdk/server.ts`

**Status**: COMPLETED

```typescript
export interface SdkServerHelpers {
  createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
  createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}
```

**Checklist**: [x] `P4-HTTP-SERVER` and `P4-SSE` contracts; [x] SDK facade boundary; [x] no invented transport or raw adapter routes; [x] `./server` only.

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

**Checklist**: [x] deterministic mock SDK/runner/events; [x] in-memory facades; [x] `./sdk/testing` isolation; [x] no Cursor-managed state access.

### 7. Export and Import Verification

#### `src/sdk/*.test.ts`, `src/daemon/manager.test.ts`, `scripts/check-package-exports.ts`

**Status**: COMPLETED

**Checklist**: [x] root import side-effect safe; [x] public imports resolve; [x] declarations emit; [x] no raw adapter exports; [x] daemon spawn targets an executable `src/bin.ts` path.

---

## Module Status

| Module                    | File Path                                                   | Status      | Tests |
| ------------------------- | ----------------------------------------------------------- | ----------- | ----- |
| Import-safe package entry | `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json` | COMPLETED | `src/sdk/index.test.ts`, `src/daemon/manager.test.ts`, smoke imports |
| SDK types and barrel      | `src/sdk/types.ts`, `src/sdk/index.ts`                      | COMPLETED | `task typecheck`, `src/sdk/index.test.ts` |
| Domain facades            | `src/sdk/facades.ts`                                        | COMPLETED | `src/sdk/index.test.ts` |
| Agent runner facade       | `src/sdk/agent-runner.ts`                                   | COMPLETED | `src/sdk/agent-runner.test.ts` |
| Server helpers            | `src/sdk/server.ts`                                         | COMPLETED | package export and server import smoke |
| Testing mocks             | `src/sdk/testing.ts`                                        | COMPLETED | `src/sdk/testing.test.ts` |
| Export verification       | `src/sdk/*.test.ts`, `src/daemon/manager.test.ts`, `scripts/check-package-exports.ts` | COMPLETED | `task ci`, export checker, smoke imports |

## Work Breakdown

### TASK-001: Split Import-Safe Entry from CLI Startup

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/index.ts`, `src/bin.ts`, `src/main.ts`, `src/daemon/manager.ts`, `package.json`
**Dependencies**: None

**Completion Criteria**:

- [x] Root package import does not parse CLI argv, spawn Cursor, write state, or set process exit state.
- [x] CLI executable still invokes `runCli(process.argv)`.
- [x] Daemon/server source-mode startup uses an absolute executable `src/bin.ts` path from non-repository cwd.
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
- [x] Queue, file, bookmark, group, activity, and search facades use existing domain result contracts.

### TASK-004: Implement Cursor Agent Runner Facade

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/sdk/agent-runner.ts`
**Dependencies**: TASK-002, existing process runner and `AgentEvent` contracts

**Completion Criteria**:

- [x] Runner supports start, resume, messages, completion, cancel, and interrupt.
- [x] Runner emits normalized `AgentEvent` values.
- [x] Tests cover normalized runner events and pending/materialized identity events.

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
**Deliverables**: `scripts/check-package-exports.ts`, `src/sdk/*.test.ts`, `src/daemon/manager.test.ts`
**Dependencies**: TASK-001 through TASK-006

**Completion Criteria**:

- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.
- [x] `bun run scripts/check-package-exports.ts` proves root, SDK, testing, server, and types paths resolve.
- [x] Import smoke tests prove root and testing subpath load without CLI side effects.

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Public SDK base exports | P2 session/transcript search, bookmarks, activity, P3 group/queue/file contracts | READY per local source and active plans |
| Server helper facade | `P4-HTTP-SERVER`, `P4-SSE` | READY per accepted design |
| Testing mocks | TASK-002 and TASK-004 contracts | COMPLETED |
| Export verification | TASK-001 through TASK-006 | COMPLETED |

## Parallelization

- TASK-001 and TASK-002 are parallelizable because their initial write scopes are disjoint.
- TASK-003, TASK-004, TASK-005, TASK-006, and TASK-007 are not parallelizable until TASK-002 establishes shared public contracts.
- TASK-005 can run in parallel with TASK-006 after TASK-002 if implementers keep `src/sdk/server.ts` and `src/sdk/testing.ts` write scopes disjoint.

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
bun -e 'import("cursor-cli-agent").then(() => console.log("import ok"))'
bun -e 'import("cursor-cli-agent/sdk/testing").then(() => console.log("testing ok"))'
bun -e 'import("cursor-cli-agent/server").then(() => console.log("server ok"))'
bun -e 'import("cursor-cli-agent/types").then(() => console.log("types ok"))'
```

Verification focus:

- Root import is side-effect safe and does not execute CLI startup behavior.
- CLI executable still invokes `runCli(process.argv)`.
- Daemon/server startup from non-repository cwd targets executable `src/bin.ts`.
- Package export metadata covers `.`, `./sdk`, `./sdk/testing`, `./server`, and `./types`.
- Public SDK barrels do not leak raw Cursor adapter payload shapes.

## Completion Criteria

- [x] Root package import is side-effect safe.
- [x] SDK exports cover sessions, search, groups, queues, bookmarks, files, activity, runner events, server helpers, and testing mocks.
- [x] Package subpath exports and declarations resolve.
- [x] No raw Cursor adapter payload shapes become public SDK contracts.
- [x] Daemon startup regression from `src/main.ts` versus `src/bin.ts` is covered by implementation and tests.
- [x] Verification commands pass or unrelated failures are documented.
- [x] README and user-facing workflow skill refresh steps are completed in later workflow nodes after implementation.

## Addressed Review Feedback

- Parent mid implementation feedback: plan now requires daemon/server source-mode startup through executable `src/bin.ts` and includes a daemon spawn regression test.
- Parent low implementation-plan feedback: plan no longer depends on stale `P4-HTTP-RESOURCE-APIS` wording and records both the empty workflow-provided Codex root and inspected fallback reference root.
- Step 3 design review: accepted without high or mid findings; plan traces to the accepted design and keeps raw Cursor adapter payloads private.

## Risks

1. Import-safe entry splitting can regress CLI startup if bin and library entrypoints are coupled incorrectly.
2. Public barrels can accidentally expose raw `src/cursor/*` adapter symbols without explicit export tests.
3. Package exports may typecheck but fail runtime resolution without smoke checks against built outputs.
4. SDK facade methods may duplicate manager logic instead of wiring existing domain services.
5. Daemon startup can regress if future changes target `src/main.ts` instead of `src/bin.ts`.

## Progress Log

### Session: 2026-05-07 Step 4 Plan Refresh

**Tasks Completed**: Rewrote the preferred active implementation plan for `parity-global-design-plan-implement-loop#P4-PUBLIC-SDK` after Step 3 design acceptance.
**Tasks In Progress**: None.
**Blockers**: None for Step 4 planning.
**Notes**: Later implementation should update task status, module status, completion criteria, and this progress log as work lands; once all criteria are complete, move the plan to completed only if repository workflow requires it.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Confirmed the existing public SDK facade files implement the accepted design; fixed daemon server startup to resolve an absolute executable CLI entrypoint so source-mode startup no longer depends on the caller's working directory. Verification passed with `task typecheck`, focused SDK/daemon tests, `task test`, `task ci`, `bun run scripts/check-package-exports.ts`, and package import smoke commands.

## Related Plans

- **Depends On**: `impl-plans/completed/http-server-core.md`, `impl-plans/completed/server-event-streaming.md`, P2/P3 domain feature plans.
- **Next**: Step 7 implementation review for `P4-PUBLIC-SDK`.
