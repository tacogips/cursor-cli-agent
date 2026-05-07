import type { SessionActivity } from "../types/activity";
import type {
  QueueItemRecord,
  QueueItemStatus,
  QueueProgressSnapshot,
  QueueProgressTotals,
  QueueRecord,
  QueueRunRecord,
} from "../types/queue";

export interface QueueProgressDependencies {
  readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
  readonly now: () => string;
}

const EMPTY_TOTALS: QueueProgressTotals = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  manual: 0,
};

function activityStatusToItemStatus(
  activity: SessionActivity | null,
  persisted: QueueItemStatus,
): QueueItemStatus {
  if (activity === null) {
    return persisted;
  }
  switch (activity.status) {
    case "running":
    case "waiting_trust":
    case "waiting_input":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return persisted;
  }
}

function itemSessionId(item: QueueItemRecord): string | undefined {
  return item.localSessionId ?? item.cursorChatId;
}

function countTotals(items: readonly QueueItemRecord[]): QueueProgressTotals {
  const totals = { ...EMPTY_TOTALS };
  for (const item of items) {
    totals[item.status] += 1;
    if (item.mode === "manual") {
      totals.manual += 1;
    }
  }
  return totals;
}

async function deriveItem(
  item: QueueItemRecord,
  deps: QueueProgressDependencies,
): Promise<QueueItemRecord> {
  const sessionId = itemSessionId(item);
  const activity =
    sessionId !== undefined ? await deps.getActivity(sessionId) : null;
  const status = activityStatusToItemStatus(activity, item.status);
  return {
    ...item,
    status,
    ...(activity?.updatedAt !== undefined
      ? { updatedAt: activity.updatedAt }
      : {}),
  };
}

function deriveRunUpdatedAt(
  run: QueueRunRecord,
  items: readonly QueueItemRecord[],
): string {
  return (
    items
      .map((item) => item.updatedAt)
      .filter((updatedAt): updatedAt is string => updatedAt !== undefined)
      .sort()
      .at(-1) ?? run.updatedAt
  );
}

export async function deriveQueueProgressSnapshot(
  queue: QueueRecord,
  deps: QueueProgressDependencies,
): Promise<QueueProgressSnapshot> {
  const items = await Promise.all(
    queue.items.map((item) => deriveItem(item, deps)),
  );
  const run =
    queue.lastRun === undefined
      ? undefined
      : {
          ...queue.lastRun,
          updatedAt: deriveRunUpdatedAt(queue.lastRun, items),
        };
  return {
    queue: {
      ...queue,
      items,
      ...(run !== undefined ? { lastRun: run } : {}),
    },
    ...(run !== undefined ? { run } : {}),
    totals: countTotals(items),
    provenance: "queue-store+activity",
    updatedAt: run?.updatedAt ?? queue.updatedAt ?? deps.now(),
  };
}
