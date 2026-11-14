import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { sessionReplayForksJsonPath } from "../config/paths";
import type { ReplayForkProvenance } from "../types/session-replay-fork";

interface StoredReplayForks {
  readonly forks: readonly ReplayForkProvenance[];
}

export interface ReplayForkStore {
  record(provenance: ReplayForkProvenance): Promise<void>;
  findByReplayForkId(id: string): Promise<ReplayForkProvenance | undefined>;
  listForSource(
    sourceRecordId: string,
  ): Promise<readonly ReplayForkProvenance[]>;
}

function isSerializedProvenance(value: unknown): value is ReplayForkProvenance {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r["replayForkId"] === "string" &&
    typeof r["sourceRecordId"] === "string" &&
    typeof r["promptHash"] === "string" &&
    typeof r["createdAt"] === "string" &&
    r["semantics"] === "replay_not_native_fork"
  );
}

async function load(path: string): Promise<StoredReplayForks> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { forks: [] };
    }
    const forksRaw = (parsed as Record<string, unknown>)["forks"];
    if (!Array.isArray(forksRaw)) {
      return { forks: [] };
    }
    return { forks: forksRaw.filter(isSerializedProvenance) };
  } catch {
    return { forks: [] };
  }
}

async function save(path: string, data: StoredReplayForks): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export function createReplayForkStore(
  path = sessionReplayForksJsonPath(),
): ReplayForkStore {
  return {
    async record(provenance: ReplayForkProvenance): Promise<void> {
      const data = await load(path);
      // Replace any existing entry with the same replayForkId (upsert).
      const deduped = data.forks.filter(
        (f) => f.replayForkId !== provenance.replayForkId,
      );
      await save(path, { forks: [...deduped, provenance] });
    },

    async findByReplayForkId(
      id: string,
    ): Promise<ReplayForkProvenance | undefined> {
      const data = await load(path);
      return data.forks.find((f) => f.replayForkId === id);
    },

    async listForSource(
      sourceRecordId: string,
    ): Promise<readonly ReplayForkProvenance[]> {
      const data = await load(path);
      return data.forks.filter((f) => f.sourceRecordId === sourceRecordId);
    },
  };
}
