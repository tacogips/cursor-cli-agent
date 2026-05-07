import type { AgentEvent } from "../types/agent-event";
import type {
  BookmarkFilter,
  BookmarkRecord,
  BookmarkSearchOptions,
  BookmarkSearchResult,
  CreateBookmarkInput,
} from "../types/bookmark";
import type { GroupRecord } from "../types/group";
import type { QueueRecord } from "../types/queue";
import type { CursorSessionRecord } from "../types/session-record";
import type {
  CursorAgentRunResult,
  CursorAgentSdk,
  CursorRunningAgent,
} from "./types";

export interface MockCursorRunningAgentOptions {
  readonly sessionId: string;
  readonly events?: readonly AgentEvent[];
  readonly result?: CursorAgentRunResult;
  readonly autoComplete?: boolean;
}

export function createMockAgentEventStream(
  events: readonly AgentEvent[] = [],
): AsyncGenerator<AgentEvent, void, undefined> {
  return (async function* (): AsyncGenerator<AgentEvent, void, undefined> {
    for (const event of events) {
      yield event;
    }
  })();
}

export function createMockCursorRunningAgent(
  options: MockCursorRunningAgentOptions,
): CursorRunningAgent {
  const events = options.events ?? [];
  const result =
    options.result ??
    ({
      sessionId: options.sessionId,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      events,
    } satisfies CursorAgentRunResult);
  return {
    sessionId: options.sessionId,
    messages: () => createMockAgentEventStream(events),
    waitForCompletion: () => Promise.resolve(result),
    cancel: () => Promise.resolve(),
    interrupt: () => Promise.resolve(),
  };
}

function emptyBookmarkSearch(
  query: string,
  options: BookmarkSearchOptions | undefined,
): BookmarkSearchResult {
  return {
    query,
    hits: [],
    total: 0,
    ...(options?.limit !== undefined ? { limit: options.limit } : {}),
  };
}

