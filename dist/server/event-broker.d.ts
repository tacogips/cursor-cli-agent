import type { ServerEventEnvelope, ServerEventStreamOptions } from "../types/server-event";
export interface EventBroker {
    publish(topic: string, event: ServerEventEnvelope<string, unknown>): void;
    subscribe(topic: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}
export declare class InMemoryEventBroker implements EventBroker {
    private readonly latestByTopic;
    private readonly subscribersByTopic;
    publish(topic: string, event: ServerEventEnvelope<string, unknown>): void;
    subscribe(topic: string, options: ServerEventStreamOptions, signal: AbortSignal): AsyncIterable<ServerEventEnvelope<string, unknown>>;
    subscriberCount(topic: string): number;
    private removeTopicIfEmpty;
}
export declare function createEventBroker(): EventBroker;
//# sourceMappingURL=event-broker.d.ts.map