# Server Event Streaming Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-server-event-streaming.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-server-event-streaming.md`

### Summary

Implement feature `P4-SSE`: reusable server-sent event infrastructure and live streams for session watch, activity updates, group progress, queue progress, and graceful client disconnect handling.

### Scope

**Included**: SSE envelope types, event broker, SSE response writer, Cursor transcript tailer, session/activity/group/queue stream services, server route adapters, and tests.

**Excluded**: HTTP server bootstrap owned by `P4-HTTP-SERVER-CORE`, bearer auth owned by `P4-AUTH`, daemon supervision owned by `P4-DAEMON`, GraphQL compatibility, and runtime implementation in this design-plan branch.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

- `/Users/taco/gits/tacogips/codex-agent/src/rollout/watcher.ts`: append tailing, start offsets, duplicate watch suppression, cleanup.
- `/Users/taco/gits/tacogips/codex-agent/src/rollout/watcher.test.ts`: append, replay, duplicate, and stop behavior tests.
- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.ts`: async iterable subscription queue and consumer-return cleanup.
- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.test.ts`: `session.watch` subscription behavior and `startOffset` coverage.

Intentional divergences:

- Cursor transcript tailing uses `src/cursor/transcript-reader.ts` and byte offsets, not Codex rollout parsing.
- Server routes emit SSE envelopes over normalized domain events, not GraphQL `ExecutionResult` subscriptions.
- Pending Cursor chat sessions emit pending/materialized events before transcript tailing.

---

## Modules

### 1. SSE Event Types

#### `src/types/server-event.ts`

**Status**: NOT_STARTED

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

export interface ServerEventEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly event: ServerEventName;
  readonly emittedAt: string;
  readonly payload: TPayload;
}

export interface ServerEventStreamOptions {
  readonly replay?: "latest" | "none";
  readonly lastEventId?: string;
  readonly heartbeatMs?: number;
}
```

**Checklist**:

- [ ] Define strict event names and envelope type.
- [ ] Include stream option types for route adapters.
- [ ] Keep payloads domain-normalized and Cursor-agnostic.

### 2. Event Broker and SSE Writer

#### `src/server/event-broker.ts`
#### `src/server/sse.ts`

**Status**: NOT_STARTED

```typescript
export interface EventSubscription<TPayload = unknown> {
  readonly events: AsyncIterable<ServerEventEnvelope<TPayload>>;
  unsubscribe(): void;
}

export interface EventBroker {
  publish(topic: string, event: ServerEventEnvelope): void;
  subscribe(
    topic: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): EventSubscription;
}

export interface SseResponseWriter {
  write(event: ServerEventEnvelope): Promise<void>;
  close(): Promise<void>;
}
```

**Checklist**:

- [ ] Support fan-out to multiple subscribers per topic.
- [ ] Store bounded latest event per topic for `replay: "latest"`.
- [ ] Unsubscribe and clear pending waiters on abort.
- [ ] Format compliant `id`, `event`, and JSON `data` fields.
- [ ] Emit heartbeat events and clear timers on disconnect.

### 3. Cursor Transcript Tailer

#### `src/cursor/transcript-tail.ts`
#### `src/cursor/transcript-tail.test.ts`

**Status**: NOT_STARTED

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

export function tailTranscript(
  transcriptPath: string,
  options: TranscriptTailOptions,
): AsyncIterable<TranscriptTailEvent>;
```

**Checklist**:

- [ ] Default to tailing from current file size.
- [ ] Replay from non-negative `startOffset` when provided.
- [ ] Parse lines through `parseTranscriptLine`.
- [ ] Stop polling and resolve iterators when `AbortSignal` fires.
- [ ] Tests cover append, start offset, invalid lines, and abort cleanup.

### 4. Stream Services

#### `src/server/event-streams.ts`
#### `src/server/event-streams.test.ts`

**Status**: NOT_STARTED

```typescript
export interface EventStreamDependencies {
  readonly sessions: SessionIndexRepository;
  readonly activity: ActivityManager;
  readonly broker: EventBroker;
  readonly now: () => string;
}

export interface EventStreamService {
  watchSession(id: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope>;
  watchActivity(id: string | undefined, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope>;
  watchGroup(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope>;
  watchQueue(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope>;
}
```

**Checklist**:

- [ ] Resolve sessions by record id, local session id, or Cursor chat id.
- [ ] Emit pending and materialized events for chat-only sessions.
- [ ] Convert transcript rows to normalized session event envelopes.
- [ ] Emit activity snapshots with `provenance: "derived"`.
- [ ] Emit group snapshots using group progress derivation.
- [ ] Emit queue snapshots with current queue counts and best-effort active session activity.

### 5. Server Route Adapters

#### `src/server/routes/events.ts`
#### `src/server/routes/events.test.ts`

**Status**: NOT_STARTED

```typescript
export interface EventRoutesDependencies {
  readonly streams: EventStreamService;
}

export function registerEventRoutes(
  server: HttpServerRouter,
  dependencies: EventRoutesDependencies,
): void;
```

**Checklist**:

- [ ] Register `/api/events/sessions/:id`.
- [ ] Register `/api/events/activity` and `/api/events/activity/:id`.
- [ ] Register `/api/events/groups/:name`.
- [ ] Register `/api/events/queues/:name`.
- [ ] Validate `startOffset`, `replay`, and `heartbeatMs` before streaming starts.
- [ ] Wire request abort signals into stream services and writer cleanup.

### 6. Verification and Documentation Alignment

