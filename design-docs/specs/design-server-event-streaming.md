# Server Event Streaming

This document defines feature `P4-SSE` for live server-sent event streaming in `cursor-cli-agent`.

## Overview

The SSE layer exposes normalized live events from the future HTTP server without leaking raw Cursor transcript or `cursor-agent --output-format stream-json` payloads. It should support session watch, activity updates, group progress, queue progress, heartbeat delivery, and graceful disconnect cleanup.

This feature depends on `P4-HTTP-SERVER` for server routing and request lifecycle primitives, and on `P2-ACTIVITY` for derived activity snapshots. It is a server transport design only; it does not implement daemon supervision, auth policy, or new Cursor runtime behavior.

Included:

- reusable SSE connection writer and event envelope
- shared event broker for fan-out and replay-latest behavior
- session watch stream from transcript append and live process events
- activity update stream backed by `ActivityManager`
- group progress stream backed by group store plus activity derivation
- queue progress stream backed by queue store, run observations, and activity where session ids exist
- graceful client disconnect handling through `AbortSignal` and resource cleanup

Excluded:

- HTTP server bootstrap details owned by `P4-HTTP-SERVER`
- bearer-token permission checks owned by `P4-AUTH`
- daemon lifecycle and background supervision owned by `P4-DAEMON`
- direct mutation of Cursor transcript files, Cursor `ai-tracking` DBs, or Cursor-managed skill state
- GraphQL compatibility; codex-agent GraphQL subscriptions are only behavioral references

## Event Contract

SSE responses use `text/event-stream` and emit one JSON payload per event. Every event must use a stable envelope:

```typescript
interface ServerEventEnvelope<TType extends string, TPayload> {
  readonly id: string;
  readonly event: TType;
  readonly emittedAt: string;
  readonly payload: TPayload;
}
```

Event ids are repository-owned monotonic or timestamp-sortable strings. Clients may reconnect with `Last-Event-ID`; the first implementation only needs bounded latest-event replay per topic, not durable historical replay.

Required event names:

- `session.pending`
- `session.materialized`
- `session.user_message`
- `session.assistant_message`
- `session.thinking`
- `session.completed`
- `session.error`
- `activity.updated`
- `group.progress`
- `queue.progress`
- `server.heartbeat`

The payloads should reuse existing normalized models where possible: `AgentEvent`, `SessionActivity`, `GroupProgressSnapshot`, `QueueProgressSnapshot`, and server-local error payloads.

## Stream Topics

### Session Watch

Session watch streams resolve `recordId`, `localSessionId`, or `cursorChatId` through `SessionIndexRepository`. For transcript-backed sessions, the stream emits current transcript rows from a requested `startOffset` or from the tail, then follows appended transcript rows. For pending chat-only sessions, it first emits `session.pending`, waits for transcript materialization through index refresh, emits `session.materialized`, then follows the transcript.

Live process events should be merged only for wrapper-started processes that already produce normalized `AgentEvent` values. The stream must not parse raw Cursor stream JSON outside Cursor adapter modules.

### Activity Updates

Activity streams emit `activity.updated` snapshots from `ActivityManager` for one session or all known sessions. Because activity is derived, each payload must retain `provenance: "derived"` and signal details from `P2-ACTIVITY`.

### Group Progress

Group progress streams emit `group.progress` snapshots using the same derivation as `group watch`: persisted group latest-run state plus activity lookup. A polling fallback is acceptable for the first server implementation, but the broker should allow future direct publication from group run code paths.

### Queue Progress

Queue progress streams emit `queue.progress` snapshots from queue persistence and run observations. Existing queue records do not yet have the same latest-run model as groups, so the first implementation may expose queued item counts and best-effort active item/session activity. If a later queue lifecycle plan adds canonical run records, SSE should map that model without changing the envelope.

## Cursor-Specific Boundaries

Cursor transcripts live under `~/.cursor/projects/<workspace-slug>/agent-transcripts/*.jsonl`; they are not Codex rollout files. Tailers must use `src/cursor/transcript-reader.ts` parsing and byte offsets rather than copying Codex rollout parsing.

Cursor live events come from `src/cursor/stream-normalizer.ts`. Server streams consume normalized `AgentEvent` values and local domain snapshots only. Domain, persistence, and server modules must not depend on raw Cursor CLI payload shapes.

