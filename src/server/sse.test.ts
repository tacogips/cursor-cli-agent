import { describe, expect, test } from "bun:test";

import {
  createServerEventEnvelope,
  type ServerEventEnvelope,
} from "../types/server-event";
import {
  createSseResponse,
  createSseResponseWriter,
  formatSseEvent,
} from "./sse";

async function* emptyUntilAbort(
  signal: AbortSignal,
): AsyncGenerator<ServerEventEnvelope<string, unknown>, void, undefined> {
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("sse writer", () => {
  test("formats id, event, and JSON data fields", () => {
    const event = createServerEventEnvelope(
      "server.heartbeat",
      { now: "2026-05-07T00:00:00.000Z" },
      {
        id: "event-1",
        emittedAt: "2026-05-07T00:00:00.000Z",
      },
    );
    expect(formatSseEvent(event)).toBe(
      `id: event-1\nevent: server.heartbeat\ndata: ${JSON.stringify(event)}\n\n`,
    );
  });

  test("writes frames to a byte stream", async () => {
    const chunks: string[] = [];
    const writer = createSseResponseWriter(
      new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(new TextDecoder().decode(chunk));
        },
      }),
    );
    await writer.write(
      createServerEventEnvelope(
        "server.heartbeat",
        { now: "2026-05-07T00:00:00.000Z" },
        { id: "event-1", emittedAt: "2026-05-07T00:00:00.000Z" },
      ),
    );
    await writer.close();
    expect(chunks.join("")).toContain("event: server.heartbeat");
  });

  test("emits heartbeat frames and clears on abort", async () => {
    const controller = new AbortController();
    const response = createSseResponse(emptyUntilAbort(controller.signal), {
      heartbeatMs: 5,
      signal: controller.signal,
      now: () => "2026-05-07T00:00:00.000Z",
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("missing response body");
    }
    const first = await reader.read();
    controller.abort();
    await reader.cancel();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: server.heartbeat");
  });
});