#### `src/server/*.test.ts`
#### `src/cursor/transcript-tail.test.ts`

**Status**: NOT_STARTED

```typescript
describe("server event streaming", () => {
  // broker, writer, route, tailer, disconnect, and stream service coverage
});
```

**Checklist**:

- [ ] Run focused SSE and transcript-tail tests.
- [ ] Run `task typecheck`.
- [ ] Run `task test`.
- [ ] Run `task ci`.
- [ ] Smoke session and activity streams with `curl -N` after server core exists.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| SSE event types | `src/types/server-event.ts` | NOT_STARTED | Typecheck |
| Event broker and writer | `src/server/event-broker.ts`, `src/server/sse.ts` | NOT_STARTED | `src/server/event-broker.test.ts`, `src/server/sse.test.ts` |
| Transcript tailer | `src/cursor/transcript-tail.ts` | NOT_STARTED | `src/cursor/transcript-tail.test.ts` |
| Stream services | `src/server/event-streams.ts` | NOT_STARTED | `src/server/event-streams.test.ts` |
| Route adapters | `src/server/routes/events.ts` | NOT_STARTED | `src/server/routes/events.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| `P4-SSE` | `P4-HTTP-SERVER-CORE` | Required |
| `P4-SSE` | `P2-ACTIVITY` | Required |
| Session SSE | `SessionIndexRepository`, transcript reader, stream normalizer | Available |
| Group progress SSE | Group lifecycle/progress model | Available in active local plan/code state |
| Queue progress SSE | Queue store and run observations | Partial fidelity until queue lifecycle matures |

## Work Breakdown

### TASK-001: SSE Event Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/server-event.ts`
**Dependencies**: None

**Description**:
Define the shared event envelope, event names, and stream option types.

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Event names match `design-server-event-streaming.md`.
- [ ] No raw Cursor payload types are exported.

### TASK-002: Event Broker and SSE Writer

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/server/event-broker.ts`, `src/server/sse.ts`, related tests
**Dependencies**: TASK-001

**Description**:
Implement reusable fan-out, latest replay, SSE formatting, heartbeats, and abort cleanup.

**Completion Criteria**:

- [ ] Multiple subscribers receive published events.
- [ ] `replay: "latest"` emits the latest topic event once.
- [ ] Aborted subscriptions release waiters and timers.
- [ ] SSE output contains compliant `id`, `event`, and `data` fields.

### TASK-003: Cursor Transcript Tailer

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/cursor/transcript-tail.ts`, `src/cursor/transcript-tail.test.ts`
**Dependencies**: None

**Description**:
Tail Cursor transcript JSONL by byte offset and emit parsed transcript rows.

**Completion Criteria**:

- [ ] Starts at file size by default and honors explicit `startOffset`.
- [ ] Uses `parseTranscriptLine` for every emitted row.
- [ ] Ignores invalid lines without closing the stream.
- [ ] Abort stops polling promptly.

### TASK-004: Stream Services

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/server/event-streams.ts`, `src/server/event-streams.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Build session, activity, group, and queue event stream services over local repositories and normalized domain models.

**Completion Criteria**:

- [ ] Session streams handle transcript-backed and pending chat-only records.
- [ ] Activity streams emit derived snapshots.
- [ ] Group streams emit activity-derived progress snapshots.
- [ ] Queue streams emit best-effort progress snapshots.
- [ ] Stream generators finish cleanly on client disconnect.

### TASK-005: Server Route Adapters

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/server/routes/events.ts`, `src/server/routes/events.test.ts`
**Dependencies**: TASK-002, TASK-004, `P4-HTTP-SERVER-CORE`

**Description**:
Expose stream services through HTTP server event endpoints.

**Completion Criteria**:

- [ ] Routes match the design document endpoint intents.
- [ ] Query parameters are validated before stream start.
- [ ] HTTP request abort closes service streams and writers.
- [ ] Not-found and validation errors use server core error conventions.

### TASK-006: End-to-End Verification

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: Verification notes in this plan
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run focused and full verification after implementation, including disconnect behavior and manual curl smoke checks.

**Completion Criteria**:

- [ ] `bun test src/server/event-broker.test.ts src/server/sse.test.ts src/server/event-streams.test.ts src/server/routes/events.test.ts src/cursor/transcript-tail.test.ts` passes.
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes.
- [ ] Manual `curl -N` smoke checks are recorded.

## Completion Criteria

- [ ] SSE event envelope and writer are implemented.
- [ ] Session watch stream supports append tailing, start offsets, pending materialization, and disconnect cleanup.
- [ ] Activity, group, and queue streams emit normalized snapshot events.
- [ ] Route adapters are wired into server core without duplicating server bootstrap.
- [ ] Tests cover replay, fan-out, heartbeat, abort, append, and route validation behavior.
- [ ] Type checking, tests, CI, and manual smoke verification pass.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation plan authored for `P4-SSE`.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation waits on `P4-HTTP-SERVER-CORE`.
**Notes**: No upstream review payloads or mailbox feedback were attached to this execution. This plan intentionally does not update `impl-plans/PROGRESS.json` or `impl-plans/README.md` because the workflow node assigned write ownership only to `design-docs/specs/design-server-event-streaming.md` and `impl-plans/active/server-event-streaming.md`.

## Addressed Review Feedback

- No latest review findings were attached to this node execution.
- No revision flags were provided.

## Related Plans

- **Depends On**: `P4-HTTP-SERVER-CORE`, `P2-ACTIVITY`.
- **Scope Link**: `design-docs/specs/design-server-event-streaming.md`.