export function createMockCursorAgentSdk(
  input: Partial<CursorAgentSdk> = {},
): CursorAgentSdk {
  const sessions = new Map<string, CursorSessionRecord>();
  const groups = new Map<string, GroupRecord>();
  const queues = new Map<string, QueueRecord>();
  const bookmarks = new Map<string, BookmarkRecord>();
  const defaultRunner = createMockCursorRunningAgent({
    sessionId: "mock-session",
  });

  return {
    sessions: {
      list: async () => [...sessions.values()],
      get: async (sessionId) => sessions.get(sessionId) ?? null,
      refresh: async () => [...sessions.values()],
      ...input.sessions,
    },
    search: {
      sessions: async (options) => ({
        query: options.query,
        filters: options.filters ?? {},
        sessions: [],
        total: 0,
        offset: options.offset,
        limit: options.limit,
        provenance: "index",
      }),
      transcripts: async (options) => ({
        query: options.query,
        hits: [],
        total: 0,
        offset: options.offset,
        limit: options.limit,
        scannedSessions: 0,
        scannedBytes: 0,
        scannedEvents: 0,
        truncated: false,
        timedOut: false,
      }),
      ...input.search,
    },
    groups: {
      list: async () => [...groups.values()],
      get: async (name) => groups.get(name) ?? null,
      create: async (name) => {
        const record: GroupRecord = {
          name,
          workspaces: [],
          lifecycleState: "active",
        };
        groups.set(name, record);
        return record;
      },
      addWorkspace: async (name, workspace) => {
        const current = groups.get(name);
        const record: GroupRecord = {
          name,
          workspaces: [...(current?.workspaces ?? []), workspace],
          lifecycleState: current?.lifecycleState ?? "active",
        };
        groups.set(name, record);
        return record;
      },
      removeWorkspace: async (name, workspace) => {
        const current = groups.get(name);
        const record: GroupRecord = {
          name,
          workspaces: (current?.workspaces ?? []).filter(
            (w) => w !== workspace,
          ),
          lifecycleState: current?.lifecycleState ?? "active",
        };
        groups.set(name, record);
        return record;
      },
      delete: async (name) => {
        const record = groups.get(name) ?? null;
        groups.delete(name);
        return record;
      },
      pause: async (name) => groups.get(name) ?? null,
      resume: async (name) => groups.get(name) ?? null,
      progress: async () => null,
      ...input.groups,
    },
    queues: {
      list: async () => [...queues.values()],
      get: async (name) => queues.get(name) ?? null,
      create: async (name, workspace) => {
        const record: QueueRecord = {
          name,
          workspace,
          lifecycleState: "active",
          items: [],
        };
        queues.set(name, record);
        return record;
      },
      addItem: async (name) => queues.get(name) ?? makeEmptyQueue(name),
      updateItem: async (name, itemId, patch) => {
        const current = queues.get(name) ?? makeEmptyQueue(name);
        const record: QueueRecord = {
          ...current,
          items: current.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  ...(patch.prompt !== undefined
                    ? { prompt: patch.prompt }
                    : {}),
                  ...(patch.status !== undefined
                    ? { status: patch.status }
                    : {}),
                }
              : item,
          ),
        };
        queues.set(name, record);
        return record;
      },
      removeItem: async (name) => queues.get(name) ?? makeEmptyQueue(name),
      moveItem: async (name, from, to) => {
        const current = queues.get(name) ?? makeEmptyQueue(name);
        const item = current.items[from];
        if (item === undefined) {
          return current;
        }
        const without = current.items.filter((_, index) => index !== from);
        const record: QueueRecord = {
          ...current,
          items: [...without.slice(0, to), item, ...without.slice(to)],
        };
        queues.set(name, record);
        return record;
      },
      setItemMode: async (name, itemId, mode) => {
        const current = queues.get(name) ?? makeEmptyQueue(name);
        const record: QueueRecord = {
          ...current,
          items: current.items.map((item) =>
            item.id === itemId ? { ...item, mode } : item,
          ),
        };
        queues.set(name, record);
        return record;
      },
      delete: async (name) => {
        const record = queues.get(name) ?? null;
        queues.delete(name);
        return record;
      },
      pause: async (name) => queues.get(name) ?? null,
      resume: async (name) => queues.get(name) ?? null,
      requestStop: async (name) => queues.get(name) ?? null,
      progress: async () => null,
      ...input.queues,
    },
    bookmarks: {
      add: async (bookmarkInput: CreateBookmarkInput) => {
        const now = "2026-05-07T00:00:00.000Z";
        const record: BookmarkRecord = {
          id: `bookmark-${bookmarks.size + 1}`,
          type: bookmarkInput.type,
          sessionId: bookmarkInput.sessionId,
          ...(bookmarkInput.messageId !== undefined
            ? { messageId: bookmarkInput.messageId }
            : {}),
          ...(bookmarkInput.fromMessageId !== undefined
            ? { fromMessageId: bookmarkInput.fromMessageId }
            : {}),
          ...(bookmarkInput.toMessageId !== undefined
            ? { toMessageId: bookmarkInput.toMessageId }
            : {}),
          name: bookmarkInput.name,
          ...(bookmarkInput.description !== undefined
            ? { description: bookmarkInput.description }
            : {}),
          tags: bookmarkInput.tags ?? [],
          createdAt: now,
          updatedAt: now,
        };
        bookmarks.set(record.id, record);
        return record;
      },
      list: async (filter?: BookmarkFilter) =>
        [...bookmarks.values()].filter(
          (bookmark) =>
            filter?.sessionId === undefined ||
            bookmark.sessionId === filter.sessionId,
        ),
      show: async (id) => bookmarks.get(id) ?? null,
      delete: async (id) => bookmarks.delete(id),
      search: async (query, options) => emptyBookmarkSearch(query, options),
      ...input.bookmarks,
    },
    files: {
      list: async (sessionId) => ({
        sessionId,
        recordId: sessionId,
        files: [],
        totalFiles: 0,
        provenance: "unknown",
      }),
      snapshots: async (sessionId, options) => ({
        sessionId,
        recordId: sessionId,
        snapshots: [],
        totalSnapshots: 0,
        includeContent: options?.includeContent === true,
        provenance: "unknown",
      }),
      deleted: async (sessionId) => ({
        sessionId,
        recordId: sessionId,
        deletedFiles: [],
        totalDeletedFiles: 0,
        provenance: "unknown",
      }),
      find: async (path) => ({
        queryPath: path,
        entries: [],
        totalEntries: 0,
        index: {
          indexedSessions: 0,
          touchedFiles: 0,
          deletedFiles: 0,
          snapshots: 0,
          provenance: "missing_rows",
        },
        needsRebuild: true,
        provenance: "missing_rows",
      }),
      rebuild: async () => ({
        indexedSessions: 0,
        touchedFiles: 0,
        deletedFiles: 0,
        snapshots: 0,
        skippedSessions: 0,
        updatedAt: "2026-05-07T00:00:00.000Z",
        provenance: "unknown",
      }),
      ...input.files,
    },
    activity: {
      get: async () => null,
      list: async () => [],
      recordSignal: async () => {},
      ...input.activity,
    },
    runner: {
      start: () => defaultRunner,
      resume: () => defaultRunner,
      ...input.runner,
    },
  };
}

function makeEmptyQueue(name: string): QueueRecord {
  return {
    name,
    workspace: "",
    lifecycleState: "active",
    items: [],
  };
}
