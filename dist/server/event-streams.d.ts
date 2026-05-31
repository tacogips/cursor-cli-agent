import { type ActivityManager } from "../activity/manager";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { ServerEventEnvelope, ServerEventStreamOptions } from "../types/server-event";
import type { GroupRecord } from "../types/group";
import type { QueueRecord } from "../types/queue";
import { type EventBroker } from "./event-broker";
export interface EventStreamService {
    watchSession(id: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
    watchActivity(id: string | undefined, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
    watchGroup(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
    watchQueue(name: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}
export interface EventStreamDependencies {
    readonly sessions: SessionIndexRepository;
    readonly activity?: ActivityManager;
    readonly broker?: EventBroker;
    readonly getGroup?: (name: string) => Promise<GroupRecord | undefined>;
    readonly getQueue?: (name: string) => Promise<QueueRecord | undefined>;
    readonly now?: () => string;
    readonly pollMs?: number;
}
export declare function createEventStreamService(dependencies: EventStreamDependencies): EventStreamService;
//# sourceMappingURL=event-streams.d.ts.map