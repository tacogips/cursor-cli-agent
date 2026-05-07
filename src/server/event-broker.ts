import type {
  ServerEventEnvelope,
  ServerEventStreamOptions,
} from "../types/server-event";

export interface EventBroker {
  publish(topic: string, event: ServerEventEnvelope<string, unknown>): void;
  subscribe(
    topic: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}

interface TopicSubscriber {
  readonly queue: ServerEventEnvelope<string, unknown>[];
  closed: boolean;
  wake: (() => void) | undefined;
}

function wakeSubscriber(subscriber: TopicSubscriber): void {
  const wake = subscriber.wake;
  subscriber.wake = undefined;
  wake?.();
}

export class InMemoryEventBroker implements EventBroker {
  private readonly latestByTopic = new Map<
    string,
    ServerEventEnvelope<string, unknown>
  >();

  private readonly subscribersByTopic = new Map<string, Set<TopicSubscriber>>();

  publish(topic: string, event: ServerEventEnvelope<string, unknown>): void {
    this.latestByTopic.set(topic, event);
    const subscribers = this.subscribersByTopic.get(topic);
    if (subscribers === undefined) {
      return;
    }
    for (const subscriber of subscribers) {
      if (subscriber.closed) {
        continue;
      }
      subscriber.queue.push(event);
      wakeSubscriber(subscriber);
    }
  }

  subscribe(
    topic: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
    const subscriber: TopicSubscriber = {
      queue: [],
      closed: signal.aborted,
      wake: undefined,
    };
    if (!subscriber.closed && options.replay === "latest") {
      const latest = this.latestByTopic.get(topic);
      if (latest !== undefined && latest.id !== options.lastEventId) {
        subscriber.queue.push(latest);
      }
    }

    if (!subscriber.closed) {
      let subscribers = this.subscribersByTopic.get(topic);
      if (subscribers === undefined) {
        subscribers = new Set<TopicSubscriber>();
        this.subscribersByTopic.set(topic, subscribers);
      }
      subscribers.add(subscriber);
    }

    const cleanup = (): void => {
      if (subscriber.closed) {
        return;
      }
      subscriber.closed = true;
      const subscribers = this.subscribersByTopic.get(topic);
      subscribers?.delete(subscriber);
      if (subscribers?.size === 0) {
        this.subscribersByTopic.delete(topic);
      }
      wakeSubscriber(subscriber);
    };

    signal.addEventListener("abort", cleanup, { once: true });

    const self = this;
    async function* iterator(): AsyncGenerator<
      ServerEventEnvelope<string, unknown>,
      void,
      undefined
    > {
      try {
        while (true) {
          const next = subscriber.queue.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (subscriber.closed) {
            return;
          }
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve;
          });
        }
      } finally {
        signal.removeEventListener("abort", cleanup);
        cleanup();
        self.removeTopicIfEmpty(topic);
      }
    }

    return iterator();
  }

  subscriberCount(topic: string): number {
    return this.subscribersByTopic.get(topic)?.size ?? 0;
  }

  private removeTopicIfEmpty(topic: string): void {
    const subscribers = this.subscribersByTopic.get(topic);
    if (subscribers?.size === 0) {
      this.subscribersByTopic.delete(topic);
    }
  }
}

export function createEventBroker(): EventBroker {
  return new InMemoryEventBroker();
}
