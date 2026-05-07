import { describe, expect, test } from "bun:test";

import {
  createServerEventEnvelope,
  type ServerEventEnvelope,
  type ServerEventStreamOptions,
} from "../../types/server-event";
import type { EventStreamService } from "../event-streams";
import { HttpError } from "../http-errors";
import { handleEventRoute } from "./events";

interface SeenCall {
  readonly kind: string;
  readonly id?: string;
  readonly options: ServerEventStreamOptions;
  readonly signal: AbortSignal;
}

function singleEvent(): AsyncIterable<ServerEventEnvelope<string, unknown>> {
  return (async function* () {
    yield createServerEventEnvelope(
      "server.heartbeat",
      { now: "2026-05-07T00:00:00.000Z" },
      { id: "event-1", emittedAt: "2026-05-07T00:00:00.000Z" },
    );
  })();
}

function fakeStreams(seen: SeenCall[]): EventStreamService {
  return {
    watchSession(id, options, signal) {
      seen.push({ kind: "session", id, options, signal });
      return singleEvent();
    },
    watchActivity(id, options, signal) {
      seen.push({
        kind: "activity",
        ...(id !== undefined ? { id } : {}),
        options,
        signal,
      });
      return singleEvent();
    },
    watchGroup(id, options, signal) {
      seen.push({ kind: "group", id, options, signal });
      return singleEvent();
    },
    watchQueue(id, options, signal) {
      seen.push({ kind: "queue", id, options, signal });
      return singleEvent();
    },
  };
}

describe("event routes", () => {
  test("routes session streams with validated query options", async () => {
    const seen: SeenCall[] = [];
    const response = await handleEventRoute(
      new Request(
        "http://server/api/events/sessions/local-1?replay=none&startOffset=12&heartbeatMs=50&lastEventId=old",
      ),
      { streams: fakeStreams(seen) },
    );
    if (response === undefined) {
      throw new Error("expected response");
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("event: server.heartbeat");
    expect(seen[0]).toMatchObject({
      kind: "session",
      id: "local-1",
      options: {
        replay: "none",
        startOffset: 12,
        heartbeatMs: 50,
        lastEventId: "old",
      },
    });
  });

  test("prefers Last-Event-ID header over query fallback", async () => {
    const seen: SeenCall[] = [];
    const response = await handleEventRoute(
      new Request(
        "http://server/api/events/sessions/local-1?replay=latest&lastEventId=query-old",
        { headers: { "Last-Event-ID": "header-old" } },
      ),
      { streams: fakeStreams(seen) },
    );
    await response?.body?.cancel();

    expect(seen[0]?.options.lastEventId).toBe("header-old");
  });

  test("routes activity, group, and queue stream paths", async () => {
    const seen: SeenCall[] = [];
    const streams = fakeStreams(seen);
    await (
      await handleEventRoute(new Request("http://server/api/events/activity"), {
        streams,
      })
    )?.body?.cancel();
    await (
      await handleEventRoute(
        new Request("http://server/api/events/activity/local-1"),
        { streams },
      )
    )?.body?.cancel();
    await (
      await handleEventRoute(
        new Request("http://server/api/events/groups/group-1"),
        { streams },
      )
    )?.body?.cancel();
    await (
      await handleEventRoute(
        new Request("http://server/api/events/queues/queue-1"),
        { streams },
      )
    )?.body?.cancel();

    expect(seen.map((call) => `${call.kind}:${call.id ?? "all"}`)).toEqual([
      "activity:all",
      "activity:local-1",
      "group:group-1",
      "queue:queue-1",
    ]);
  });

  test("rejects invalid query values before streaming", async () => {
    const result = handleEventRoute(
      new Request("http://server/api/events/activity?replay=bad"),
      { streams: fakeStreams([]) },
    );
    await expect(result).rejects.toBeInstanceOf(HttpError);
  });

  test("returns undefined for non-event paths", async () => {
    expect(
      await handleEventRoute(new Request("http://server/api/health"), {
        streams: fakeStreams([]),
      }),
    ).toBeUndefined();
  });
});
