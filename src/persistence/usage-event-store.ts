import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { usageEventsJsonPath, workspaceSlugFromPath } from "../config/paths";
import type { UsageEventRecord } from "../types/usage-event";

interface StoredUsageEvents {
  readonly events: Record<string, UsageEventRecord>;
}

export interface UsageEventListOptions {
  readonly sessionId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly since?: string;
  readonly until?: string;
}

export interface UsageEventStore {
  listEvents(
    options?: UsageEventListOptions,
  ): Promise<readonly UsageEventRecord[]>;
  upsertEvent(event: UsageEventRecord): Promise<void>;
  upsertEvents(events: readonly UsageEventRecord[]): Promise<void>;
}

export { usageEventsJsonPath };

function isUsageEventRecord(value: unknown): value is UsageEventRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  if (
    typeof r["eventId"] !== "string" ||
    typeof r["sessionId"] !== "string" ||
    typeof r["model"] !== "string" ||
    typeof r["observedAt"] !== "string" ||
    r["source"] !== "stream_result" ||
    r["provenance"] !== "repository_usage_events"
  ) {
    return false;
  }
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
  ] as const) {
    const n = r[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      return false;
    }
  }
  for (const key of [
    "recordId",
    "cursorChatId",
    "workspacePath",
    "workspaceSlug",
  ] as const) {
    const v = r[key];
    if (v !== undefined && typeof v !== "string") {
      return false;
    }
  }
  return true;
}

async function load(path: string): Promise<StoredUsageEvents> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { events: {} };
    }
    const events = (parsed as Record<string, unknown>)["events"];
    if (typeof events !== "object" || events === null) {
      return { events: {} };
    }
    const entries = Object.entries(events as Record<string, unknown>).filter(
      ([, v]) => isUsageEventRecord(v),
    ) as [string, UsageEventRecord][];
    return { events: Object.fromEntries(entries) };
  } catch {
    return { events: {} };
  }
}

async function save(path: string, data: StoredUsageEvents): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

function compareEvents(a: UsageEventRecord, b: UsageEventRecord): number {
  const t = a.observedAt.localeCompare(b.observedAt);
  if (t !== 0) {
    return t;
  }
  return a.eventId.localeCompare(b.eventId);
}

function matchesFilters(
  event: UsageEventRecord,
  options: UsageEventListOptions | undefined,
): boolean {
  if (options === undefined) {
    return true;
  }
  if (
    options.sessionId !== undefined &&
    options.sessionId.length > 0 &&
    event.sessionId !== options.sessionId &&
    event.recordId !== options.sessionId &&
    event.cursorChatId !== options.sessionId
  ) {
    return false;
  }
  if (options.workspaceSlug !== undefined && options.workspaceSlug.length > 0) {
    if (event.workspaceSlug !== options.workspaceSlug) {
      return false;
    }
  }
  if (options.workspacePath !== undefined && options.workspacePath.length > 0) {
    const abs = resolve(options.workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const pathMatches = event.workspacePath === abs;
    const slugMatches = event.workspaceSlug === slug;
    if (!pathMatches && !slugMatches) {
      return false;
    }
  }
  if (options.since !== undefined && event.observedAt < options.since) {
    return false;
  }
  if (options.until !== undefined && event.observedAt > options.until) {
    return false;
  }
  return true;
}

export function createUsageEventStore(
  path = usageEventsJsonPath(),
): UsageEventStore {
  const upsertEventsBatch = async (
    events: readonly UsageEventRecord[],
  ): Promise<void> => {
    if (events.length === 0) {
      return;
    }
    const data = await load(path);
    const merged = { ...data.events };
    for (const event of events) {
      merged[event.eventId] = event;
    }
    await save(path, { events: merged });
  };

  return {
    async listEvents(
      options?: UsageEventListOptions,
    ): Promise<readonly UsageEventRecord[]> {
      const data = await load(path);
      return Object.values(data.events)
        .filter((e) => matchesFilters(e, options))
        .sort(compareEvents);
    },

    upsertEvents: upsertEventsBatch,

    async upsertEvent(event: UsageEventRecord): Promise<void> {
      await upsertEventsBatch([event]);
    },
  };
}
