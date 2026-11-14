// @bun
// src/sdk/tool-registry.ts
class ToolRegistryError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "ToolRegistryError";
  }
}
function normalizeToolName(name) {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new ToolRegistryError("tool name is required", "invalid_name");
  }
  return normalized;
}
function tool(config) {
  const name = normalizeToolName(config.name);
  return {
    name,
    ...config.description !== undefined ? { description: config.description } : {},
    ...config.inputSchema !== undefined ? { inputSchema: config.inputSchema } : {},
    async run(input, context) {
      return await config.run(input, context);
    }
  };
}

class ToolRegistry {
  tools = new Map;
  register(registeredTool) {
    const name = normalizeToolName(registeredTool.name);
    if (this.tools.has(name)) {
      throw new ToolRegistryError(`tool already registered: ${name}`, "duplicate_tool");
    }
    this.tools.set(name, {
      ...registeredTool,
      name
    });
  }
  get(name) {
    const normalized = normalizeToolName(name);
    return this.tools.get(normalized) ?? null;
  }
  list() {
    return [...this.tools.values()].map((registeredTool) => ({
      name: registeredTool.name,
      ...registeredTool.description !== undefined ? { description: registeredTool.description } : {},
      ...registeredTool.inputSchema !== undefined ? { inputSchema: registeredTool.inputSchema } : {}
    })).sort((left, right) => left.name.localeCompare(right.name));
  }
  async run(name, input, context) {
    const registered = this.get(name);
    if (registered === null) {
      throw new ToolRegistryError(`tool not found: ${name}`, "not_found");
    }
    return await registered.run(input, context);
  }
}
function createToolRegistry(tools = []) {
  const registry = new ToolRegistry;
  for (const registeredTool of tools) {
    registry.register(registeredTool);
  }
  return registry;
}

