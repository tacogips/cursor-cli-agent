import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { activitySignalsJsonPath } from "../config/paths";
import type { ActivitySignal } from "../types/activity";

interface StoredActivitySignals {
  readonly sessions: Record<string, readonly ActivitySignal[]>;
}

export interface ActivityStore {
  getSignals(sessionId: string): Promise<readonly ActivitySignal[]>;
  appendSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
  pruneSignals(before: string): Promise<number>;
}

export { activitySignalsJsonPath };

function isActivitySignal(value: unknown): value is ActivitySignal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const source = record["source"];
  const status = record["status"];
  return (
    (source === "process" ||
      source === "transcript" ||
      source === "stream" ||
      source === "stderr" ||
      source === "stdout" ||
      source === "index") &&
    (status === "idle" ||
      status === "running" ||
      status === "waiting_trust" ||
      status === "waiting_input" ||
      status === "completed" ||
      status === "failed") &&
    typeof record["observedAt"] === "string" &&
    (record["detail"] === undefined || typeof record["detail"] === "string") &&
    attachmentsFieldOk(record["attachments"])
  );
}

function attachmentsFieldOk(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const p = item as Record<string, unknown>;
    if (typeof p["id"] !== "string") {
      return false;
    }
  }
  return true;
}

async function load(path: string): Promise<StoredActivitySignals> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { sessions: {} };
    }
    const sessions = (parsed as Record<string, unknown>)["sessions"];
    if (typeof sessions !== "object" || sessions === null) {
      return { sessions: {} };
    }
    const entries = Object.entries(sessions as Record<string, unknown>).flatMap(
      ([sessionId, signals]) => {
        if (!Array.isArray(signals)) {
          return [];
        }
        return [[sessionId, signals.filter(isActivitySignal)] as const];
      },
    );
    return { sessions: Object.fromEntries(entries) };
  } catch {
    return { sessions: {} };
  }
}

async function save(path: string, data: StoredActivitySignals): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

function compareSignals(a: ActivitySignal, b: ActivitySignal): number {
  const observed = a.observedAt.localeCompare(b.observedAt);
  if (observed !== 0) {
    return observed;
  }
  return a.status.localeCompare(b.status);
}

export function createActivityStore(
  path = activitySignalsJsonPath(),
): ActivityStore {
  return {
    async getSignals(sessionId: string): Promise<readonly ActivitySignal[]> {
      const data = await load(path);
      return [...(data.sessions[sessionId] ?? [])].sort(compareSignals);
    },

    async appendSignal(
      sessionId: string,
      signal: ActivitySignal,
    ): Promise<void> {
      const data = await load(path);
      const existing = data.sessions[sessionId] ?? [];
      await save(path, {
        sessions: {
          ...data.sessions,
          [sessionId]: [...existing, signal].sort(compareSignals),
        },
      });
    },

    async pruneSignals(before: string): Promise<number> {
      const data = await load(path);
      let pruned = 0;
      const sessions: Record<string, readonly ActivitySignal[]> = {};
      for (const [sessionId, signals] of Object.entries(data.sessions)) {
        const kept = signals.filter((signal) => signal.observedAt >= before);
        pruned += signals.length - kept.length;
        if (kept.length > 0) {
          sessions[sessionId] = kept;
        }
      }
      await save(path, { sessions });
      return pruned;
    },
  };
}
