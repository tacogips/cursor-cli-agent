# Public SDK Facade

This document defines the Phase 4 `P4-PUBLIC-SDK` design for stable package exports in `curort-cli-agent`.

## Overview

The public SDK facade exposes repository-owned Cursor session, search, group, queue, bookmark, file, activity, agent-event, server-helper, and testing-mock contracts through stable package entrypoints.

The facade is not a compatibility promise for raw Cursor CLI payloads. It is a typed boundary over this repository's normalized models, adapters, persistence repositories, and local transcript behavior.

Included:

- safe importable package entrypoints that do not execute the CLI
- stable type exports for sessions, transcript search, bookmarks, groups, queues, files, activity, and normalized agent runner events
- thin facade functions and factories over existing managers and repositories
- server helper exports for local HTTP/SSE integration once Phase 4 resource APIs exist
- testing mocks for sessions, runners, streams, repositories, and server event sources
- package `exports` metadata for root, SDK, server helpers, and testing entrypoints

Excluded:

- implementing runtime code in this design branch
- raw Cursor transcript or stream payload exports as public contracts
- remote cloud APIs, GUI automation, or writes to Cursor-managed state
- codex-agent API compatibility aliases unless a later compatibility bridge explicitly adds them

## Source Issue Mapping

- Feature ID: `P4-PUBLIC-SDK`
- Target feature area: public sdk
- Requested behavior: stable package exports for sessions, search, groups, queues, bookmarks, files, activity, agent runner events, server helpers, and testing mocks
- Assigned implementation plan: `impl-plans/active/public-sdk.md`

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/sdk/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/agent-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/mock-session-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/main.ts`
- `/Users/taco/gits/tacogips/codex-agent/package.json`

Reference behavior to preserve:

- one importable SDK barrel that re-exports public types and helpers
- agent runner events available as raw and normalized streams
- session runner abstraction with start, resume, messages, completion, cancel, and interrupt controls
- mock runner utilities for tests
- package export metadata that exposes testing helpers separately

Intentional Cursor divergences:

- Cursor session identity must preserve `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.
- Cursor stream normalization is based on this repository's `AgentEvent` model and `cursor/stream-normalizer`, not Codex rollout lines.
- Activity and files expose explicit provenance because Cursor data is derived from local transcripts, process signals, and `ai-tracking` enrichment.
- Server helpers depend on local Phase 4 HTTP/SSE resource APIs and must not expose raw adapter payloads.
- The package root must be safe to import; CLI process startup belongs only in the executable entrypoint.

## Public Entrypoints

Package exports should be stable and explicit:

```json
{
  ".": "./dist/index.js",
  "./sdk": "./dist/sdk/index.js",
  "./sdk/testing": "./dist/sdk/testing.js",
  "./server": "./dist/sdk/server.js",
  "./types": "./dist/types/index.js"
}
```

Design rules:

1. `.` and `./sdk` are import-safe and must not call `process.exit`, parse CLI argv, spawn Cursor, or write state during module load.
2. The executable entrypoint remains the only place that invokes `runCli(process.argv)`.
3. Type declarations are emitted for every public export path.
4. Internal adapter modules under `src/cursor/` remain private unless a type is explicitly normalized for public use.
5. Testing helpers are exported from `./sdk/testing` so production imports avoid mock-only symbols.

## Facade Shape

The primary facade should be a small dependency-injected object rather than a large stateful singleton:

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

The facade methods should call existing repository, manager, and adapter APIs. They must return normalized records already defined by the local feature designs.

## Exported Domains

### Sessions and Search

Public exports include `CursorSessionRecord`, session identity types, metadata search contracts, transcript search contracts, and session runner controls.

Session lookup must accept any stable repository key and preserve pending `chat_only` states. Transcript search must retain scan-budget and truncation fields so SDK callers can reason about local scan cost.

### Groups and Queues

Group exports include lifecycle records, progress snapshots, and group manager methods. Queue exports include queue records, queued item records, lifecycle methods, and future queue progress records once `P3-QUEUE-LIFECYCLE` lands.

The SDK must not invent server-side queue semantics; queue operations remain local state plus wrapper-started Cursor process behavior.

### Bookmarks

