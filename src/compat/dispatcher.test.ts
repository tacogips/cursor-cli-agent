import { describe, expect, test } from "bun:test";

import type { CursorAgentSdk } from "../sdk";
import type { EventStreamService } from "../server/event-streams";
import type { ServerEventEnvelope } from "../types/server-event";
import {
  createCompatCommandDispatcher,
  CompatCommandError,
} from "./dispatcher";

const sdk = {
  sessions: {
    list: async () => [{ recordId: "rec-1" }],
    get: async (sessionId: string) => ({ recordId: sessionId }),
    refresh: async () => [],
  },
  search: {
    sessions: async () => ({ total: 0, sessions: [], provenance: "index" }),
    transcripts: async () => ({
      total: 0,
      hits: [],
      provenance: "transcript",
      scannedSessions: 0,
      scannedEvents: 0,
      scannedBytes: 0,
      truncated: false,
      timedOut: false,
    }),
  },
  groups: {
    list: async () => [],
    get: async (name: string) => ({ name, workspaces: [] }),
    create: async (name: string) => ({ name, workspaces: [] }),
    addWorkspace: async (name: string, workspace: string) => ({
      name,
      workspaces: [workspace],
    }),
    removeWorkspace: async (name: string) => ({ name, workspaces: [] }),
    delete: async (name: string) => ({ name, workspaces: [] }),
    pause: async (name: string) => ({ name, workspaces: [] }),
    resume: async (name: string) => ({ name, workspaces: [] }),
    progress: async (name: string) => ({ group: { name, workspaces: [] } }),
  },
  queues: {
    list: async () => [],
    get: async (name: string) => ({
      name,
      workspace: "/tmp",
      items: [{ id: "item-a" }, { id: "item-b" }],
    }),
    create: async (name: string, workspace: string) => ({
      name,
      workspace,
      items: [],
    }),
    addItem: async (name: string, prompt: string) => ({
      name,
      workspace: "/tmp",
      items: [{ id: "item-1", prompt }],
    }),
    updateItem: async (name: string, itemId: string, patch: unknown) => ({
      name,
      workspace: "/tmp",
      items: [{ id: itemId, patch }],
    }),
    removeItem: async (name: string) => ({
      name,
      workspace: "/tmp",
      items: [],
    }),
    moveItem: async (name: string, from: number, to: number) => ({
      name,
      workspace: "/tmp",
      items: [{ id: "moved", from, to }],
    }),
    setItemMode: async (name: string, itemId: string, mode: string) => ({
      name,
      workspace: "/tmp",
      items: [{ id: itemId, mode }],
    }),
    delete: async (name: string) => ({ name, workspace: "/tmp", items: [] }),
    pause: async (name: string) => ({ name, workspace: "/tmp", items: [] }),
    resume: async (name: string) => ({ name, workspace: "/tmp", items: [] }),
    requestStop: async (name: string) => ({
      name,
      workspace: "/tmp",
      items: [],
    }),
    progress: async (name: string) => ({ queue: { name, workspace: "/tmp" } }),
  },
  bookmarks: {
    add: async (input: { readonly name: string }) => ({
      id: "bookmark-1",
      name: input.name,
    }),
    list: async () => [],
    show: async (id: string) => ({ id }),
    delete: async () => true,
    search: async () => ({ total: 0, hits: [], provenance: "bookmark-store" }),
  },
  files: {
    list: async (sessionId: string) => ({ sessionId, files: [] }),
    snapshots: async (sessionId: string) => ({ sessionId, snapshots: [] }),
    deleted: async (sessionId: string) => ({ sessionId, deletedFiles: [] }),
    find: async (path: string) => ({ queryPath: path, entries: [] }),
    rebuild: async () => ({ indexedSessions: 0 }),
  },
  activity: {
    get: async (sessionId: string) => ({ sessionId }),
    list: async () => [],
    recordSignal: async () => {},
  },
  runner: {
    start: () => {
      throw new Error("runner not used in dispatcher tests");
    },
    resume: () => {
      throw new Error("runner not used in dispatcher tests");
    },
  },
} as unknown as CursorAgentSdk;

