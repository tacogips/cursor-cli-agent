import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { queuesJsonPath } from "../config/paths";

export interface QueueItemRecord {
  readonly id: string;
  readonly prompt: string;
  readonly createdAt: string;
}

export interface QueueRecord {
  readonly name: string;
  readonly workspace: string;
  readonly items: readonly QueueItemRecord[];
}

interface FileShape {
  readonly queues: QueueRecord[];
}

async function load(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "queues" in parsed &&
      Array.isArray((parsed as FileShape).queues)
    ) {
      return parsed as FileShape;
    }
  } catch {
    // missing file
  }
  return { queues: [] };
}

async function save(path: string, data: FileShape): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
  const queue: QueueRecord = {
    name,
    workspace: resolve(workspace),
    items: [],
  };
  await save(path, { queues: [...data.queues, queue] });
  return queue;
}

export async function addQueueItem(
  name: string,
  prompt: string,
): Promise<QueueRecord> {
  const path = queuesJsonPath();
  const data = await load(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    throw new Error(`queue '${name}' not found`);
  }
  const q = data.queues[idx];
  if (q === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  const item: QueueItemRecord = {
    id: randomUUID(),
    prompt,
    createdAt: new Date().toISOString(),
  };
  const updated: QueueRecord = {
    name: q.name,
    workspace: q.workspace,
    items: [...q.items, item],
  };
  const queues = [...data.queues];
  queues[idx] = updated;
  await save(path, { queues });
  return updated;
}

export async function removeQueueItem(
  name: string,
  itemId: string,
): Promise<QueueRecord> {
  const path = queuesJsonPath();
  const data = await load(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    throw new Error(`queue '${name}' not found`);
  }
  const q = data.queues[idx];
  if (q === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  const updated: QueueRecord = {
    name: q.name,
    workspace: q.workspace,
    items: q.items.filter((i) => i.id !== itemId),
  };
  const queues = [...data.queues];
  queues[idx] = updated;
  await save(path, { queues });
  return updated;
}
