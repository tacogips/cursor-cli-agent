import {
  normalizeServerEventStreamOptions,
  type ServerEventEnvelope,
} from "../../types/server-event";
import { HttpError } from "../http-errors";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseReplayMode,
} from "../request";
import { createSseResponse } from "../sse";
import type { EventStreamService } from "../event-streams";

export interface EventRouteDependencies {
  readonly streams: EventStreamService;
  readonly sessionExists?: (id: string) => Promise<boolean>;
  readonly groupExists?: (name: string) => Promise<boolean>;
  readonly queueExists?: (name: string) => Promise<boolean>;
}

function decodeRouteParameter(raw: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError("INVALID_REQUEST", `invalid ${label}`);
  }
  if (decoded.length === 0 || decoded.includes("/")) {
    throw new HttpError("INVALID_REQUEST", `invalid ${label}`);
  }
  return decoded;
}

function createRouteAbortSignal(request: Request): {
  readonly signal: AbortSignal;
  readonly abort: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, abort };
}

function getLastEventId(
  request: Request,
  url: { readonly searchParams: URLSearchParams },
): string | undefined {
  const headerValue = request.headers.get("last-event-id");
  if (headerValue !== null && headerValue.trim().length > 0) {
    return headerValue;
  }

  return url.searchParams.get("lastEventId") ?? undefined;
}

function parseEventOptions(
  request: Request,
  url: { readonly searchParams: URLSearchParams },
) {
  const replay = parseReplayMode(url, "replay", "latest");
  const heartbeatMs = parsePositiveInteger(url, "heartbeatMs", 15_000);
  const startOffset = url.searchParams.has("startOffset")
    ? parseNonNegativeInteger(url, "startOffset", 0)
    : undefined;
  const lastEventId = getLastEventId(request, url);
  return normalizeServerEventStreamOptions({
    replay,
    heartbeatMs,
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(lastEventId !== undefined ? { lastEventId } : {}),
  });
}

export function isEventRoutePath(pathname: string): boolean {
  return (
    pathname === "/api/events/activity" || pathname.startsWith("/api/events/")
  );
}

export async function handleEventRoute(
  request: Request,
  dependencies: EventRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!isEventRoutePath(pathname)) {
    return undefined;
  }
  if (request.method !== "GET") {
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  const options = parseEventOptions(request, url);
  const routeSignal = createRouteAbortSignal(request);
  let stream: AsyncIterable<ServerEventEnvelope<string, unknown>>;

  if (pathname === "/api/events/activity") {
    stream = dependencies.streams.watchActivity(
      undefined,
      options,
      routeSignal.signal,
    );
  } else if (pathname.startsWith("/api/events/activity/")) {
    const id = decodeRouteParameter(
      pathname.slice("/api/events/activity/".length),
      "session id",
    );
    if (
      dependencies.sessionExists !== undefined &&
      !(await dependencies.sessionExists(id))
    ) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    stream = dependencies.streams.watchActivity(
      id,
      options,
      routeSignal.signal,
    );
  } else if (pathname.startsWith("/api/events/sessions/")) {
    const id = decodeRouteParameter(
      pathname.slice("/api/events/sessions/".length),
      "session id",
    );
    if (
      dependencies.sessionExists !== undefined &&
      !(await dependencies.sessionExists(id))
    ) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    stream = dependencies.streams.watchSession(id, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/groups/")) {
    const name = decodeRouteParameter(
      pathname.slice("/api/events/groups/".length),
      "group name",
    );
    if (
      dependencies.groupExists !== undefined &&
      !(await dependencies.groupExists(name))
    ) {
      throw new HttpError("NOT_FOUND", "group not found");
    }
    stream = dependencies.streams.watchGroup(name, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/queues/")) {
    const name = decodeRouteParameter(
      pathname.slice("/api/events/queues/".length),
      "queue name",
    );
    if (
      dependencies.queueExists !== undefined &&
      !(await dependencies.queueExists(name))
    ) {
      throw new HttpError("NOT_FOUND", "queue not found");
    }
    stream = dependencies.streams.watchQueue(name, options, routeSignal.signal);
  } else {
    throw new HttpError("NOT_FOUND", "route not found");
  }

  return createSseResponse(stream, {
    heartbeatMs: options.heartbeatMs,
    signal: routeSignal.signal,
    onCancel: routeSignal.abort,
  });
}