describe("compat dispatcher", () => {
  test("routes supported commands through normalized facades", async () => {
    const dispatcher = createCompatCommandDispatcher({ sdk });
    const result = await dispatcher.execute({
      kind: "mutation",
      name: "group.create",
      params: { name: "demo", workspaces: ["/tmp/a"] },
      context: {},
    });

    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.value).toEqual({ name: "demo", workspaces: ["/tmp/a"] });
    }
  });

  test("fails operation-kind mismatches before dispatch", async () => {
    const dispatcher = createCompatCommandDispatcher({ sdk });
    await expect(
      dispatcher.execute({
        kind: "query",
        name: "group.create",
        params: { name: "demo" },
        context: {},
      }),
    ).rejects.toBeInstanceOf(CompatCommandError);
  });

  test("surfaces unsupported decisions with limitation metadata", async () => {
    const dispatcher = createCompatCommandDispatcher({ sdk });
    try {
      await dispatcher.execute({
        kind: "query",
        name: "files.patches",
        context: {},
      });
      throw new Error("expected unsupported command to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CompatCommandError);
      if (error instanceof CompatCommandError) {
        expect(error.statusCode).toBe(501);
        expect(error.details.limitations?.[0]).toMatchObject({
          code: "cursor-no-patch-history",
        });
      }
    }
  });

  test("routes supported queue update, move, and mode commands", async () => {
    const dispatcher = createCompatCommandDispatcher({ sdk });

    const update = await dispatcher.execute({
      kind: "mutation",
      name: "queue.update",
      params: { name: "queue-a", item: "item-a", prompt: "next" },
      context: {},
    });
    expect(update).toMatchObject({
      kind: "single",
      value: {
        name: "queue-a",
        items: [{ id: "item-a", patch: { prompt: "next" } }],
      },
    });

    const move = await dispatcher.execute({
      kind: "mutation",
      name: "queue.move",
      params: { name: "queue-a", from: 0, to: 1 },
      context: {},
    });
    expect(move).toMatchObject({
      kind: "single",
      value: { name: "queue-a", items: [{ from: 0, to: 1 }] },
    });

    const mode = await dispatcher.execute({
      kind: "mutation",
      name: "queue.mode",
      params: { name: "queue-a", item: "item-a", mode: "manual" },
      context: {},
    });
    expect(mode).toMatchObject({
      kind: "single",
      value: { name: "queue-a", items: [{ id: "item-a", mode: "manual" }] },
    });
  });

  test("routes group, queue, and activity watches through event streams", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const event = (name: string): ServerEventEnvelope<string, unknown> => ({
      id: `${name}:1`,
      event: `${name}.progress`,
      emittedAt: "2026-05-07T00:00:00.000Z",
      payload: { name },
    });
    const oneEvent = (name: string) =>
      (async function* (): AsyncGenerator<
        ServerEventEnvelope<string, unknown>,
        void,
        void
      > {
        yield event(name);
      })();
    const streams: EventStreamService = {
      watchSession() {
        throw new Error("not used");
      },
      watchActivity(id, _options, signal) {
        expect(signal).toBe(controller.signal);
        calls.push(`activity:${id ?? "all"}`);
        return oneEvent("activity");
      },
      watchGroup(name, _options, signal) {
        expect(signal).toBe(controller.signal);
        calls.push(`group:${name}`);
        return oneEvent("group");
      },
      watchQueue(name, _options, signal) {
        expect(signal).toBe(controller.signal);
        calls.push(`queue:${name}`);
        return oneEvent("queue");
      },
    };
    const dispatcher = createCompatCommandDispatcher({ sdk, streams });

    const group = await dispatcher.execute({
      kind: "subscription",
      name: "group.watch",
      params: { name: "group-a" },
      context: { abortSignal: controller.signal },
    });
    const queue = await dispatcher.execute({
      kind: "subscription",
      name: "queue.watch",
      params: { name: "queue-a" },
      context: { abortSignal: controller.signal },
    });
    const activity = await dispatcher.execute({
      kind: "subscription",
      name: "activity.watch",
      params: { id: "session-a" },
      context: { abortSignal: controller.signal },
    });

    expect(group.kind).toBe("stream");
    expect(queue.kind).toBe("stream");
    expect(activity.kind).toBe("stream");
    expect(calls).toEqual([
      "group:group-a",
      "queue:queue-a",
      "activity:session-a",
    ]);
  });
});