// src/sdk/testing.ts
function createMockAgentEventStream(events = []) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  }();
}
function createMockCursorRunningAgent(options) {
  const events = options.events ?? [];
  const result = options.result ?? {
    sessionId: options.sessionId,
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    events
  };
  return {
    sessionId: options.sessionId,
    messages: () => createMockAgentEventStream(events),
    waitForCompletion: () => Promise.resolve(result),
    cancel: () => Promise.resolve(),
    interrupt: () => Promise.resolve()
  };
}
function emptyBookmarkSearch(query, options) {
  return {
    query,
    hits: [],
    total: 0,
    ...options?.limit !== undefined ? { limit: options.limit } : {}
  };
}
function createMockCursorAgentSdk(input = {}) {
  const sessions = new Map;
  const groups = new Map;
  const queues = new Map;
  const bookmarks = new Map;
  const defaultRunner = createMockCursorRunningAgent({
    sessionId: "mock-session"
  });
  return {
    sessions: {
      list: async () => [...sessions.values()],
      get: async (sessionId) => sessions.get(sessionId) ?? null,
      refresh: async () => [...sessions.values()],
      ...input.sessions
    },
    search: {
      sessions: async (options) => ({
        query: options.query,
        filters: options.filters ?? {},
        sessions: [],
        total: 0,
        offset: options.offset,
        limit: options.limit,
        provenance: "index"
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
        timedOut: false
      }),
      ...input.search
    },
    groups: {
      list: async () => [...groups.values()],
      get: async (name) => groups.get(name) ?? null,
      create: async (name) => {
        const record = {
          name,
          workspaces: [],
          lifecycleState: "active"
        };
        groups.set(name, record);
        return record;
      },
      addWorkspace: async (name, workspace) => {
        const current = groups.get(name);
        const record = {
          name,
          workspaces: [...current?.workspaces ?? [], workspace],
          lifecycleState: current?.lifecycleState ?? "active"
        };
        groups.set(name, record);
        return record;
      },
      removeWorkspace: async (name, workspace) => {
        const current = groups.get(name);
        const record = {
          name,
          workspaces: (current?.workspaces ?? []).filter((w) => w !== workspace),
          lifecycleState: current?.lifecycleState ?? "active"
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
      ...input.groups
    },
    queues: {
      list: async () => [...queues.values()],
      get: async (name) => queues.get(name) ?? null,
      create: async (name, workspace) => {
        const record = {
          name,
          workspace,
          lifecycleState: "active",
          items: []
        };
        queues.set(name, record);
        return record;
      },
      addItem: async (name) => queues.get(name) ?? makeEmptyQueue(name),
      updateItem: async (name, itemId, patch) => {
        const current = queues.get(name) ?? makeEmptyQueue(name);
        const record = {
          ...current,
          items: current.items.map((item) => item.id === itemId ? {
            ...item,
            ...patch.prompt !== undefined ? { prompt: patch.prompt } : {},
            ...patch.status !== undefined ? { status: patch.status } : {}
          } : item)
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
        const record = {
          ...current,
          items: [...without.slice(0, to), item, ...without.slice(to)]
        };
        queues.set(name, record);
        return record;
      },
      setItemMode: async (name, itemId, mode) => {
        const current = queues.get(name) ?? makeEmptyQueue(name);
        const record = {
          ...current,
          items: current.items.map((item) => item.id === itemId ? { ...item, mode } : item)
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
      ...input.queues
    },
    bookmarks: {
      add: async (bookmarkInput) => {
        const now = "2026-05-07T00:00:00.000Z";
        const record = {
          id: `bookmark-${bookmarks.size + 1}`,
          type: bookmarkInput.type,
          sessionId: bookmarkInput.sessionId,
          ...bookmarkInput.messageId !== undefined ? { messageId: bookmarkInput.messageId } : {},
          ...bookmarkInput.fromMessageId !== undefined ? { fromMessageId: bookmarkInput.fromMessageId } : {},
          ...bookmarkInput.toMessageId !== undefined ? { toMessageId: bookmarkInput.toMessageId } : {},
          name: bookmarkInput.name,
          ...bookmarkInput.description !== undefined ? { description: bookmarkInput.description } : {},
          tags: bookmarkInput.tags ?? [],
          createdAt: now,
          updatedAt: now
        };
        bookmarks.set(record.id, record);
        return record;
      },
      list: async (filter) => [...bookmarks.values()].filter((bookmark) => filter?.sessionId === undefined || bookmark.sessionId === filter.sessionId),
      show: async (id) => bookmarks.get(id) ?? null,
      delete: async (id) => bookmarks.delete(id),
      search: async (query, options) => emptyBookmarkSearch(query, options),
      ...input.bookmarks
    },
    files: {
      list: async (sessionId) => ({
        sessionId,
        recordId: sessionId,
        files: [],
        totalFiles: 0,
        provenance: "unknown"
      }),
      snapshots: async (sessionId, options) => ({
        sessionId,
        recordId: sessionId,
        snapshots: [],
        totalSnapshots: 0,
        includeContent: options?.includeContent === true,
        provenance: "unknown"
      }),
      deleted: async (sessionId) => ({
        sessionId,
        recordId: sessionId,
        deletedFiles: [],
        totalDeletedFiles: 0,
        provenance: "unknown"
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
          provenance: "missing_rows"
        },
        needsRebuild: true,
        provenance: "missing_rows"
      }),
      rebuild: async () => ({
        indexedSessions: 0,
        touchedFiles: 0,
        deletedFiles: 0,
        snapshots: 0,
        skippedSessions: 0,
        updatedAt: "2026-05-07T00:00:00.000Z",
        provenance: "unknown"
      }),
      ...input.files
    },
    activity: {
      get: async () => null,
      list: async () => [],
      recordSignal: async () => {},
      ...input.activity
    },
    runner: {
      start: () => defaultRunner,
      resume: () => defaultRunner,
      ...input.runner
    },
    tools: {
      registry: createToolRegistry(),
      versions: async () => ({
        packageVersion: "0.0.0-test",
        checkedAt: "2026-05-07T00:00:00.000Z",
        tools: []
      }),
      checkModel: async (options) => ({
        model: options.model,
        binary: {
          name: "cursor-agent",
          command: "cursor-agent",
          version: null,
          status: "not_checked",
          checkedAt: "2026-05-07T00:00:00.000Z"
        },
        auth: {
          status: "unknown",
          detail: "mock",
          provenance: "not_available"
        },
        modelReachability: {
          status: "not_checked",
          probed: false
        },
        checkedAt: "2026-05-07T00:00:00.000Z"
      }),
      usageStats: async () => ({
        totalSessions: 0,
        statusCounts: {},
        activityStatusCounts: {},
        firstSessionDate: null,
        lastComputedDate: "2026-05-07",
        models: {},
        recentDailyActivity: [],
        completenessNotes: [
          "usage event store unavailable; token totals omit persisted wrapper captures"
        ],
        usageTokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        },
        usageSessionsObserved: 0,
        usageTokensByModel: {},
        usageRecentDailyActivity: [],
        usageEvidenceCoverage: {
          sessionsWithUsageEvents: 0,
          knownSessionsWithoutUsageEvents: 0,
          wrapperStartedSessionsWithoutUsageEvents: 0
        },
        usageProvenance: "unavailable"
      }),
      ...input.tools
    }
  };
}
function makeEmptyQueue(name) {
  return {
    name,
    workspace: "",
    lifecycleState: "active",
    items: []
  };
}
export {
  createMockCursorRunningAgent,
  createMockCursorAgentSdk,
  createMockAgentEventStream
};
