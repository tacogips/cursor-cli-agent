import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { workspaceSlugFromPath } from "../config/paths";
import type { UsageEventRecord } from "../types/usage-event";
import { createUsageEventStore } from "./usage-event-store";

let testDir: string | undefined;

afterEach(async () => {
  if (testDir !== undefined) {
    await rm(testDir, { recursive: true, force: true });
    testDir = undefined;
  }
});

function sampleEvent(
  overrides: Partial<UsageEventRecord> = {},
): UsageEventRecord {
  return {
    eventId: "evt-1",
    sessionId: "sess-1",
    recordId: "rec-1",
    cursorChatId: "chat-1",
    workspacePath: "/tmp/sample-workspace",
    workspaceSlug: workspaceSlugFromPath("/tmp/sample-workspace"),
    model: "m1",
    observedAt: "2026-05-08T04:00:00.000Z",
    source: "stream_result",
    provenance: "repository_usage_events",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    ...overrides,
  };
}

describe("usage event store", () => {
  test("upserts are idempotent and sorts deterministically", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const store = createUsageEventStore(path);
    const a = sampleEvent({
      eventId: "a",
      observedAt: "2026-05-08T01:00:00.000Z",
      sessionId: "s-a",
      totalTokens: 2,
    });
    const b = sampleEvent({
      eventId: "b",
      observedAt: "2026-05-08T02:00:00.000Z",
      sessionId: "s-b",
      totalTokens: 3,
      workspacePath: "/other/ws",
      workspaceSlug: workspaceSlugFromPath("/other/ws"),
    });
    await store.upsertEvent(a);
    await store.upsertEvent(b);
    await store.upsertEvent({ ...a, totalTokens: 99 });
    const listed = await store.listEvents();
    expect(listed.map((r) => r.eventId)).toEqual(["a", "b"]);
    expect(listed[0]?.totalTokens).toBe(99);
  });

  test("filters session id by local id, record id, or cursor chat id", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const store = createUsageEventStore(path);
    const ev = sampleEvent({ eventId: "e1" });
    await store.upsertEvent(ev);

    await expect(store.listEvents({ sessionId: "sess-1" })).resolves.toEqual([
      ev,
    ]);
    await expect(store.listEvents({ sessionId: "rec-1" })).resolves.toEqual([
      ev,
    ]);
    await expect(store.listEvents({ sessionId: "chat-1" })).resolves.toEqual([
      ev,
    ]);
    await expect(store.listEvents({ sessionId: "missing" })).resolves.toEqual(
      [],
    );
  });

  test("filters by workspace path alias", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const store = createUsageEventStore(path);
    await store.upsertEvent(sampleEvent({ eventId: "home", sessionId: "s1" }));
    await store.upsertEvent(
      sampleEvent({
        eventId: "away",
        sessionId: "s2",
        workspacePath: "/tmp/other-path",
        workspaceSlug: workspaceSlugFromPath("/tmp/other-path"),
      }),
    );
    const filtered = await store.listEvents({
      workspacePath: "/tmp/sample-workspace",
    });
    expect(filtered.map((r) => r.eventId)).toEqual(["home"]);
  });

  test("tolerates corrupt JSON as empty store", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    await Bun.write(path, "{ not json");
    const store = createUsageEventStore(path);
    await expect(store.listEvents()).resolves.toEqual([]);
  });

  test("drops rows with non-string optional fields", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const badRecordId = sampleEvent({ eventId: "bad-id" });
    await Bun.write(
      path,
      JSON.stringify({
        events: {
          good: sampleEvent({ eventId: "good" }),
          bad: { ...badRecordId, recordId: 42 },
        },
      }),
    );
    const store = createUsageEventStore(path);
    const listed = await store.listEvents();
    expect(listed.map((r) => r.eventId)).toEqual(["good"]);
  });

  test("upsertEvents merges multiple rows in one write", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const store = createUsageEventStore(path);
    const x = sampleEvent({
      eventId: "x",
      sessionId: "sx",
      observedAt: "2026-05-08T10:00:00.000Z",
    });
    const y = sampleEvent({
      eventId: "y",
      sessionId: "sy",
      observedAt: "2026-05-08T11:00:00.000Z",
    });
    await store.upsertEvents([x, y]);
    const listed = await store.listEvents();
    expect(listed.map((r) => r.eventId)).toEqual(["x", "y"]);
  });

  test("upsertEvents with empty batch is a no-op", async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-usage-ev-"));
    const path = join(testDir, "usage-events.json");
    const store = createUsageEventStore(path);
    const row = sampleEvent({ eventId: "kept", sessionId: "s-kept" });
    await store.upsertEvent(row);
    await store.upsertEvents([]);
    await expect(store.listEvents()).resolves.toEqual([row]);
  });
});
