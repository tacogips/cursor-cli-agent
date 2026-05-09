import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { workspaceSlugFromPath } from "../config/paths";
import type { SessionIndexRepository } from "../persistence/session-index";
import {
  createUsageEventStore,
  type UsageEventStore,
} from "../persistence/usage-event-store";
import type { AgentEvent } from "../types/agent-event";
import type { CursorSessionRecord } from "../types/session-record";
import { createUsagePersistenceChain } from "./usage-persistence-chain";

let testDir: string | undefined;

afterEach(async () => {
  if (testDir !== undefined) {
    await rm(testDir, { recursive: true, force: true });
    testDir = undefined;
  }
});

function baseRecord(
  overrides: Partial<CursorSessionRecord> &
    Pick<CursorSessionRecord, "recordId">,
): CursorSessionRecord {
  return {
    identityState: "transcript_only",
    workspaceSlug: "ws",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    source: "headless",
    status: "completed",
    ...overrides,
  };
}

function mockRepo(
  map: Record<string, CursorSessionRecord>,
): SessionIndexRepository {
  return {
    resolveSessionKey(key: string): CursorSessionRecord | undefined {
      return map[key];
    },
  } as SessionIndexRepository;
}

describe("usage persistence chain", () => {
  test("persists normalized completion usage through injected store", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const storePath = join(testDir, "usage-events.json");
    const store = createUsageEventStore(storePath);
    const ws = "/tmp/usage-chain-workspace";
    const repo = mockRepo({
      "sess-a": baseRecord({
        recordId: "rec-a",
        localSessionId: "sess-a",
        workspacePath: ws,
        workspaceSlug: workspaceSlugFromPath(ws),
        model: "idx-model",
      }),
    });
    const chain = createUsagePersistenceChain(repo, { store });
    const events: AgentEvent[] = [
      {
        type: "session.completed",
        sessionId: "sess-a",
        result: "done",
        usage: { inputTokens: 2, outputTokens: 3 },
      },
    ];
    chain.capture(events);
    await chain.flush();
    const rows = await store.listEvents();
    expect(rows.length).toBe(1);
    expect(rows[0]?.sessionId).toBe("sess-a");
    expect(rows[0]?.recordId).toBe("rec-a");
    expect(rows[0]?.totalTokens).toBe(5);
    expect(rows[0]?.model).toBe("idx-model");
  });

  test("prefers stream session.started model over index model", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const store = createUsageEventStore(join(testDir, "usage-events.json"));
    const repo = mockRepo({
      "sess-a": baseRecord({
        recordId: "rec-a",
        localSessionId: "sess-a",
        model: "idx-model",
      }),
    });
    const chain = createUsagePersistenceChain(repo, { store });
    chain.capture([
      {
        type: "session.started",
        sessionId: "sess-a",
        cwd: "/tmp",
        model: "stream-model",
      },
      {
        type: "session.completed",
        sessionId: "sess-a",
        result: "ok",
        usage: { totalTokens: 4 },
      },
    ]);
    await chain.flush();
    const rows = await store.listEvents();
    expect(rows[0]?.model).toBe("stream-model");
  });

  test("shares observedAt across multiple completions in one capture batch", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const store = createUsageEventStore(join(testDir, "usage-events.json"));
    const repo = mockRepo({
      s1: baseRecord({ recordId: "r1", localSessionId: "s1" }),
      s2: baseRecord({ recordId: "r2", localSessionId: "s2" }),
    });
    const chain = createUsagePersistenceChain(repo, { store });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "s1",
        result: "a",
        usage: { inputTokens: 1 },
      },
      {
        type: "session.completed",
        sessionId: "s2",
        result: "b",
        usage: { inputTokens: 1 },
      },
    ]);
    await chain.flush();
    const rows = await store.listEvents({ sessionId: "s1" });
    const rows2 = await store.listEvents({ sessionId: "s2" });
    expect(rows.length).toBe(1);
    expect(rows2.length).toBe(1);
    const firstRow = rows[0];
    const secondRow = rows2[0];
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error("expected usage events for both sessions");
    }
    expect(firstRow.observedAt).toBe(secondRow.observedAt);
  });

  test("skips zero-token completions and does not write rows", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const store = createUsageEventStore(join(testDir, "usage-events.json"));
    const repo = mockRepo({
      z: baseRecord({ recordId: "rz", localSessionId: "z" }),
    });
    const chain = createUsagePersistenceChain(repo, { store });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "z",
        result: "noop",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);
    await chain.flush();
    expect((await store.listEvents()).length).toBe(0);
  });

  test("flush waits when capture extends chain during pending upsert", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const storePath = join(testDir, "usage-events.json");
    const inner = createUsageEventStore(storePath);
    const repo = mockRepo({
      s1: baseRecord({ recordId: "r1", localSessionId: "s1" }),
      s2: baseRecord({ recordId: "r2", localSessionId: "s2" }),
    });
    let extendedDuringUpsert = false;
    let chain: ReturnType<typeof createUsagePersistenceChain>;
    const store: UsageEventStore = {
      listEvents: (opts) => inner.listEvents(opts),
      upsertEvent: (e) => inner.upsertEvent(e),
      async upsertEvents(batch) {
        await inner.upsertEvents(batch);
        if (!extendedDuringUpsert) {
          extendedDuringUpsert = true;
          chain.capture([
            {
              type: "session.completed",
              sessionId: "s2",
              result: "late",
              usage: { inputTokens: 2 },
            },
          ]);
        }
      },
    };
    chain = createUsagePersistenceChain(repo, { store });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "s1",
        result: "first",
        usage: { inputTokens: 1 },
      },
    ]);
    await chain.flush();
    const rows = await inner.listEvents();
    expect(rows.length).toBe(2);
    expect([...new Set(rows.map((r) => r.sessionId))].sort()).toEqual([
      "s1",
      "s2",
    ]);
  });

  test("store write failures are swallowed so flush still settles", async () => {
    const store = {
      async listEvents() {
        return [];
      },
      async upsertEvents() {
        throw new Error("disk full");
      },
      async upsertEvent() {
        throw new Error("disk full");
      },
    };
    const repo = mockRepo({
      x: baseRecord({ recordId: "rx", localSessionId: "x" }),
    });
    const errors: unknown[] = [];
    const chain = createUsagePersistenceChain(repo, {
      store,
      onPersistError: (error) => {
        errors.push(error);
      },
    });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "x",
        result: "ok",
        usage: { inputTokens: 1 },
      },
    ]);
    await expect(chain.flush()).resolves.toBeUndefined();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("disk full");
  });

  test("unresolvable sessionId preserves sessionId and omits enriched metadata", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-chain-"));
    const store = createUsageEventStore(join(testDir, "usage-events.json"));
    const repo = mockRepo({});
    const chain = createUsagePersistenceChain(repo, { store });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "unknown-sess",
        result: "done",
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    ]);
    await chain.flush();
    const rows = await store.listEvents();
    expect(rows.length).toBe(1);
    expect(rows[0]?.sessionId).toBe("unknown-sess");
    expect(rows[0]?.recordId).toBeUndefined();
    expect(rows[0]?.workspacePath).toBeUndefined();
    // No model from index; extractor falls back to the sentinel value.
    expect(rows[0]?.model).toBe("unknown");
  });

  test("onPersistError exceptions do not reject flush", async () => {
    const store = {
      async listEvents() {
        return [];
      },
      async upsertEvents() {
        throw new Error("disk full");
      },
      async upsertEvent() {
        throw new Error("disk full");
      },
    };
    const repo = mockRepo({
      x: baseRecord({ recordId: "rx", localSessionId: "x" }),
    });
    const chain = createUsagePersistenceChain(repo, {
      store,
      onPersistError: () => {
        throw new Error("observer boom");
      },
    });
    chain.capture([
      {
        type: "session.completed",
        sessionId: "x",
        result: "ok",
        usage: { inputTokens: 1 },
      },
    ]);
    await expect(chain.flush()).resolves.toBeUndefined();
  });
});
