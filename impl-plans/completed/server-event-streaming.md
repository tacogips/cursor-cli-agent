# Server Event Streaming Implementation Plan

**Status**: Completed
**Workflow Mode**: `issue-resolution`
**Issue Reference**: `parity-global-design-plan-implement-loop#P4-SSE`
**Design Reference**: `design-docs/specs/design-server-event-streaming.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-server-event-streaming.md`

### Summary

Implement backlog slice `P4-SSE`: live server-sent event streaming for sessions, activity, group progress, and queue progress over the existing server core, using stable `ServerEventEnvelope` objects and normalized Cursor/domain models.

### Scope

**Included**: SSE envelope types, reusable event broker, SSE response writer, Cursor transcript tailer, session/activity/group/queue stream services, server route adapters, and focused tests.

**Excluded**: HTTP server bootstrap owned by `P4-HTTP-SERVER`, bearer-token policy owned by `P4-AUTH`, daemon supervision owned by `P4-DAEMON`, public SDK work, GraphQL compatibility, durable event history beyond latest replay, and raw Cursor payload exposure outside Cursor adapters.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/codex-agent`.

- `/g/gits/tacogips/codex-agent/src/rollout/watcher.ts`: append tailing, start offsets, duplicate watch suppression, cleanup.
- `/g/gits/tacogips/codex-agent/src/rollout/watcher.test.ts`: append, replay, duplicate, and stop behavior tests.
- `/g/gits/tacogips/codex-agent/src/graphql/index.ts`: async iterable subscription queue, error propagation, consumer-return cleanup.
- `/g/gits/tacogips/codex-agent/src/graphql/index.test.ts`: subscription behavior and `startOffset` coverage.
- `/g/gits/tacogips/codex-agent/src/server/sse.ts`: SSE formatting and heartbeat reference.
- `/g/gits/tacogips/codex-agent/src/sdk/events.ts`: public event naming reference.
- `/g/gits/tacogips/codex-agent/src/session/index.ts`, `/g/gits/tacogips/codex-agent/src/session/sqlite.ts`, `/g/gits/tacogips/codex-agent/src/types/session.ts`: session shape and persistence behavior references.

Intentional divergences:

- Cursor transcript tailing uses `src/cursor/transcript-reader.ts` byte offsets, not Codex rollout parsing.
- Cursor live process events remain normalized by `src/cursor/stream-normalizer.ts`; server modules do not parse raw `stream-json`.
- HTTP SSE endpoints replace Codex GraphQL subscriptions for this project.
- Pending Cursor chat-only sessions emit `session.pending` and `session.materialized` before transcript tailing.

---

## Modules

### 1. SSE Event Types

#### `src/types/server-event.ts`

**Status**: COMPLETED

```typescript
export type ServerEventName =
  | "session.pending"
  | "session.materialized"
  | "session.user_message"
  | "session.assistant_message"
  | "session.thinking"
  | "session.completed"
  | "session.error"
  | "activity.updated"
  | "group.progress"
  | "queue.progress"
  | "server.heartbeat";

export interface ServerEventEnvelope<TType extends string, TPayload> {
  readonly id: string;
  readonly event: TType;
  readonly emittedAt: string;
  readonly payload: TPayload;
}

