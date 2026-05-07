import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { queuesJsonPath } from "../config/paths";
import type {
  QueueItemMode,
  QueueItemRecord,
  QueueItemStatus,
  QueueLifecycleState,
  QueueRecord,
  QueueRunRecord,
  QueueRunStatus,
} from "../types/queue";

export type { QueueRecord } from "../types/queue";

export interface QueueItemPatch {
  readonly prompt?: string;
  readonly status?: QueueItemStatus;
  readonly mode?: QueueItemMode;
}

export interface QueueStoreUpdate {
  readonly lifecycleState?: QueueLifecycleState;
  readonly stopRequestedAt?: string | undefined;
  readonly lastRun?: QueueRunRecord;
  readonly items?: readonly QueueItemRecord[];
}

interface FileShape {
  readonly queues: QueueRecord[];
}

const LIFECYCLE_STATES = new Set<QueueLifecycleState>([
  "active",
  "paused",
  "completed",
  "failed",
  "stopped",
]);

const ITEM_STATUSES = new Set<QueueItemStatus>([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

const ITEM_MODES = new Set<QueueItemMode>(["auto", "manual"]);

const RUN_STATUSES = new Set<QueueRunStatus>([
  "running",
  "completed",
  "failed",
  "paused",
  "stopped",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeItem(raw: unknown, now: string): QueueItemRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = readString(raw["id"]);
  const prompt = readString(raw["prompt"]);
  if (id === undefined || prompt === undefined) {
    return undefined;
  }
  const status = raw["status"];
  const mode = raw["mode"];
  const localSessionId = readString(raw["localSessionId"]);
  const cursorChatId = readString(raw["cursorChatId"]);
  const updatedAt = readString(raw["updatedAt"]);
  const startedAt = readString(raw["startedAt"]);
  const completedAt = readString(raw["completedAt"]);
  const result = isRecord(raw["result"]) ? raw["result"] : undefined;
  const exitCode = result?.["exitCode"];
  return {
    id,
    prompt,
    status:
      typeof status === "string" && ITEM_STATUSES.has(status as QueueItemStatus)
        ? (status as QueueItemStatus)
        : "pending",
    mode:
      typeof mode === "string" && ITEM_MODES.has(mode as QueueItemMode)
        ? (mode as QueueItemMode)
        : "auto",
    createdAt: readString(raw["createdAt"]) ?? now,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(localSessionId !== undefined ? { localSessionId } : {}),
    ...(cursorChatId !== undefined ? { cursorChatId } : {}),
    ...(exitCode === null || typeof exitCode === "number"
      ? { result: { exitCode } }
      : {}),
  };
}

function normalizeRun(raw: unknown, now: string): QueueRunRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const status = raw["status"];
  if (
    typeof status !== "string" ||
    !RUN_STATUSES.has(status as QueueRunStatus)
  ) {
    return undefined;
  }
  const completedAt = readString(raw["completedAt"]);
  const currentItemId = readString(raw["currentItemId"]);
  const stoppedAt = readString(raw["stoppedAt"]);
  return {
    id: readString(raw["id"]) ?? `legacy-${now}`,
    status: status as QueueRunStatus,
    startedAt: readString(raw["startedAt"]) ?? now,
    updatedAt: readString(raw["updatedAt"]) ?? now,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(currentItemId !== undefined ? { currentItemId } : {}),
    completedItemIds: readStringArray(raw["completedItemIds"]),
    failedItemIds: readStringArray(raw["failedItemIds"]),
    pendingItemIds: readStringArray(raw["pendingItemIds"]),
    ...(stoppedAt !== undefined ? { stoppedAt } : {}),
  };
}

function normalizeQueue(raw: unknown, now: string): QueueRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const name = readString(raw["name"]);
  const workspace = readString(raw["workspace"]);
  if (name === undefined || workspace === undefined) {
    return undefined;
  }
  const lifecycleState = raw["lifecycleState"];
  const createdAt = readString(raw["createdAt"]);
  const updatedAt = readString(raw["updatedAt"]);
  const stopRequestedAt = readString(raw["stopRequestedAt"]);
  const items = Array.isArray(raw["items"])
    ? raw["items"]
        .map((item) => normalizeItem(item, now))
        .filter((item): item is QueueItemRecord => item !== undefined)
    : [];
  const lastRun = normalizeRun(raw["lastRun"], now);
  return {
    name,
    workspace,
    lifecycleState:
      typeof lifecycleState === "string" &&
      LIFECYCLE_STATES.has(lifecycleState as QueueLifecycleState)
        ? (lifecycleState as QueueLifecycleState)
        : "active",
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(stopRequestedAt !== undefined ? { stopRequestedAt } : {}),
    items,
    ...(lastRun !== undefined ? { lastRun } : {}),
  };
}

async function load(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      isRecord(parsed) &&
      "queues" in parsed &&
      Array.isArray((parsed as { readonly queues?: unknown }).queues)
    ) {
      const now = new Date().toISOString();
      return {
        queues: (parsed as { readonly queues: readonly unknown[] }).queues
          .map((queue) => normalizeQueue(queue, now))
          .filter((queue): queue is QueueRecord => queue !== undefined),
      };
    }
  } catch {
    // missing or unreadable file
  }
  return { queues: [] };
}

async function save(path: string, data: FileShape): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function mutateQueue(
  name: string,
  update: (queue: QueueRecord, now: string) => QueueRecord,
): Promise<QueueRecord | undefined> {
  const path = queuesJsonPath();
  const data = await load(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    return undefined;
  }
  const current = data.queues[idx];
  if (current === undefined) {
    return undefined;
  }
  const updated = update(current, new Date().toISOString());
  const queues = [...data.queues];
  queues[idx] = updated;
  await save(path, { queues });
  return updated;
}

