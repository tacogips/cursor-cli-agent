import {
  createServerEventEnvelope,
  type ServerEventEnvelope,
} from "../types/server-event";

export interface SseResponseWriter {
  write(event: ServerEventEnvelope<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export interface SseResponseOptions {
  readonly heartbeatMs: number;
  readonly signal: AbortSignal;
  readonly now?: () => string;
  readonly onCancel?: () => void;
}

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

function sanitizeSseField(value: string): string {
  return value.replaceAll("\r", "").replaceAll("\n", "");
}

export function formatSseEvent(
  event: ServerEventEnvelope<string, unknown>,
): string {
  return [
    `id: ${sanitizeSseField(event.id)}`,
    `event: ${sanitizeSseField(event.event)}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

export function createSseResponseWriter(
  writable: WritableStream<Uint8Array>,
): SseResponseWriter {
  const encoder = new TextEncoder();
  const writer = writable.getWriter();
  let closed = false;
  return {
    async write(event: ServerEventEnvelope<string, unknown>): Promise<void> {
      if (closed) {
        return;
      }
      await writer.write(encoder.encode(formatSseEvent(event)));
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await writer.close();
    },
  };
}

export function createSseResponse(
  events: AsyncIterable<ServerEventEnvelope<string, unknown>>,
  options: SseResponseOptions,
): Response {
  const now = options.now ?? (() => new Date().toISOString());
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer: SseResponseWriter = {
        async write(event): Promise<void> {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
          } catch {
            closed = true;
            options.onCancel?.();
          }
        },
        async close(): Promise<void> {
          if (closed) {
            return;
          }
          closed = true;
          try {
            controller.close();
          } catch {
            // The stream may already be cancelled by the client.
          }
        },
      };

      const close = async (): Promise<void> => {
        if (heartbeatTimer !== undefined) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        await writer?.close();
      };

      options.signal.addEventListener(
        "abort",
        () => {
          void close();
        },
        { once: true },
      );

      heartbeatTimer = setInterval(() => {
        void writer.write(
          createServerEventEnvelope("server.heartbeat", { now: now() }),
        );
      }, options.heartbeatMs);

      try {
        for await (const event of events) {
          if (options.signal.aborted) {
            break;
          }
          await writer.write(event);
        }
      } finally {
        await close();
      }
    },
    cancel() {
      closed = true;
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      options.onCancel?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: EVENT_STREAM_HEADERS,
  });
}
