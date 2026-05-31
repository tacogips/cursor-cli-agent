import type { AgentEvent, NormalizedMessage } from "./agent-event";
import type { SessionActivity } from "./activity";
import type { GroupProgressSnapshot } from "./group";
import type { QueueProgressSnapshot } from "./queue";
import type { CursorSessionRecord } from "./session-record";
export type ServerEventName = "session.pending" | "session.materialized" | "session.user_message" | "session.assistant_message" | "session.thinking" | "session.completed" | "session.error" | "activity.updated" | "group.progress" | "queue.progress" | "server.heartbeat";
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
export declare function createServerEventEnvelope<TName extends ServerEventName>(event: TName, payload: ServerEventPayloadByName[TName], options?: {
    readonly id?: string;
    readonly emittedAt?: string;
}): ServerEventEnvelope<TName, ServerEventPayloadByName[TName]>;
export declare function normalizeServerEventStreamOptions(options?: Partial<ServerEventStreamOptions>): ServerEventStreamOptions;
//# sourceMappingURL=server-event.d.ts.map