export async function listQueues(): Promise<readonly QueueRecord[]> {
  const data = await load(queuesJsonPath());
  return data.queues;
}

export async function getQueue(name: string): Promise<QueueRecord | undefined> {
  const data = await load(queuesJsonPath());
  return data.queues.find((q) => q.name === name);
}

export async function createQueue(
  name: string,
  workspace: string,
): Promise<QueueRecord> {
  const path = queuesJsonPath();
  const data = await load(path);
  if (data.queues.some((q) => q.name === name)) {
    throw new Error(`queue '${name}' already exists`);
  }
  const now = new Date().toISOString();
  const queue: QueueRecord = {
    name,
    workspace: resolve(workspace),
    lifecycleState: "active",
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  await save(path, { queues: [...data.queues, queue] });
  return queue;
}

export async function addQueueItem(
  name: string,
  prompt: string,
): Promise<QueueRecord> {
  const updated = await mutateQueue(name, (q, now) => ({
    ...q,
    lifecycleState:
      q.lifecycleState === "completed" ? "active" : q.lifecycleState,
    updatedAt: now,
    items: [
      ...q.items,
      {
        id: randomUUID(),
        prompt,
        status: "pending",
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      },
    ],
  }));
  if (updated === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  return updated;
}

export async function removeQueueItem(
  name: string,
  itemId: string,
): Promise<QueueRecord> {
  const updated = await mutateQueue(name, (q, now) => ({
    ...q,
    updatedAt: now,
    items: q.items.filter((i) => i.id !== itemId),
  }));
  if (updated === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  return updated;
}

export async function deleteQueue(
  name: string,
): Promise<QueueRecord | undefined> {
  const path = queuesJsonPath();
  const data = await load(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    return undefined;
  }
  const deleted = data.queues[idx];
  if (deleted === undefined) {
    return undefined;
  }
  await save(path, { queues: data.queues.filter((q) => q.name !== name) });
  return deleted;
}

export async function pauseQueue(
  name: string,
): Promise<QueueRecord | undefined> {
  return updateQueueRun(name, { lifecycleState: "paused" });
}

export async function resumeQueue(
  name: string,
): Promise<QueueRecord | undefined> {
  return updateQueueRun(name, {
    lifecycleState: "active",
    stopRequestedAt: undefined,
  });
}

export async function requestQueueStop(
  name: string,
): Promise<QueueRecord | undefined> {
  const queue = await getQueue(name);
  if (queue === undefined) {
    return undefined;
  }
  if (queue.lastRun?.status !== "running") {
    return queue;
  }
  return updateQueueRun(name, {
    lifecycleState: "stopped",
    stopRequestedAt: new Date().toISOString(),
  });
}

export async function updateQueueItem(
  name: string,
  itemId: string,
  patch: QueueItemPatch,
): Promise<QueueRecord | undefined> {
  return mutateQueue(name, (q, now) => ({
    ...q,
    updatedAt: now,
    items: q.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      const status = patch.status ?? item.status;
      const updated: QueueItemRecord = {
        id: item.id,
        prompt: patch.prompt ?? item.prompt,
        status,
        mode: patch.mode ?? item.mode,
        createdAt: item.createdAt,
        updatedAt: now,
      };
      if (status === "pending") {
        return updated;
      }
      return {
        ...updated,
        ...(item.startedAt !== undefined ? { startedAt: item.startedAt } : {}),
        ...(item.completedAt !== undefined
          ? { completedAt: item.completedAt }
          : {}),
        ...(item.localSessionId !== undefined
          ? { localSessionId: item.localSessionId }
          : {}),
        ...(item.cursorChatId !== undefined
          ? { cursorChatId: item.cursorChatId }
          : {}),
        ...(item.result !== undefined ? { result: item.result } : {}),
      };
    }),
  }));
}

export async function moveQueueItem(
  name: string,
  from: number,
  to: number,
): Promise<QueueRecord | undefined> {
  return mutateQueue(name, (q, now) => {
    const item = q.items[from];
    if (item === undefined) {
      return q;
    }
    const without = q.items.filter((_, index) => index !== from);
    return {
      ...q,
      updatedAt: now,
      items: [...without.slice(0, to), item, ...without.slice(to)],
    };
  });
}

export async function updateQueueRun(
  name: string,
  update: QueueStoreUpdate,
): Promise<QueueRecord | undefined> {
  return mutateQueue(name, (q, now) => {
    const updated: QueueRecord = {
      name: q.name,
      workspace: q.workspace,
      lifecycleState: update.lifecycleState ?? q.lifecycleState,
      ...(q.createdAt !== undefined ? { createdAt: q.createdAt } : {}),
      updatedAt: now,
      ...(update.lastRun !== undefined
        ? { lastRun: update.lastRun }
        : q.lastRun !== undefined
          ? { lastRun: q.lastRun }
          : {}),
      items: update.items ?? q.items,
    };
    const hasStopRequest = Object.hasOwn(update, "stopRequestedAt");
    if (!hasStopRequest && q.stopRequestedAt !== undefined) {
      return { ...updated, stopRequestedAt: q.stopRequestedAt };
    }
    if (hasStopRequest && update.stopRequestedAt !== undefined) {
      return { ...updated, stopRequestedAt: update.stopRequestedAt };
    }
    return updated;
  });
}
