# Public SDK Facade Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-public-sdk.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-public-sdk.md`

### Summary

Implement Phase 4 `P4-PUBLIC-SDK`: stable import-safe package exports for normalized sessions, search, groups, queues, bookmarks, files, activity, agent runner events, server helpers, and testing mocks.

### Scope

**Included**: library entrypoint split from CLI startup, SDK barrels, facade contracts, runner abstractions, server helper shells, testing mocks, package export metadata, and import/export tests.

**Excluded**: runtime implementation in this planning branch, raw Cursor payload exports, codex-agent compatibility aliases, remote cloud APIs, GUI automation, and writes to Cursor-managed state.

- `P2-SESSION-SEARCH`: metadata search and session index contracts.
- `P2-TRANSCRIPT-SEARCH`: transcript hit contracts and stable message IDs.
- `P2-BOOKMARKS`: bookmark lifecycle contracts.
- `P2-ACTIVITY`: derived activity contracts.
- `P3-GROUP-LIFECYCLE`: group lifecycle and progress contracts.
- `P3-QUEUE-LIFECYCLE`: queue lifecycle contracts.
- `P3-FILE-INTELLIGENCE`: file intelligence contracts.
- `P4-HTTP-RESOURCE-APIS`: server resource handler contracts.
- `P4-SSE`: event stream contracts.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/index.ts`: SDK barrel and public type export pattern.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/agent-runner.ts`: agent request, attachment, event, and normalized event generator pattern.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/session-runner.ts`: running session lifecycle abstraction.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/mock-session-runner.ts`: deterministic testing mock pattern.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/main.ts`: public package entrypoint that re-exports modules instead of starting the CLI.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/package.json`: package `exports` including a testing subpath.

Intentional divergences accepted by the design:

- The SDK exports Cursor-normalized records with `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.
- Public agent events use this repository's `AgentEvent` model rather than Codex rollout event shapes.
- Server helpers wait for `P4-HTTP-RESOURCE-APIS` and `P4-SSE` contracts instead of defining transport behavior here.
- Testing mocks live under `./sdk/testing` and avoid Cursor-managed directories.

## Modules

### 1. Import-Safe Package Entry

#### `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json`

**Status**: NOT_STARTED

```typescript
export * from "./sdk/index";
export { runCli } from "./cli/cli";

export async function main(argv: readonly string[]): Promise<number>;
```

**Checklist**:

- [ ] Add an import-safe library entrypoint that only exports symbols.
- [ ] Keep process startup and `process.exitCode` assignment in the bin entrypoint.
- [ ] Preserve CLI behavior for `curort-cli-agent`.
- [ ] Update package `main`, `module`, `types`, `bin`, and `exports` to reference built outputs.

### 2. SDK Public Types and Facade

#### `src/sdk/types.ts`, `src/sdk/index.ts`

**Status**: NOT_STARTED

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

**Checklist**:

- [ ] Re-export stable normalized domain types, not raw Cursor adapter payloads.
- [ ] Define dependency-injected facade construction.
- [ ] Keep module load side-effect free.
- [ ] Include API review tests that import every public symbol path.

### 3. Domain Facades

#### `src/sdk/facades.ts`

**Status**: NOT_STARTED

```typescript
export interface SessionFacade {
  list(): Promise<readonly CursorSessionRecord[]>;
  get(sessionId: string): Promise<CursorSessionRecord | null>;
  refresh(): Promise<readonly CursorSessionRecord[]>;
}

export interface SearchFacade {
  sessions(options: SessionSearchOptions): Promise<SessionSearchResult>;
  transcripts(options: TranscriptSearchOptions): Promise<TranscriptSearchResult>;
}

