import {
  createActivityManager,
  type ActivityManager,
} from "../activity/manager";
import { tailTranscript } from "../cursor/transcript-tail";
import { deriveGroupProgressSnapshot } from "../group/progress";
import { getGroup as defaultGetGroup } from "../persistence/groups-store";
import { getQueue as defaultGetQueue } from "../persistence/queues-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import { deriveQueueProgressSnapshot } from "../queue/progress";
import type {
  ServerEventEnvelope,
  ServerEventStreamOptions,
} from "../types/server-event";
import {
  createServerEventEnvelope,
  type ServerEventName,
} from "../types/server-event";
import type { GroupRecord } from "../types/group";
import type { QueueRecord } from "../types/queue";
import type { CursorSessionRecord } from "../types/session-record";
import { createEventBroker, type EventBroker } from "./event-broker";
import { HttpError } from "./http-errors";

export interface EventStreamService {
  watchSession(
    id: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchActivity(
    id: string | undefined,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchGroup(
    name: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
  watchQueue(
    name: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>>;
}

export interface EventStreamDependencies {
  readonly sessions: SessionIndexRepository;
  readonly activity?: ActivityManager;
  readonly broker?: EventBroker;
  readonly getGroup?: (name: string) => Promise<GroupRecord | undefined>;
  readonly getQueue?: (name: string) => Promise<QueueRecord | undefined>;
  readonly now?: () => string;
  readonly pollMs?: number;
}

interface TopicPublisher {
  readonly controller: AbortController;
  refs: number;
}

const DEFAULT_STREAM_POLL_MS = 1_000;

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function sessionEventId(
  session: CursorSessionRecord,
  byteOffset: number,
): string {
  return `session:${session.recordId}:${byteOffset}`;
}

function transcriptEventName(role: "user" | "assistant"): ServerEventName {
  return role === "user" ? "session.user_message" : "session.assistant_message";
}

async function* pollLatest<T>(
  signal: AbortSignal,
  pollMs: number,
  load: () => Promise<T>,
): AsyncGenerator<T, void, undefined> {
  while (!signal.aborted) {
    yield await load();
    await waitForPoll(pollMs, signal);
  }
}

export function createEventStreamService(
  dependencies: EventStreamDependencies,
): EventStreamService {
  const activity =
    dependencies.activity ??
    createActivityManager({ sessions: dependencies.sessions });
  const broker = dependencies.broker ?? createEventBroker();
  const getGroup = dependencies.getGroup ?? defaultGetGroup;
  const getQueue = dependencies.getQueue ?? defaultGetQueue;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pollMs = dependencies.pollMs ?? DEFAULT_STREAM_POLL_MS;
  const publishersByTopic = new Map<string, TopicPublisher>();

  function brokeredTopic(
    topic: string,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
    source: (
      publisherSignal: AbortSignal,
    ) => AsyncIterable<ServerEventEnvelope<string, unknown>>,
  ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
    const subscription = broker.subscribe(topic, options, signal);
    let publisher = publishersByTopic.get(topic);
    if (publisher === undefined) {
      const controller = new AbortController();
      publisher = { controller, refs: 0 };
      publishersByTopic.set(topic, publisher);
      void (async () => {
        try {
          for await (const event of source(controller.signal)) {
            if (controller.signal.aborted) {
              break;
            }
            broker.publish(topic, event);
          }
        } catch {
          // Keep stream publisher failures from becoming unhandled promise rejections.
        } finally {
          publishersByTopic.delete(topic);
        }
      })();
    }
    publisher.refs += 1;

    return (async function* (): AsyncGenerator<
      ServerEventEnvelope<string, unknown>,
      void,
      undefined
    > {
      try {
        for await (const event of subscription) {
          if (event.id !== options.lastEventId) {
            yield event;
          }
        }
      } finally {
        publisher.refs -= 1;
        if (publisher.refs <= 0) {
          publisher.controller.abort();
          publishersByTopic.delete(topic);
        }
      }
    })();
  }

  function sessionTopic(id: string, options: ServerEventStreamOptions): string {
    return `session:${id}:${options.startOffset ?? "tail"}`;
  }

  async function resolveSession(
    id: string,
  ): Promise<CursorSessionRecord | undefined> {
    await dependencies.sessions.importTranscriptsFromFilesystem();
    return dependencies.sessions.resolveSessionKey(id);
  }

  async function* watchMaterializingSession(
    id: string,
    pendingSession: CursorSessionRecord,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncGenerator<ServerEventEnvelope<string, unknown>, void, undefined> {
    yield createServerEventEnvelope(
      "session.pending",
      { session: pendingSession },
      {
        id: `session:${pendingSession.recordId}:pending`,
        emittedAt: now(),
      },
    );

    while (!signal.aborted) {
      await waitForPoll(pollMs, signal);
      const materialized = await resolveSession(id);
      if (
        materialized?.transcriptPath === undefined ||
        materialized.recordId !== pendingSession.recordId
      ) {
        continue;
      }
      yield createServerEventEnvelope(
        "session.materialized",
        { previousSession: pendingSession, session: materialized },
        {
          id: `session:${materialized.recordId}:materialized`,
          emittedAt: now(),
        },
      );
      yield* watchTranscriptSession(materialized, options, signal);
      return;
    }
  }

  async function* watchTranscriptSession(
    session: CursorSessionRecord,
    options: ServerEventStreamOptions,
    signal: AbortSignal,
  ): AsyncGenerator<ServerEventEnvelope<string, unknown>, void, undefined> {
    if (session.transcriptPath === undefined) {
      return;
    }
    for await (const event of tailTranscript(session.transcriptPath, {
      ...(options.startOffset !== undefined
        ? { startOffset: options.startOffset }
        : {}),
      pollMs,
      signal,
    })) {
      yield createServerEventEnvelope(
        transcriptEventName(event.line.role),
        {
          session,
          byteOffset: event.byteOffset,
          byteLength: event.byteLength,
          message: event.line.message,
        },
        {
          id: sessionEventId(session, event.byteOffset),
          emittedAt: now(),
        },
      );
    }
  }

  return {
    async *watchSession(
      id: string,
      options: ServerEventStreamOptions,
      signal: AbortSignal,
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      const session = await resolveSession(id);
      if (session === undefined) {
        throw new HttpError("NOT_FOUND", "session not found");
      }
      yield* brokeredTopic(sessionTopic(id, options), options, signal, (s) =>
        session.transcriptPath === undefined
          ? watchMaterializingSession(id, session, options, s)
          : watchTranscriptSession(session, options, s),
      );
    },

    async *watchActivity(
      id: string | undefined,
      options: ServerEventStreamOptions,
      signal: AbortSignal,
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      if (
        id !== undefined &&
        (await activity.getSessionActivity(id)) === null
      ) {
        throw new HttpError("NOT_FOUND", "session not found");
      }
      yield* brokeredTopic(`activity:${id ?? "all"}`, options, signal, (s) =>
        (async function* (): AsyncGenerator<
          ServerEventEnvelope<string, unknown>,
          void,
          undefined
        > {
          for await (const activities of pollLatest(s, pollMs, async () => {
            if (id === undefined) {
              return activity.listActivity();
            }
            const one = await activity.getSessionActivity(id);
            if (one === null) {
              throw new HttpError("NOT_FOUND", "session not found");
            }
            return [one];
          })) {
            yield createServerEventEnvelope(
              "activity.updated",
              {
                ...(id !== undefined ? { sessionId: id } : {}),
                activities,
                provenance: "derived",
              },
              { id: `activity:${id ?? "all"}:${now()}`, emittedAt: now() },
            );
          }
        })(),
      );
    },

    async *watchGroup(
      name: string,
      options: ServerEventStreamOptions,
      signal: AbortSignal,
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      if ((await getGroup(name)) === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      yield* brokeredTopic(`group:${name}`, options, signal, (s) =>
        (async function* (): AsyncGenerator<
          ServerEventEnvelope<string, unknown>,
          void,
          undefined
        > {
          for await (const snapshot of pollLatest(s, pollMs, async () => {
            const group = await getGroup(name);
            if (group === undefined) {
              throw new HttpError("NOT_FOUND", "group not found");
            }
            return deriveGroupProgressSnapshot(group, {
              getActivity: activity.getSessionActivity,
              now,
            });
          })) {
            yield createServerEventEnvelope("group.progress", snapshot, {
              id: `group:${name}:${snapshot.updatedAt}`,
              emittedAt: now(),
            });
          }
        })(),
      );
    },

    async *watchQueue(
      name: string,
      options: ServerEventStreamOptions,
      signal: AbortSignal,
    ): AsyncIterable<ServerEventEnvelope<string, unknown>> {
      if ((await getQueue(name)) === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      yield* brokeredTopic(`queue:${name}`, options, signal, (s) =>
        (async function* (): AsyncGenerator<
          ServerEventEnvelope<string, unknown>,
          void,
          undefined
        > {
          for await (const snapshot of pollLatest(s, pollMs, async () => {
            const queue = await getQueue(name);
            if (queue === undefined) {
              throw new HttpError("NOT_FOUND", "queue not found");
            }
            return deriveQueueProgressSnapshot(queue, {
              getActivity: activity.getSessionActivity,
              now,
            });
          })) {
            yield createServerEventEnvelope("queue.progress", snapshot, {
              id: `queue:${name}:${snapshot.updatedAt}`,
              emittedAt: now(),
            });
          }
        })(),
      );
    },
  };
}
