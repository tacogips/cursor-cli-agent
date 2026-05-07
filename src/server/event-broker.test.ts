import { describe, expect, test } from "bun:test";

import { InMemoryEventBroker } from "./event-broker";
import {
  createServerEventEnvelope,
  normalizeServerEventStreamOptions,
} from "../types/server-event";

async function nextEvent<T>(
  iterable: AsyncIterable<T>,
): Promise<IteratorResult<T, void>> {
  return await iterable[Symbol.asyncIterator]().next();
}

describe("event broker", () => {
  test("fans out published events to multiple subscribers", async () => {
    const broker = new InMemoryEventBroker();
    const firstSignal = new AbortController();
    const secondSignal = new AbortController();
    const options = normalizeServerEventStreamOptions({ replay: "none" });
    const first = broker.subscribe("topic", options, firstSignal.signal);
    const second = broker.subscribe("topic", options, secondSignal.signal);
    const firstIterator = first[Symbol.asyncIterator]();
    const secondIterator = second[Symbol.asyncIterator]();

    const event = createServerEventEnvelope("server.heartbeat", {
      now: "2026-05-07T00:00:00.000Z",
    });
    broker.publish("topic", event);

    expect((await firstIterator.next()).value?.id).toBe(event.id);
    expect((await secondIterator.next()).value?.id).toBe(event.id);
    await firstIterator.return?.();
    await secondIterator.return?.();
  });

  test("replays the latest event only when requested", async () => {
    const broker = new InMemoryEventBroker();
    const event = createServerEventEnvelope("server.heartbeat", {
      now: "2026-05-07T00:00:00.000Z",
    });
    broker.publish("topic", event);

    const replayed = await nextEvent(
      broker.subscribe(
        "topic",
        normalizeServerEventStreamOptions({ replay: "latest" }),
        new AbortController().signal,
      ),
    );
    expect(replayed.value?.id).toBe(event.id);

    const noneController = new AbortController();
    const none = broker.subscribe(
      "topic",
      normalizeServerEventStreamOptions({ replay: "none" }),
      noneController.signal,
    );
    const noneIterator = none[Symbol.asyncIterator]();
    const pending = noneIterator.next();
    noneController.abort();
    expect((await pending).done).toBe(true);
  });

  test("cleans up subscribers on abort and consumer return", async () => {
    const broker = new InMemoryEventBroker();
    const controller = new AbortController();
    const subscription = broker.subscribe(
      "topic",
      normalizeServerEventStreamOptions({ replay: "none" }),
      controller.signal,
    );
    const iterator = subscription[Symbol.asyncIterator]();
    expect(broker.subscriberCount("topic")).toBe(1);
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(broker.subscriberCount("topic")).toBe(0);

    const returnedController = new AbortController();
    const returned = broker.subscribe(
      "topic",
      normalizeServerEventStreamOptions({ replay: "none" }),
      returnedController.signal,
    );
    const returnedIterator = returned[Symbol.asyncIterator]();
    expect(broker.subscriberCount("topic")).toBe(1);
    broker.publish(
      "topic",
      createServerEventEnvelope("server.heartbeat", {
        now: "2026-05-07T00:00:01.000Z",
      }),
    );
    expect((await returnedIterator.next()).done).toBe(false);
    await returnedIterator.return?.();
    expect(broker.subscriberCount("topic")).toBe(0);
  });
});
