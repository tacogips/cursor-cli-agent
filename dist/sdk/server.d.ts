import type { ServerEventEnvelope, ServerEventStreamOptions } from "../types/server-event";
import type { CursorAgentSdk } from "./types";
export type { ServerEventEnvelope, ServerEventName, ServerEventPayloadByName, ServerEventStreamOptions, } from "../types/server-event";
export { createAppServerCompatMetadata, type AppServerCompatMetadata, } from "../server/app-server-compat";
export interface ResourceHandlerSet {
    readonly sessions: {
        list(): ReturnType<CursorAgentSdk["sessions"]["list"]>;
        get(sessionId: string): ReturnType<CursorAgentSdk["sessions"]["get"]>;
        refresh(): ReturnType<CursorAgentSdk["sessions"]["refresh"]>;
    };
    readonly search: CursorAgentSdk["search"];
    readonly groups: CursorAgentSdk["groups"];
    readonly queues: CursorAgentSdk["queues"];
    readonly bookmarks: CursorAgentSdk["bookmarks"];
    readonly files: CursorAgentSdk["files"];
    readonly activity: CursorAgentSdk["activity"];
}
export interface CursorAgentEventSource {
    watchActivity(sessionId?: string, options?: Partial<ServerEventStreamOptions>): AsyncIterable<ServerEventEnvelope<string, unknown>>;
    watchSession(sessionId: string, options?: Partial<ServerEventStreamOptions>): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}
export interface SdkServerHelpers {
    createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
    createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}
export declare function createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
export declare function createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
export declare const sdkServerHelpers: SdkServerHelpers;
//# sourceMappingURL=server.d.ts.map