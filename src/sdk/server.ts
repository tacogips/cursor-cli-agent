import type {
  ServerEventEnvelope,
  ServerEventStreamOptions,
} from "../types/server-event";
import { normalizeServerEventStreamOptions } from "../types/server-event";
import type { CursorAgentSdk } from "./types";

export type {
  ServerEventEnvelope,
  ServerEventName,
  ServerEventPayloadByName,
  ServerEventStreamOptions,
} from "../types/server-event";
export {
  createAppServerCompatMetadata,
  type AppServerCompatMetadata,
} from "../server/app-server-compat";

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
  watchActivity(
    sessionId?: string,
    options?: Partial<ServerEventStreamOptions>,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchSession(
    sessionId: string,
    options?: Partial<ServerEventStreamOptions>,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}

export interface SdkServerHelpers {
  createResourceHandlers(sdk: CursorAgentSdk): ResourceHandlerSet;
  createEventStreamSource(sdk: CursorAgentSdk): CursorAgentEventSource;
}

function eventEnvelope(
  event: string,
  payload: unknown,
): ServerEventEnvelope<string, unknown> {
  return {
    id: `${event}:${Date.now().toString(36)}`,
    event,
    emittedAt: new Date().toISOString(),
    payload,
  };
}

export function createResourceHandlers(
  sdk: CursorAgentSdk,
): ResourceHandlerSet {
  return {
    sessions: sdk.sessions,
    search: sdk.search,
    groups: sdk.groups,
    queues: sdk.queues,
    bookmarks: sdk.bookmarks,
    files: sdk.files,
    activity: sdk.activity,
  };
}

export function createEventStreamSource(
  sdk: CursorAgentSdk,
): CursorAgentEventSource {
  return {
    async *watchActivity(
      sessionId?: string,
      options: Partial<ServerEventStreamOptions> = {},
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      normalizeServerEventStreamOptions(options);
      const payload =
        sessionId === undefined
          ? await sdk.activity.list()
          : await sdk.activity.get(sessionId);
      yield eventEnvelope("activity.updated", {
        ...(sessionId !== undefined ? { sessionId } : {}),
        activities:
          payload === null ? [] : Array.isArray(payload) ? payload : [payload],
        provenance: "derived",
      });
    },

    async *watchSession(
      sessionId: string,
      options: Partial<ServerEventStreamOptions> = {},
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      normalizeServerEventStreamOptions(options);
      const session = await sdk.sessions.get(sessionId);
      if (session === null) {
        yield eventEnvelope("session.error", {
          type: "session.error",
          sessionId,
          message: "session not found",
        });
        return;
      }
      if (session.identityState === "chat_only") {
        yield eventEnvelope("session.pending", { session });
        return;
      }
      yield eventEnvelope("session.materialized", {
        previousSession: session,
        session,
      });
    },
  };
}

export const sdkServerHelpers: SdkServerHelpers = {
  createResourceHandlers,
  createEventStreamSource,
};
