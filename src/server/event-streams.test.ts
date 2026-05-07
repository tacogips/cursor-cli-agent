import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ActivityManager } from "../activity/manager";
import { workspaceSlugFromPath } from "../config/paths";
import { SessionIndexRepository } from "../persistence/session-index";
import type { ActivitySignal, SessionActivity } from "../types/activity";
import type { GroupRecord } from "../types/group";
import type { QueueRecord } from "../types/queue";
import {
  normalizeServerEventStreamOptions,
  type ServerEventEnvelope,
} from "../types/server-event";
import { createEventStreamService } from "./event-streams";

let testDir: string;
let repo: SessionIndexRepository;
const previousCursorHome = process.env["CURORT_CLI_AGENT_CURSOR_HOME"];

function transcriptLine(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

function activity(
  id: string,
  status: SessionActivity["status"],
): SessionActivity {
  const signal: ActivitySignal = {
    source: "index",
    status,
    observedAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    recordId: `activity:${id}`,
    localSessionId: id,
    status,
    updatedAt: signal.observedAt,
    signals: [signal],
    provenance: "derived",
  };
}

const fakeActivity: ActivityManager = {
  async getSessionActivity(sessionId: string): Promise<SessionActivity | null> {
    return activity(sessionId, "running");
  },
  async listActivity(): Promise<readonly SessionActivity[]> {
    return [activity("local-stream", "running")];
  },
  async recordSignal(): Promise<void> {
    return;
  },
};

async function firstEvent(
  iterable: AsyncIterable<ServerEventEnvelope<string, unknown>>,
  controller: AbortController,
): Promise<ServerEventEnvelope<string, unknown>> {
  const iterator = iterable[Symbol.asyncIterator]();
  const next = await iterator.next();
  controller.abort();
  await iterator.return?.();
  if (next.done === true) {
    throw new Error("expected event");
  }
  return next.value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("event stream service", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-event-streams-"));
    await mkdir(join(testDir, "data"), { recursive: true });
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
    await mkdir(join(testDir, "cursor", "projects"), { recursive: true });
    repo = new SessionIndexRepository(join(testDir, "data", "state.db"));
  });

  afterEach(async () => {
    repo.close();
    if (previousCursorHome === undefined) {
      delete process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
    } else {
      process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test("streams transcript-backed session events from start offsets", async () => {
    const transcriptPath = join(testDir, "session.jsonl");
    await writeFile(
      transcriptPath,
      `${transcriptLine("user", "hello")}\n${transcriptLine("assistant", "world")}\n`,
      "utf8",
    );
    repo.upsert({
      recordId: "rec-stream",
      localSessionId: "local-stream",
      identityState: "transcript_only",
      workspaceSlug: workspaceSlugFromPath(resolve(testDir)),
      workspacePath: resolve(testDir),
      transcriptPath,
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
      source: "unknown",
      status: "unknown",
    });
    const controller = new AbortController();
    const service = createEventStreamService({
      sessions: repo,
      activity: fakeActivity,
      pollMs: 5,
      now: () => "2026-05-07T00:00:00.000Z",
    });
    const event = await firstEvent(
      service.watchSession(
        "local-stream",
        normalizeServerEventStreamOptions({
          replay: "none",
          startOffset: 0,
          heartbeatMs: 50,
        }),
        controller.signal,
      ),
      controller,
    );
    expect(event.event).toBe("session.user_message");
    expect(
      (
        event.payload as {
          readonly message: { readonly displayText: string };
        }
      ).message.displayText,
    ).toBe("hello");
  });

  test("emits pending and materialized events for chat-only sessions", async () => {
    const pending = repo.insertPendingChatRecord(
      "chat-stream",
      resolve(testDir),
    );
    const service = createEventStreamService({
      sessions: repo,
      activity: fakeActivity,
      pollMs: 5,
      now: () => "2026-05-07T00:00:00.000Z",
    });
    const controller = new AbortController();
    const iterator = service
      .watchSession(
        "chat-stream",
        normalizeServerEventStreamOptions({
          replay: "none",
          startOffset: 0,
          heartbeatMs: 50,
        }),
        controller.signal,
      )
      [Symbol.asyncIterator]();

    expect((await iterator.next()).value?.event).toBe("session.pending");

    const transcriptPath = join(testDir, "materialized.jsonl");
    await writeFile(
      transcriptPath,
      `${transcriptLine("user", "later")}\n`,
      "utf8",
    );
    repo.upsert({
      ...pending,
      identityState: "linked",
      localSessionId: "materialized",
      transcriptPath,
      materializedAt: "2026-05-07T00:00:01.000Z",
    });
    const materialized = await iterator.next();
    controller.abort();
    await iterator.return?.();
    expect(materialized.value?.event).toBe("session.materialized");
  });

  test("emits activity, group, and queue progress snapshots", async () => {
    const group: GroupRecord = {
      name: "g",
      workspaces: [resolve(testDir)],
      lifecycleState: "active",
      lastRun: {
        id: "run-g",
        status: "running",
        startedAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
        workspaces: [
          {
            workspace: resolve(testDir),
            localSessionId: "local-stream",
            status: "pending",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
      },
    };
    const queue: QueueRecord = {
      name: "q",
      workspace: resolve(testDir),
      lifecycleState: "active",
      items: [
        {
          id: "item-1",
          prompt: "prompt",
          status: "pending",
          mode: "auto",
          createdAt: "2026-05-07T00:00:00.000Z",
          localSessionId: "local-stream",
        },
      ],
    };
    const service = createEventStreamService({
      sessions: repo,
      activity: fakeActivity,
      getGroup: async () => group,
      getQueue: async () => queue,
      pollMs: 5,
      now: () => "2026-05-07T00:00:00.000Z",
    });

    const activityController = new AbortController();
    expect(
      (
        await firstEvent(
          service.watchActivity(
            undefined,
            normalizeServerEventStreamOptions({ replay: "none" }),
            activityController.signal,
          ),
          activityController,
        )
      ).event,
    ).toBe("activity.updated");

    const groupController = new AbortController();
    expect(
      (
        await firstEvent(
          service.watchGroup(
            "g",
            normalizeServerEventStreamOptions({ replay: "none" }),
            groupController.signal,
          ),
          groupController,
        )
      ).event,
    ).toBe("group.progress");

    const queueController = new AbortController();
    expect(
      (
        await firstEvent(
          service.watchQueue(
            "q",
            normalizeServerEventStreamOptions({ replay: "none" }),
            queueController.signal,
          ),
          queueController,
        )
      ).event,
    ).toBe("queue.progress");
  });

  test("uses broker latest replay and lastEventId filtering for stream topics", async () => {
    let observedAt = "2026-05-07T00:00:00.000Z";
    const brokeredActivity: ActivityManager = {
      async getSessionActivity(
        sessionId: string,
      ): Promise<SessionActivity | null> {
        return {
          ...activity(sessionId, "running"),
          updatedAt: observedAt,
          signals: [
            {
              source: "index",
              status: "running",
              observedAt,
            },
          ],
        };
      },
      async listActivity(): Promise<readonly SessionActivity[]> {
        return [
          {
            ...activity("local-stream", "running"),
            updatedAt: observedAt,
            signals: [
              {
                source: "index",
                status: "running",
                observedAt,
              },
            ],
          },
        ];
      },
      async recordSignal(): Promise<void> {
        return;
      },
    };
    const service = createEventStreamService({
      sessions: repo,
      activity: brokeredActivity,
      pollMs: 5,
      now: () => observedAt,
    });
    const initialController = new AbortController();
    const initial = await firstEvent(
      service.watchActivity(
        undefined,
        normalizeServerEventStreamOptions({
          replay: "none",
          heartbeatMs: 50,
        }),
        initialController.signal,
      ),
      initialController,
    );

    const replayController = new AbortController();
    const replayed = await firstEvent(
      service.watchActivity(
        undefined,
        normalizeServerEventStreamOptions({
          replay: "latest",
          heartbeatMs: 50,
        }),
        replayController.signal,
      ),
      replayController,
    );
    expect(replayed.id).toBe(initial.id);

    const filteredController = new AbortController();
    const filteredIterator = service
      .watchActivity(
        undefined,
        normalizeServerEventStreamOptions({
          replay: "latest",
          lastEventId: initial.id,
          heartbeatMs: 50,
        }),
        filteredController.signal,
      )
      [Symbol.asyncIterator]();
    const pending = filteredIterator.next();
    await delay(10);
    observedAt = "2026-05-07T00:00:01.000Z";
    const filtered = await pending;
    filteredController.abort();
    await filteredIterator.return?.();
    expect(filtered.value?.id).toBe("activity:all:2026-05-07T00:00:01.000Z");
  });
});