Graceful disconnect is required:

- each stream receives a request-scoped `AbortSignal`
- transcript tailers stop polling or close file watchers when aborted
- event broker subscriptions unsubscribe on abort
- heartbeat timers are cleared on abort
- stream generators complete without unhandled promise rejections

## Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/codex-agent`.

Relevant files:

- `/g/gits/tacogips/codex-agent/src/rollout/watcher.ts`
- `/g/gits/tacogips/codex-agent/src/rollout/watcher.test.ts`
- `/g/gits/tacogips/codex-agent/src/graphql/index.ts`
- `/g/gits/tacogips/codex-agent/src/graphql/index.test.ts`
- `/g/gits/tacogips/codex-agent/src/server/sse.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/events.ts`
- `/g/gits/tacogips/codex-agent/src/session/index.ts`
- `/g/gits/tacogips/codex-agent/src/session/sqlite.ts`
- `/g/gits/tacogips/codex-agent/src/types/session.ts`

Reference behavior to preserve:

- incremental append reading starts from the current file size by default and accepts explicit start offsets
- duplicate watches on the same file are avoided
- watcher cleanup closes file and directory watchers
- subscription streams queue events, wake pending iterators, propagate errors, and stop cleanly when the consumer returns
- tests cover append streaming, start-offset replay, duplicate suppression, and cleanup

Intentional Cursor divergences:

- Codex `RolloutWatcher` watches `rollout-*.jsonl`; this project tails Cursor transcript JSONL and separately consumes normalized process stream events.
- Codex GraphQL subscriptions are not copied; this project exposes HTTP SSE endpoints under the server core.
- Codex streams rollout line payloads; this project emits stable `ServerEventEnvelope` objects over normalized domain events.
- Cursor pending chat-only sessions require materialization events before transcript tailing can begin.

## Endpoint Shape

Final paths belong to `P4-HTTP-SERVER`, but this feature expects these route intents:

- `GET /api/events/sessions/:id`
- `GET /api/events/activity`
- `GET /api/events/activity/:id`
- `GET /api/events/groups/:name`
- `GET /api/events/queues/:name`

Common query parameters:

- `startOffset`: non-negative byte offset for transcript-backed session streams
- `replay`: `latest` or `none`, default `latest`
- `heartbeatMs`: positive integer, default chosen by server core

Validation errors should use normal HTTP JSON error responses before the SSE stream starts. Errors after streaming starts should be emitted as typed SSE error events when possible and then close the stream.

## Dependencies

| Feature | Required For | Status |
|---------|--------------|--------|
| `P4-HTTP-SERVER` | route registration, response writer, request abort signal | Required |
| `P2-ACTIVITY` | activity and progress snapshots | Completed in local plan history |
| Group lifecycle model | group progress snapshots | Available in active local plan/code state |
| Queue run observations | queue progress fidelity | Partial; use best-effort first pass |

## Verification

Planned automated checks:

- `bun test src/server/event-broker.test.ts`
- `bun test src/server/sse.test.ts`
- `bun test src/server/event-streams.test.ts`
- `bun test src/server/routes/events.test.ts`
- `bun test src/cursor/transcript-tail.test.ts`
- `task typecheck`
- `task test`
- `task ci`

Planned manual smoke checks after server core exists:

```bash
bun run src/main.ts server start --host 127.0.0.1 --port 0
curl -N http://127.0.0.1:<port>/api/events/activity
curl -N http://127.0.0.1:<port>/api/events/sessions/<session-id>
```

## Open Questions

- Should queue progress wait for a dedicated queue lifecycle/run-record feature before exposing item-level SSE fields beyond counts and current activity?
- What bounded replay limit should the broker keep per topic once `Last-Event-ID` is supported beyond latest replay?
- Should heartbeat cadence be fixed by server core or configurable per request within a bounded range?

## References

- `design-docs/specs/design-activity.md`
- `design-docs/specs/design-group-lifecycle.md`
- `design-docs/specs/command.md#server-commands`
- `design-docs/specs/design-codex-agent-parity-gap.md#phase-4-server-auth-daemon-and-public-sdk`
- `impl-plans/active/server-event-streaming.md`