export interface ServerEventStreamOptions {
  readonly replay: "latest" | "none";
  readonly lastEventId?: string;
  readonly heartbeatMs: number;
  readonly startOffset?: number;
}
```

**Checklist**:

- [x] Define event names exactly as accepted in the design.
- [x] Define a generic immutable envelope and stream options.
- [x] Export only normalized domain payload contracts; do not export raw Cursor payload shapes.

### 2. Event Broker and SSE Writer

#### `src/server/event-broker.ts`
#### `src/server/sse.ts`

**Status**: COMPLETED

```typescript
export interface EventBroker {
  publish(topic: string, event: ServerEventEnvelope<string, unknown>): void;
  subscribe(topic: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}

export interface SseResponseWriter {
  write(event: ServerEventEnvelope<string, unknown>): Promise<void>;
  close(): Promise<void>;
}
```

**Checklist**:

- [x] Fan out each published topic event to all current subscribers.
- [x] Replay the bounded latest event when `replay` is `latest`.
- [x] Wake pending iterators and unsubscribe on `AbortSignal`.
- [x] Format `id`, `event`, and JSON `data` fields as valid `text/event-stream`.
- [x] Emit `server.heartbeat` and clear heartbeat timers on disconnect.

### 3. Cursor Transcript Tailer

#### `src/cursor/transcript-tail.ts`
#### `src/cursor/transcript-tail.test.ts`

**Status**: COMPLETED

```typescript
export interface TranscriptTailOptions {
  readonly startOffset?: number;
  readonly pollMs?: number;
  readonly signal: AbortSignal;
}

export interface TranscriptTailEvent {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly line: TranscriptLine;
}
```

**Checklist**:

- [x] Start from current file size by default.
- [x] Replay from explicit non-negative `startOffset`.
- [x] Parse each emitted row through `parseTranscriptLine`.
- [x] Ignore malformed appended rows without closing the stream.
- [x] Stop polling and complete iterators promptly on abort.

### 4. Stream Services

#### `src/server/event-streams.ts`
#### `src/server/event-streams.test.ts`

**Status**: COMPLETED

```typescript
export interface EventStreamService {
  watchSession(id: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchActivity(id: string | undefined, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchGroup(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchQueue(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}
```

**Checklist**:

- [x] Resolve sessions by record id, local session id, or Cursor chat id through `SessionIndexRepository`.
- [x] Emit `session.pending` and `session.materialized` for pending chat-only sessions.
- [x] Convert transcript rows to session envelopes while leaving raw `stream-json` parsing behind Cursor adapters; wrapper live event fan-in remains available for future publisher integration without duplicate transcript ownership.
- [x] Emit `activity.updated` snapshots with `provenance: "derived"`.
- [x] Emit `group.progress` from group latest-run state plus activity derivation.
- [x] Emit `queue.progress` with item counts and best-effort active item/session activity.

### 5. Server Route Adapters

#### `src/server/routes/events.ts`
#### `src/server/routes/events.test.ts`

**Status**: COMPLETED

```typescript
export interface EventRouteDependencies {
  readonly streams: EventStreamService;
}

export function handleEventRoute(request: Request, dependencies: EventRouteDependencies): Promise<Response | undefined>;
```

**Checklist**:

- [x] Register `GET /api/events/sessions/:id`.
- [x] Register `GET /api/events/activity` and `GET /api/events/activity/:id`.
- [x] Register `GET /api/events/groups/:name`.
- [x] Register `GET /api/events/queues/:name`.
- [x] Validate `startOffset`, `replay`, and `heartbeatMs` before stream headers are sent.
- [x] Wire request abort signals into stream services and writer cleanup.
- [x] Integrate through `src/server/routes.ts` request dispatch without introducing an unrelated router abstraction.

### 6. Verification and Handoff Notes

#### `impl-plans/completed/server-event-streaming.md`

**Status**: COMPLETED

```typescript
interface VerificationRecord {
  readonly command: string;
  readonly result: "pass" | "fail" | "not_run";
  readonly notes?: string;
}
```

**Checklist**:

- [x] Record focused test results in the progress log.
- [x] Record full `task ci` result in the progress log.
- [x] Record README and user-facing skill refresh decisions for the later workflow docs step.
- [x] Record manual `curl -N` smoke check result when server core can start locally.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| SSE event types | `src/types/server-event.ts` | COMPLETED | `task typecheck` |
| Event broker and writer | `src/server/event-broker.ts`, `src/server/sse.ts` | COMPLETED | `src/server/event-broker.test.ts`, `src/server/sse.test.ts` |
| Transcript tailer | `src/cursor/transcript-tail.ts` | COMPLETED | `src/cursor/transcript-tail.test.ts` |
| Stream services | `src/server/event-streams.ts` | COMPLETED | `src/server/event-streams.test.ts` |
| Route adapters | `src/server/routes/events.ts` | COMPLETED | `src/server/routes/events.test.ts` |
| Verification notes | `impl-plans/completed/server-event-streaming.md` | COMPLETED | Progress log |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| `P4-SSE` | `P4-HTTP-SERVER` route registration, streaming response, request abort signal | Ready per runtime review context |
| `P4-SSE` | `P2-ACTIVITY` snapshots and provenance | Ready per runtime review context |
| Session SSE | `SessionIndexRepository`, `src/cursor/transcript-reader.ts`, `src/cursor/stream-normalizer.ts` | Available |
| Group progress SSE | `src/group/progress.ts`, `src/persistence/groups-store.ts`, activity lookup | Available |
| Queue progress SSE | `src/queue/progress.ts`, `src/persistence/queues-store.ts`, run observations | Partial; best-effort first pass accepted by design |

## Work Breakdown

### TASK-001: SSE Event Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/server-event.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Event names match `design-docs/specs/design-server-event-streaming.md#event-contract`.
- [x] Envelope ids are repository-owned monotonic or timestamp-sortable strings.
- [x] Type exports stay Cursor-agnostic.

### TASK-002: Event Broker and SSE Writer

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/event-broker.ts`, `src/server/sse.ts`, `src/server/event-broker.test.ts`, `src/server/sse.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Multiple subscribers receive each published topic event.
- [x] `replay: "latest"` emits the latest topic event once; `replay: "none"` does not.
- [x] Pending iterators complete and subscriber state is removed on abort or consumer return.
- [x] SSE writer output includes valid headers and compliant `id`, `event`, `data` frames.
- [x] Heartbeat timer is cancelled during disconnect cleanup.

### TASK-003: Cursor Transcript Tailer

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/cursor/transcript-tail.ts`, `src/cursor/transcript-tail.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Default tail starts from current file size.
- [x] Explicit `startOffset` replays appended transcript rows from that byte offset.
- [x] Tailer uses `parseTranscriptLine` and returns byte offsets for subsequent reconnects.
- [x] Abort stops polling without unhandled promise rejections.

### TASK-004: Stream Services

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/event-streams.ts`, `src/server/event-streams.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [x] Session streams support transcript-backed sessions, pending chat-only sessions, materialization, start offsets, and disconnect cleanup.
- [x] Activity streams emit single-session and all-session `activity.updated` snapshots.
- [x] Group streams emit `group.progress` snapshots from local group state plus activity derivation.
- [x] Queue streams emit `queue.progress` counts and best-effort active session activity without requiring a new lifecycle model.
- [x] Tests cover transcript-source ownership; live wrapper process event fan-in remains a future publisher integration point.

### TASK-005: Server Route Adapters

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/routes/events.ts`, `src/server/routes/events.test.ts`, route registration updates in existing server modules if required
**Dependencies**: TASK-002, TASK-004, `P4-HTTP-SERVER`

**Completion Criteria**:

- [x] Endpoint paths match the accepted design.
- [x] Invalid query parameters return normal HTTP JSON errors before SSE streaming begins.
- [x] Request-scoped abort signals reach stream services and writer cleanup.
- [x] Not-found session, group, or queue requests use existing server error conventions.
- [x] Route integration follows the existing `src/server/routes.ts` dispatcher shape.

### TASK-006: End-to-End Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: Progress-log verification notes in this plan
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] `bun test src/server/event-broker.test.ts src/server/sse.test.ts src/server/event-streams.test.ts src/server/routes/events.test.ts src/cursor/transcript-tail.test.ts` passes.
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.
- [x] README/user-facing skill refresh decisions are recorded for the post-implementation docs node.
- [x] Manual `curl -N` checks for activity and session streams are recorded when local server startup is available.

## Parallelization Notes

- TASK-001 and TASK-003 can run in parallel because their write scopes are disjoint.
- TASK-002 depends on TASK-001.
- TASK-004 depends on TASK-001, TASK-002, and TASK-003.
- TASK-005 depends on TASK-002, TASK-004, and the existing `P4-HTTP-SERVER` route conventions.
- TASK-006 runs after implementation tasks.

## Verification

Focused automated commands:

- `bun test src/server/event-broker.test.ts`
- `bun test src/server/sse.test.ts`
- `bun test src/server/event-streams.test.ts`
- `bun test src/server/routes/events.test.ts`
- `bun test src/cursor/transcript-tail.test.ts`
- `bun test src/server/event-broker.test.ts src/server/sse.test.ts src/server/event-streams.test.ts src/server/routes/events.test.ts src/cursor/transcript-tail.test.ts`

Full verification commands:

- `task typecheck`
- `task test`
- `task ci`

Manual smoke commands after server core can start:

```bash
bun run src/main.ts server start --host 127.0.0.1 --port 0
curl -N http://127.0.0.1:<port>/api/events/activity
curl -N http://127.0.0.1:<port>/api/events/sessions/<session-id>
```

## Completion Criteria

- [x] SSE event envelope and writer are implemented.
- [x] Event broker supports fan-out, latest replay, heartbeat, and abort cleanup.
- [x] Session stream supports append tailing, start offsets, pending materialization, and disconnect cleanup.
- [x] Activity, group, and queue streams emit normalized snapshot events.
- [x] Route adapters are wired into server core without duplicating server bootstrap.
- [x] Documentation refresh decisions are recorded for the workflow docs step.
- [x] Tests cover replay, fan-out, heartbeat, abort, append, route validation, and transcript-source ownership.
- [x] Type checking, focused tests, full tests, CI, and manual smoke verification are recorded.

## Progress Log

### Session: 2026-05-07 Step 6 Revision After Step 7 Last-Event-ID Review

**Tasks Completed**: Addressed the latest Step 7 mid finding for `parity-global-design-plan-implement-loop#P4-SSE`.
**Files Changed**: `src/server/routes/events.ts`, `src/server/routes/events.test.ts`, `impl-plans/completed/server-event-streaming.md`.
**Verification**:

- `bun run format`: pass.
- `bun run typecheck`: pass.
- `bun test src/server/routes/events.test.ts src/server/event-streams.test.ts src/cursor/transcript-tail.test.ts src/server/event-broker.test.ts src/server/sse.test.ts`: pass, 18 tests.
- `task ci`: pass, format check, typecheck, 130 tests, and build.
- Manual smoke remains blocked by local runtime listen failure from Step 6: `Failed to listen at 127.0.0.1`.

**Addressed Step 7 Findings**:

- `src/server/routes/events.ts`: event option parsing now prefers the standard SSE `Last-Event-ID` request header and keeps the existing `lastEventId` query parameter as a fallback.
- `src/server/routes/events.test.ts`: added route coverage proving the `Last-Event-ID` header is passed to stream options ahead of the query fallback.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review

**Tasks Completed**: Addressed all Step 7 mid findings for `parity-global-design-plan-implement-loop#P4-SSE`.
**Files Changed**: `src/server/event-streams.ts`, `src/cursor/transcript-tail.ts`, `src/server/event-streams.test.ts`, `impl-plans/completed/server-event-streaming.md`.
**Verification**:

- `bun run format`: pass.
- `bun run typecheck`: pass.
- `bun test src/server/event-streams.test.ts src/cursor/transcript-tail.test.ts src/server/event-broker.test.ts src/server/sse.test.ts src/server/routes/events.test.ts`: pass, 17 tests.
- `task ci`: pass, format check, typecheck, 129 tests, and build.
- Manual smoke remained blocked by local runtime listen failure from Step 6: `Failed to listen at 127.0.0.1`.

**Addressed Step 7 Findings**:

- `src/server/event-streams.ts`: fixed per-poll `AbortSignal` listener cleanup and wired `EventBroker` into production stream topics with shared topic publishers, latest replay, and `lastEventId` filtering.
- `src/cursor/transcript-tail.ts`: fixed per-poll `AbortSignal` listener cleanup in transcript tail polling.
- `src/server/event-streams.test.ts`: added broker latest replay and `lastEventId` filtering coverage for stream topics.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: Implemented TASK-001 through TASK-006 for `parity-global-design-plan-implement-loop#P4-SSE`.
**Files Changed**: `src/types/server-event.ts`, `src/server/event-broker.ts`, `src/server/sse.ts`, `src/cursor/transcript-tail.ts`, `src/server/event-streams.ts`, `src/server/routes/events.ts`, `src/server/routes.ts`, `src/server/request.ts`, focused test files under `src/server/` and `src/cursor/`.
**Verification**:

- `bun run format`: pass.
- `bun run typecheck`: pass.
- `bun test src/server/event-broker.test.ts src/server/sse.test.ts src/server/event-streams.test.ts src/server/routes/events.test.ts src/cursor/transcript-tail.test.ts`: pass, 16 tests.
- `task typecheck`: pass.
- `task test`: pass, 128 tests.
- `task ci`: pass, format check, typecheck, tests, and build.
- Manual smoke attempted with `bun run src/main.ts server start --host 127.0.0.1 --port 0 --json` plus `curl -fsS -N --max-time 1 "$url/api/events/activity"`; blocked by local runtime listen failure: `Failed to listen at 127.0.0.1`.

**README/User-Facing Skill Refresh Decision**: Later workflow docs step should mention the new `/api/events/*` SSE endpoints, stable `ServerEventEnvelope` payload, route query parameters (`replay`, `lastEventId`, `startOffset`, `heartbeatMs`), and the manual smoke command. No user-authored skill state was changed in Step 6.
**Review Feedback Addressed**: Step 5 accepted the implementation plan with no high or mid findings; no Step 7 feedback existed in this first Step 6 run.
**Notes**: Live wrapper process `AgentEvent` fan-in is intentionally left as future publisher integration because the current runtime has no shared live process event broker; transcript ownership is explicit to avoid duplicate stream publication.

### Session: 2026-05-07

**Tasks Completed**: Revised the active `P4-SSE` implementation plan after Step 3 accepted `design-docs/specs/design-server-event-streaming.md`.
**Tasks In Progress**: None; implementation remains ready for the next workflow step.
**Blockers**: None reported by runtime review context; `P4-HTTP-SERVER` and `P2-ACTIVITY` are marked ready.
**Notes**: Addressed stale Codex reference-root text, aligned dependencies with accepted design names, made verification commands explicit, and kept the plan scoped to one backlog slice.

## Addressed Review Feedback

- Step 3 design review accepted the design with no high or mid findings.
- Step 5 implementation-plan review accepted the plan with no high or mid findings.
- Step 7 implementation review requested revision for three mid findings; this rerun addressed listener cleanup in `src/server/event-streams.ts` and `src/cursor/transcript-tail.ts`, plus broker-backed production topic replay in `src/server/event-streams.ts`.
- Latest Step 7 implementation review requested standard SSE reconnect support; this rerun addressed `Last-Event-ID` header handling in `src/server/routes/events.ts` with query fallback and route test coverage.
- Plan is archived at the completed implementation-plan path: `impl-plans/completed/server-event-streaming.md`.
- Plan traces implementation tasks to the accepted design and effective Codex reference root `/g/gits/tacogips/codex-agent`.

## Related Plans

- **Depends On**: `P4-HTTP-SERVER`, `P2-ACTIVITY`.
- **Scope Link**: `design-docs/specs/design-server-event-streaming.md`.
