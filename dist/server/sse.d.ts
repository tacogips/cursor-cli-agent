import { type ServerEventEnvelope } from "../types/server-event";
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
export declare function formatSseEvent(event: ServerEventEnvelope<string, unknown>): string;
export declare function createSseResponseWriter(writable: WritableStream<Uint8Array>): SseResponseWriter;
export declare function createSseResponse(events: AsyncIterable<ServerEventEnvelope<string, unknown>>, options: SseResponseOptions): Response;
//# sourceMappingURL=sse.d.ts.map