export interface BookmarkFacade {
  add(input: CreateBookmarkInput): Promise<BookmarkRecord>;
  list(filter?: BookmarkFilter): Promise<readonly BookmarkRecord[]>;
  show(id: string): Promise<BookmarkRecord | null>;
  delete(id: string): Promise<boolean>;
  search(query: string, options?: BookmarkSearchOptions): Promise<BookmarkSearchResult>;
}
```

**Checklist**:

- [ ] Wrap existing repositories and managers without duplicating business logic.
- [ ] Preserve local-only Cursor transcript and state boundaries.
- [ ] Return existing domain result contracts unchanged.
- [ ] Gate incomplete queue/file/server methods on their dependency plans.

### 4. Agent Runner Facade

#### `src/sdk/agent-runner.ts`

**Status**: NOT_STARTED

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

**Checklist**:

- [ ] Start and resume Cursor sessions through `cursor/process-runner` and existing stream normalization.
- [ ] Expose normalized `AgentEvent` stream contracts.
- [ ] Preserve session pending/materialized identity events.
- [ ] Avoid Codex rollout line types in public runner APIs.

### 5. Server Helper Exports

#### `src/sdk/server.ts`

**Status**: NOT_STARTED

```typescript
export interface SdkServerHelpers {
  createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
  createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}
