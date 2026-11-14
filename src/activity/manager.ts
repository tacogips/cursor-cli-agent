import { stat } from "node:fs/promises";

import {
  createActivityStore,
  type ActivityStore,
} from "../persistence/activity-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import type {
  ActivitySignal,
  ActivityStatus,
  SessionActivity,
} from "../types/activity";
import type {
  CursorSessionRecord,
  SessionStatus,
} from "../types/session-record";

export interface ActivityListOptions {
  readonly status?: ActivityStatus;
  readonly limit?: number;
}

export interface ActivityManager {
  getSessionActivity(sessionId: string): Promise<SessionActivity | null>;
  listActivity(
    options?: ActivityListOptions,
  ): Promise<readonly SessionActivity[]>;
  recordSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}

export interface ActivityManagerOptions {
  readonly sessions: SessionIndexRepository;
  readonly store?: ActivityStore;
}

const STATUS_TIE_BREAKER: Record<ActivityStatus, number> = {
  failed: 6,
  waiting_trust: 5,
  waiting_input: 4,
  running: 3,
  completed: 2,
  idle: 1,
};

function indexStatusToActivity(status: SessionStatus): ActivityStatus {
  switch (status) {
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
    case "unknown":
      return "idle";
  }
}

function compareSignalsForProvenance(
  a: ActivitySignal,
  b: ActivitySignal,
): number {
  const observed = b.observedAt.localeCompare(a.observedAt);
  if (observed !== 0) {
    return observed;
  }
  return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
}

function signalSelectionRank(signal: ActivitySignal): number {
  if (
    signal.source === "process" ||
    signal.source === "stream" ||
    signal.source === "stderr" ||
    signal.source === "stdout"
  ) {
    return 40;
  }
  if (signal.source === "index") {
    if (
      signal.status === "running" ||
      signal.status === "failed" ||
      signal.status === "completed"
    ) {
      return 30;
    }
    return 20;
  }
  if (signal.source === "transcript") {
    return 10;
  }
  return 0;
}

function compareSignalsForSelection(
  a: ActivitySignal,
  b: ActivitySignal,
): number {
  if (a.status !== b.status) {
    if (a.status === "idle") {
      return 1;
    }
    if (b.status === "idle") {
      return -1;
    }
  }
  if (a.observedAt === b.observedAt) {
    const rank = signalSelectionRank(b) - signalSelectionRank(a);
    if (rank !== 0) {
      return rank;
    }
    return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
  }
  const observed = b.observedAt.localeCompare(a.observedAt);
  if (observed !== 0) {
    return observed;
  }
  const rank = signalSelectionRank(b) - signalSelectionRank(a);
  if (rank !== 0) {
    return rank;
  }
  return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
}

function dedupeSignals(
  signals: readonly ActivitySignal[],
): readonly ActivitySignal[] {
  const seen = new Set<string>();
  const deduped: ActivitySignal[] = [];
  for (const signal of [...signals].sort(compareSignalsForProvenance)) {
    const key = `${signal.source}\0${signal.status}\0${signal.observedAt}\0${signal.detail ?? ""}\0${signal.attachments?.map((a) => a.id).join(",") ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(signal);
  }
  return deduped;
}

function identityKeys(record: CursorSessionRecord): readonly string[] {
  return [
    record.recordId,
    ...(record.localSessionId !== undefined ? [record.localSessionId] : []),
    ...(record.cursorChatId !== undefined ? [record.cursorChatId] : []),
  ];
}

async function transcriptSignal(
  record: CursorSessionRecord,
): Promise<ActivitySignal | null> {
  if (record.transcriptPath === undefined) {
    return null;
  }
  try {
    const info = await stat(record.transcriptPath);
    return {
      source: "transcript",
      status: "idle",
      observedAt: info.mtime.toISOString(),
      detail: record.transcriptPath,
    };
  } catch {
    return null;
  }
}

async function collectSignals(
  store: ActivityStore,
  record: CursorSessionRecord,
): Promise<readonly ActivitySignal[]> {
  const storedNested = await Promise.all(
    identityKeys(record).map(async (key) => {
      try {
        return await store.getSignals(key);
      } catch {
        return [];
      }
    }),
  );
  const fromTranscript = await transcriptSignal(record);
  return dedupeSignals([
    ...storedNested.flat(),
    {
      source: "index",
      status: indexStatusToActivity(record.status),
      observedAt: record.updatedAt,
      detail: `index status ${record.status}`,
    },
    ...(fromTranscript !== null ? [fromTranscript] : []),
  ]);
}

function toActivityRecord(
  record: CursorSessionRecord,
  signals: readonly ActivitySignal[],
): SessionActivity {
  const selected =
    [...signals].sort(compareSignalsForSelection)[0] ??
    ({
      source: "index",
      status: "idle",
      observedAt: record.updatedAt,
      detail: "default idle fallback",
    } satisfies ActivitySignal);
  return {
    recordId: `activity:${record.recordId}`,
    ...(record.localSessionId !== undefined
      ? { localSessionId: record.localSessionId }
      : {}),
    ...(record.cursorChatId !== undefined
      ? { cursorChatId: record.cursorChatId }
      : {}),
    status: selected.status,
    updatedAt: selected.observedAt,
    signals: signals.length > 0 ? signals : [selected],
    provenance: "derived",
  };
}

export function createActivityManager(
  options: ActivityManagerOptions,
): ActivityManager {
  const store = options.store ?? createActivityStore();
  return {
    async getSessionActivity(
      sessionId: string,
    ): Promise<SessionActivity | null> {
      const record = options.sessions.resolveSessionKey(sessionId);
      if (record === undefined) {
        return null;
      }
      return toActivityRecord(record, await collectSignals(store, record));
    },

    async listActivity(
      listOptions?: ActivityListOptions,
    ): Promise<readonly SessionActivity[]> {
      const scanLimit = Math.max(listOptions?.limit ?? 1000, 1000);
      const rows = options.sessions.listSessions(scanLimit);
      const activities = await Promise.all(
        rows.map(async (record) =>
          toActivityRecord(record, await collectSignals(store, record)),
        ),
      );
      const filtered =
        listOptions?.status === undefined
          ? activities
          : activities.filter(
              (activity) => activity.status === listOptions.status,
            );
      return listOptions?.limit === undefined
        ? filtered
        : filtered.slice(0, listOptions.limit);
    },

    async recordSignal(
      sessionId: string,
      signal: ActivitySignal,
    ): Promise<void> {
      try {
        await store.appendSignal(sessionId, signal);
      } catch {
        // Activity signals are an optional derived cache; Cursor command
        // execution must not fail because cache persistence is unavailable.
      }
    },
  };
}