Bookmark exports include target types, create/list/show/delete/search contracts, validation helpers when stable, and manager factories. Message and range bookmarks must continue to require transcript-backed sessions.

### Files

File exports include file intelligence operations, provenance types, list/snapshot/deleted/find/rebuild result contracts, and service facade methods. Snapshot content must remain opt-in.

### Activity

Activity exports include `SessionActivity`, status and signal provenance types, activity list options, and recording helpers used by wrapper-started runs. All returned activity remains `provenance: "derived"`.

### Agent Runner Events

The public runner should expose normalized Cursor agent events and a runner abstraction:

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

Codex-style normalized event names may inform the design, but the exported event payloads should use this repository's Cursor-neutral `AgentEvent` model.

### Server Helpers

Server helpers should be exported only after `P4-HTTP-RESOURCE-APIS` and `P4-SSE` define the concrete contracts. The SDK may then export helper factories such as:

```typescript
export interface SdkServerHelpers {
  createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
  createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}
```

These helpers must share the same normalized facade contracts as direct SDK calls.

### Testing Mocks

Testing exports should include deterministic in-memory mocks:

- mock session index repository
- mock session runner and running session
- mock agent event stream
- mock managers for groups, queues, bookmarks, files, and activity
- mock server helper event source

Mocks must be deterministic under strict TypeScript and must not touch Cursor-managed directories.

## Package and Build Constraints

- Add a library entrypoint separate from the CLI bootstrap.
- Update `package.json` `exports` after the new compiled entrypoints exist.
- Keep Bun and TypeScript strictness unchanged.
- Avoid adding dependencies unless the server-resource or SSE plans already introduced them.
- Keep public exports stable, named, and tree-shakeable; avoid exporting entire internal modules with wildcard barrels when that would expose adapters.

## Dependencies

| Dependency | Reason |
|------------|--------|
| `P2-SESSION-SEARCH` | Provides metadata search contracts and session index behavior. |
| `P2-TRANSCRIPT-SEARCH` | Provides transcript hit contracts for search and bookmark ranges. |
| `P2-BOOKMARKS` | Provides bookmark lifecycle contracts and manager behavior. |
| `P2-ACTIVITY` | Provides derived activity contracts and signal recording helpers. |
| `P3-GROUP-LIFECYCLE` | Provides group lifecycle and progress snapshots. |
| `P3-QUEUE-LIFECYCLE` | Required before queue lifecycle exports can be complete. |
| `P3-FILE-INTELLIGENCE` | Required before files facade exports can be complete. |
| `P4-HTTP-RESOURCE-APIS` | Required before server resource helpers are final. |
| `P4-SSE` | Required before event-stream helper exports are final. |

## Verification

Implementation should be verified with:

```bash
task typecheck
task test
task ci
bun run scripts/check-package-exports.ts
```

Package smoke tests should verify:

```bash
bun -e 'import("curort-cli-agent").then(() => console.log("import ok"))'
bun -e 'import("curort-cli-agent/sdk/testing").then(() => console.log("testing ok"))'
```

The root import smoke test must not execute CLI behavior.

## Risks

- The current package entrypoint is CLI-oriented; SDK implementation must split import-safe library entrypoints from executable startup.
- Public exports can freeze unstable internal shapes too early if adapter types leak.
- Queue, file, server, and SSE contracts may still be in flight; SDK implementation must gate incomplete surfaces behind dependency completion.
- Mock helpers can accidentally diverge from real manager behavior unless tests exercise both through shared contracts.

## Open Questions

- Should the root `.` export equal `./sdk`, or should `./sdk` be the preferred public facade with root kept as a compatibility barrel?
- Should server helpers be exported from `./server` only, or re-exported from `./sdk` after the HTTP/SSE contracts stabilize?
- Should a later `P5-COMPAT-BRIDGE` expose Codex-compatible event names in addition to the Cursor-native SDK events?

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `design-docs/specs/design-session-search.md`
- `design-docs/specs/design-transcript-search.md`
- `design-docs/specs/design-bookmarks.md`
- `design-docs/specs/design-activity.md`
- `design-docs/specs/design-group-lifecycle.md`
- `design-docs/specs/design-file-intelligence.md`
- `impl-plans/active/public-sdk.md`