```

**Checklist**:

- [ ] Re-export only contracts produced by `P4-HTTP-RESOURCE-APIS` and `P4-SSE`.
- [ ] Keep helpers transport-neutral where possible.
- [ ] Ensure server helper outputs use the same normalized facade types as direct SDK calls.
- [ ] Add explicit compile-time blockers or TODOs if dependency contracts are absent.

### 6. Testing Mocks

#### `src/sdk/testing.ts`

**Status**: NOT_STARTED

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

**Checklist**:

- [ ] Provide deterministic mock runner and running session helpers.
- [ ] Provide in-memory facade mocks for sessions, search, groups, queues, bookmarks, files, and activity.
- [ ] Keep mocks isolated under `./sdk/testing`.
- [ ] Ensure mocks do not read or write Cursor-managed directories.

### 7. Export and Import Tests

#### `src/sdk/*.test.ts`, `scripts/check-package-exports.ts`

**Status**: NOT_STARTED

```typescript
interface PackageExportSmokeCase {
  readonly specifier: string;
  readonly expectedSymbols: readonly string[];
}
```

**Checklist**:

- [ ] Verify root import does not execute the CLI.
- [ ] Verify `./sdk`, `./sdk/testing`, `./server`, and `./types` imports resolve.
- [ ] Verify TypeScript declarations are emitted for public paths.
- [ ] Verify public barrels do not export `src/cursor/*` raw adapter symbols.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Import-safe package entry | `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json` | NOT_STARTED | planned |
| SDK public facade | `src/sdk/types.ts`, `src/sdk/index.ts` | NOT_STARTED | planned |
| Domain facades | `src/sdk/facades.ts` | NOT_STARTED | planned |
| Agent runner facade | `src/sdk/agent-runner.ts` | NOT_STARTED | planned |
| Server helpers | `src/sdk/server.ts` | NOT_STARTED | planned |
| Testing mocks | `src/sdk/testing.ts` | NOT_STARTED | planned |
| Export tests | `src/sdk/*.test.ts`, `scripts/check-package-exports.ts` | NOT_STARTED | planned |

## Work Breakdown

### TASK-001: Split Import-Safe Entry from CLI Startup

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/index.ts`, `src/bin.ts`, `src/main.ts`, `package.json`
**Dependencies**: None

**Description**:
Create an import-safe library entrypoint and move executable startup to a bin-only module.

**Completion Criteria**:

- [ ] Importing package root does not parse CLI argv or set process exit state.
- [ ] CLI executable still invokes `runCli(process.argv)`.
- [ ] Package export metadata points at built library and bin files.

### TASK-002: Define SDK Facade Contracts

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/sdk/types.ts`, `src/sdk/index.ts`
**Dependencies**: P2-SESSION-SEARCH, P2-TRANSCRIPT-SEARCH, P2-BOOKMARKS, P2-ACTIVITY, P3-GROUP-LIFECYCLE

**Description**:
Define stable facade interfaces and re-export accepted normalized domain types.

**Completion Criteria**:

- [ ] `CursorAgentSdk` and options compile under strict TypeScript.
- [ ] Public barrels export normalized session, search, group, bookmark, activity, and agent-event types.
- [ ] Raw Cursor adapter symbols are not exported.

### TASK-003: Implement Domain Facade Factory

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/sdk/facades.ts`, `src/sdk/index.ts`
**Dependencies**: TASK-002

**Description**:
Wire facade methods to existing repositories, managers, stores, and config path options.

**Completion Criteria**:

- [ ] Facade methods call existing business logic rather than duplicating it.
- [ ] Session identity fields are preserved in all returned records.
- [ ] Missing dependency surfaces for queue/files/server remain explicitly gated.

### TASK-004: Implement Cursor Agent Runner Facade

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/sdk/agent-runner.ts`, targeted exports
**Dependencies**: TASK-002, P2-ACTIVITY

**Description**:
Expose start/resume runner contracts over normalized Cursor agent events.

**Completion Criteria**:

- [ ] Runner supports start, resume, messages, completion, cancel, and interrupt.
- [ ] Runner emits normalized `AgentEvent` values.
- [ ] Tests cover pending and materialized session identity events.

### TASK-005: Add Server Helper Export Shell

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/sdk/server.ts`, package `./server` export
**Dependencies**: TASK-002, P4-HTTP-RESOURCE-APIS, P4-SSE

**Description**:
Expose server helper contracts only after HTTP resource and SSE dependency contracts exist.

**Completion Criteria**:

- [ ] `./server` resolves and exports normalized helper contracts.
- [ ] Helpers use SDK facade contracts as their domain boundary.
- [ ] Missing dependency contracts are represented by compile-time TODOs, not runtime guesses.

### TASK-006: Add Testing Mocks

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/sdk/testing.ts`, `src/sdk/testing.test.ts`
**Dependencies**: TASK-002, TASK-004

**Description**:
Provide deterministic in-memory SDK, runner, event stream, and manager mocks.

**Completion Criteria**:

- [ ] `./sdk/testing` exports mock SDK and runner helpers.
- [ ] Mocks are deterministic and do not touch Cursor-managed directories.
- [ ] Mock behavior is covered by focused tests.

### TASK-007: Verify Package Exports

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `scripts/check-package-exports.ts`, `src/sdk/*.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Description**:
Add export smoke tests and declaration checks for public package paths.

**Completion Criteria**:
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes or unrelated failures are documented.
- [ ] Import smoke checks prove root, SDK, testing, server, and types paths resolve.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Public SDK base exports | `P2-SESSION-SEARCH`, `P2-TRANSCRIPT-SEARCH`, `P2-BOOKMARKS`, `P2-ACTIVITY`, `P3-GROUP-LIFECYCLE` | READY |
| Queue facade | `P3-QUEUE-LIFECYCLE` | BLOCKED |
| Files facade | `P3-FILE-INTELLIGENCE` | BLOCKED |
| Server helper facade | `P4-HTTP-RESOURCE-APIS`, `P4-SSE` | BLOCKED |
| Testing mocks | SDK facade and runner contracts | BLOCKED |

## Completion Criteria

- [ ] Root package import is side-effect safe.
- [ ] SDK exports cover sessions, search, groups, queues, bookmarks, files, activity, runner events, server helpers, and testing mocks.
- [ ] Package subpath exports are documented in `package.json`.
- [ ] No raw Cursor adapter payload shapes become public SDK contracts.
- [ ] Verification commands pass or unrelated failures are documented.
## Verification

## Progress Log

### Session: 2026-05-06 12:45

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation blocked by dependency completion for queue lifecycle, file intelligence, HTTP resource APIs, and SSE contracts.
**Notes**: Planning only; no TypeScript runtime code implemented in this branch.
