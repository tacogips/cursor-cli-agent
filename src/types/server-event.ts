import type { AgentEvent, NormalizedMessage } from "./agent-event";
import type { SessionActivity } from "./activity";
import type { GroupProgressSnapshot } from "./group";
import type { QueueProgressSnapshot } from "./queue";
import type { CursorSessionRecord } from "./session-record";

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

export interface SessionTranscriptEventPayload {
  readonly session: CursorSessionRecord;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly message: NormalizedMessage;
}

export interface SessionPendingEventPayload {
  readonly session: CursorSessionRecord;
}

export interface SessionMaterializedEventPayload {
  readonly previousSession: CursorSessionRecord;
  readonly session: CursorSessionRecord;
}

export interface ActivityUpdatedEventPayload {
  readonly sessionId?: string;
  readonly activities: readonly SessionActivity[];
  readonly provenance: "derived";
}

export interface ServerHeartbeatPayload {
  readonly now: string;
}

export type ServerEventPayloadByName = {
  readonly "session.pending": SessionPendingEventPayload;
  readonly "session.materialized": SessionMaterializedEventPayload;
  readonly "session.user_message": SessionTranscriptEventPayload;
  readonly "session.assistant_message": SessionTranscriptEventPayload;
  readonly "session.thinking": AgentEvent;
  readonly "session.completed": AgentEvent;
  readonly "session.error": AgentEvent;
  readonly "activity.updated": ActivityUpdatedEventPayload;
  readonly "group.progress": GroupProgressSnapshot;
  readonly "queue.progress": QueueProgressSnapshot;
  readonly "server.heartbeat": ServerHeartbeatPayload;
};

let eventSequence = 0;

export function createServerEventEnvelope<TName extends ServerEventName>(
  event: TName,
  payload: ServerEventPayloadByName[TName],
  options: {
    readonly id?: string;
    readonly emittedAt?: string;
  } = {},
): ServerEventEnvelope<TName, ServerEventPayloadByName[TName]> {
  const emittedAt = options.emittedAt ?? new Date().toISOString();
  eventSequence = (eventSequence + 1) % Number.MAX_SAFE_INTEGER;
  return {
    id:
      options.id ?? `${Date.now().toString(36)}-${eventSequence.toString(36)}`,
    event,
    emittedAt,
    payload,
  };
}

export function normalizeServerEventStreamOptions(
  options: Partial<ServerEventStreamOptions> = {},
): ServerEventStreamOptions {
  return {
    replay: options.replay ?? "latest",
    ...(options.lastEventId !== undefined
      ? { lastEventId: options.lastEventId }
      : {}),
    heartbeatMs: options.heartbeatMs ?? 15_000,
    ...(options.startOffset !== undefined
      ? { startOffset: options.startOffset }
      : {}),
  };
}
