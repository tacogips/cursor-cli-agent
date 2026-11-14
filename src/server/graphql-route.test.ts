import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTokenManager } from "../auth";
import { SessionIndexRepository } from "../persistence/session-index";
import type { ServerEventEnvelope } from "../types/server-event";
import type { EventStreamService } from "./event-streams";
import { createHttpRouteHandler } from "./routes";
import { resolveHttpServerConfig } from "./types";

const previousDataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
const previousConfigDir = process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
const previousCursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];

let testDir: string;
let repo: SessionIndexRepository;

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
  if (previousConfigDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = previousConfigDir;
  }
  if (previousCursorHome === undefined) {
    delete process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
  } else {
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
  }
}

function route(token?: string) {
  return createHttpRouteHandler({
    config: resolveHttpServerConfig({
      ...(token !== undefined ? { token } : {}),
      compatGraphql: true,
    }),
    startedAt: new Date("2026-05-07T00:00:00.000Z"),
    sessions: repo,
  });
}

function routeWithStreams(streams: EventStreamService) {
  return createHttpRouteHandler({
    config: resolveHttpServerConfig({ compatGraphql: true }),
    startedAt: new Date("2026-05-07T00:00:00.000Z"),
    sessions: repo,
    streams,
  });
}

function oneSessionEvent(): ServerEventEnvelope<string, unknown> {
  return {
    id: "event-1",
    event: "session.pending",
    emittedAt: "2026-05-07T00:00:00.000Z",
    payload: { sessionId: "session-1" },
  };
}

function streamEvent(
  id: string,
  event: string,
): ServerEventEnvelope<string, unknown> {
  return {
    id,
    event,
    emittedAt: "2026-05-07T00:00:00.000Z",
    payload: { id },
  };
}

async function jsonFor(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GraphQL compatibility route", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-graphql-route-"));
    const dataDir = join(testDir, "data");
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = dataDir;
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = join(testDir, "config");
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
    await mkdir(dataDir, { recursive: true });
    repo = new SessionIndexRepository(join(dataDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("keeps /api/graphql opt-in", async () => {
    const disabled = createHttpRouteHandler({
      config: resolveHttpServerConfig(),
      startedAt: new Date("2026-05-07T00:00:00.000Z"),
      sessions: repo,
    });
    const response = await disabled(
      new Request("http://server/api/graphql", { method: "POST" }),
    );

    expect(response.status).toBe(404);
  });

  test("executes successful local query", async () => {
    const response = await route()(
      new Request("http://server/api/graphql", {
        method: "POST",
        body: JSON.stringify({ query: "query { ping }" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await jsonFor(response)).toEqual({ data: { ping: true } });
  });

  test("returns unauthorized and forbidden auth gates", async () => {
    const authedRoute = route("server-token");
    const missing = await authedRoute(
      new Request("http://server/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            'query ($param: JSON) { command(name: "session.list", params: $param) }',
          variables: { param: { limit: 1 } },
        }),
      }),
    );
    expect(missing.status).toBe(401);

    const token = await createTokenManager({
      configDir: join(testDir, "config"),
    }).createToken({
      name: "admin only",
      permissions: ["server:admin"],
    });
    const forbidden = await authedRoute(
      new Request("http://server/api/graphql", {
        method: "POST",
        headers: { authorization: `Bearer ${token.token}` },
        body: JSON.stringify({
          query:
            'query ($param: JSON) { command(name: "session.list", params: $param) }',
          variables: { param: { limit: 1 } },
        }),
      }),
    );
    expect(forbidden.status).toBe(403);
  });

  test("streams subscription results and aborts source on disconnect", async () => {
    let sourceAborted = false;
    const streams: EventStreamService = {
      watchSession(_id, _options, signal) {
        signal.addEventListener(
          "abort",
          () => {
            sourceAborted = true;
          },
          { once: true },
        );
        return (async function* (): AsyncGenerator<
          ServerEventEnvelope<string, unknown>,
          void,
          void
        > {
          yield oneSessionEvent();
          while (!signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        })();
      },
      watchActivity() {
        throw new Error("not used");
      },
      watchGroup() {
        throw new Error("not used");
      },
      watchQueue() {
        throw new Error("not used");
      },
    };

    const response = await routeWithStreams(streams)(
      new Request("http://server/api/graphql", {
        method: "POST",
        body: JSON.stringify({
          query:
            'subscription ($param: JSON) { command(name: "session.watch", params: $param) }',
          variables: { param: { id: "session-1" } },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) {
      throw new Error("expected subscription response body reader");
    }
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("session.pending");
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(sourceAborted).toBe(true);
  });

  test("streams group, queue, and activity subscriptions through event streams", async () => {
    const aborted = new Set<string>();
    const liveStream = (name: string, event: string, signal: AbortSignal) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted.add(name);
        },
        { once: true },
      );
      return (async function* (): AsyncGenerator<
        ServerEventEnvelope<string, unknown>,
        void,
        void
      > {
        yield streamEvent(`${name}:1`, event);
        while (!signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      })();
    };
    const streams: EventStreamService = {
      watchSession() {
        throw new Error("not used");
      },
      watchActivity(id, _options, signal) {
        return liveStream(
          `activity:${id ?? "all"}`,
          "activity.updated",
          signal,
        );
      },
      watchGroup(name, _options, signal) {
        return liveStream(`group:${name}`, "group.progress", signal);
      },
      watchQueue(name, _options, signal) {
        return liveStream(`queue:${name}`, "queue.progress", signal);
      },
    };
    const cases = [
      {
        command: "group.watch",
        param: { name: "group-a" },
        expected: "group.progress",
        abortedName: "group:group-a",
      },
      {
        command: "queue.watch",
        param: { name: "queue-a" },
        expected: "queue.progress",
        abortedName: "queue:queue-a",
      },
      {
        command: "activity.watch",
        param: { id: "session-a" },
        expected: "activity.updated",
        abortedName: "activity:session-a",
      },
    ] as const;

    for (const item of cases) {
      const response = await routeWithStreams(streams)(
        new Request("http://server/api/graphql", {
          method: "POST",
          body: JSON.stringify({
            query:
              'subscription ($param: JSON) { command(name: "' +
              item.command +
              '", params: $param) }',
            variables: { param: item.param },
          }),
        }),
      );
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (reader === undefined) {
        throw new Error("expected subscription response body reader");
      }
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(item.expected);
      await reader.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(aborted.has(item.abortedName)).toBe(true);
    }
  });
});
