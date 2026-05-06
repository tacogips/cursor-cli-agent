import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { groupsJsonPath } from "../config/paths";
import type {
  GroupLifecycleState,
  GroupRecord,
  GroupRunRecord,
  GroupRunStatus,
  GroupRunWorkspaceRecord,
  GroupRunWorkspaceStatus,
} from "../types/group";

export type { GroupRecord } from "../types/group";

export interface GroupStoreUpdate {
  readonly lifecycleState?: GroupLifecycleState;
  readonly lastRun?: GroupRunRecord;
}

interface FileShape {
  readonly groups: GroupRecord[];
}

const WORKSPACE_STATUSES = new Set<GroupRunWorkspaceStatus>([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "unknown",
]);

const RUN_STATUSES = new Set<GroupRunStatus>([
  "running",
  "completed",
  "failed",
  "paused",
]);

const LIFECYCLE_STATES = new Set<GroupLifecycleState>([
  "active",
  "paused",
  "completed",
  "failed",
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

function normalizeWorkspace(
  raw: unknown,
  fallbackWorkspace: string,
  now: string,
): GroupRunWorkspaceRecord {
  if (!isRecord(raw)) {
    return {
      workspace: fallbackWorkspace,
      status: "unknown",
      updatedAt: now,
    };
  }
  const status = raw["status"];
  const exitCode = raw["exitCode"];
  const localSessionId = readString(raw["localSessionId"]);
  const cursorChatId = readString(raw["cursorChatId"]);
  const startedAt = readString(raw["startedAt"]);
  const completedAt = readString(raw["completedAt"]);
  return {
    workspace: readString(raw["workspace"]) ?? fallbackWorkspace,
    ...(localSessionId !== undefined ? { localSessionId } : {}),
    ...(cursorChatId !== undefined ? { cursorChatId } : {}),
    status:
      typeof status === "string" &&
      WORKSPACE_STATUSES.has(status as GroupRunWorkspaceStatus)
        ? (status as GroupRunWorkspaceStatus)
        : "unknown",
    ...(startedAt !== undefined ? { startedAt } : {}),
    updatedAt: readString(raw["updatedAt"]) ?? now,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(typeof exitCode === "number" ? { exitCode } : {}),
  };
}

function normalizeRun(
  raw: unknown,
  workspaces: readonly string[],
  now: string,
): GroupRunRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const status = raw["status"];
  if (
    typeof status !== "string" ||
    !RUN_STATUSES.has(status as GroupRunStatus)
  ) {
    return undefined;
  }
  const rawWorkspaces = Array.isArray(raw["workspaces"])
    ? raw["workspaces"]
    : [];
  const promptPreview = readString(raw["promptPreview"]);
  const completedAt = readString(raw["completedAt"]);
  return {
    id: readString(raw["id"]) ?? `legacy-${now}`,
    status: status as GroupRunStatus,
    ...(promptPreview !== undefined ? { promptPreview } : {}),
    startedAt: readString(raw["startedAt"]) ?? now,
    updatedAt: readString(raw["updatedAt"]) ?? now,
    ...(completedAt !== undefined ? { completedAt } : {}),
    workspaces: rawWorkspaces.map((workspace, index) =>
      normalizeWorkspace(
        workspace,
        workspaces[index] ?? `workspace-${index}`,
        now,
      ),
    ),
  };
}

function normalizeGroup(raw: unknown, now: string): GroupRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const name = readString(raw["name"]);
  if (name === undefined) {
    return undefined;
  }
  const workspaces = readStringArray(raw["workspaces"]);
  const lifecycleState = raw["lifecycleState"];
  const normalizedLifecycle =
    typeof lifecycleState === "string" &&
    LIFECYCLE_STATES.has(lifecycleState as GroupLifecycleState)
      ? (lifecycleState as GroupLifecycleState)
      : "active";
  const lastRun = normalizeRun(raw["lastRun"], workspaces, now);
  const createdAt = readString(raw["createdAt"]);
  const updatedAt = readString(raw["updatedAt"]);
  return {
    name,
    workspaces,
    lifecycleState: normalizedLifecycle,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(lastRun !== undefined ? { lastRun } : {}),
  };
}

async function load(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "groups" in parsed &&
      Array.isArray((parsed as { readonly groups?: unknown }).groups)
    ) {
      const now = new Date().toISOString();
      return {
        groups: (parsed as { readonly groups: readonly unknown[] }).groups
          .map((group) => normalizeGroup(group, now))
          .filter((group): group is GroupRecord => group !== undefined),
      };
    }
  } catch {
    // missing file
  }
  return { groups: [] };
}

async function save(path: string, data: FileShape): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function listGroups(): Promise<readonly GroupRecord[]> {
  const data = await load(groupsJsonPath());
  return data.groups;
}

export async function getGroup(name: string): Promise<GroupRecord | undefined> {
  const data = await load(groupsJsonPath());
  return data.groups.find((g) => g.name === name);
}

export async function createGroup(name: string): Promise<GroupRecord> {
  const path = groupsJsonPath();
  const data = await load(path);
  if (data.groups.some((g) => g.name === name)) {
    throw new Error(`group '${name}' already exists`);
  }
  const now = new Date().toISOString();
  const group: GroupRecord = {
    name,
    workspaces: [],
    lifecycleState: "active",
    createdAt: now,
    updatedAt: now,
  };
  const next: FileShape = { groups: [...data.groups, group] };
  await save(path, next);
  return group;
}

export async function addWorkspaceToGroup(
  name: string,
  workspace: string,
): Promise<GroupRecord> {
  const path = groupsJsonPath();
  const data = await load(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    throw new Error(`group '${name}' not found`);
  }
  const g = data.groups[idx];
  if (g === undefined) {
    throw new Error(`group '${name}' not found`);
  }
  if (g.workspaces.includes(workspace)) {
    return g;
  }
  const updated: GroupRecord = {
    ...g,
    workspaces: [...g.workspaces, workspace],
    updatedAt: new Date().toISOString(),
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save(path, { groups });
  return updated;
}

export async function removeWorkspaceFromGroup(
  name: string,
  workspace: string,
): Promise<GroupRecord> {
  const path = groupsJsonPath();
  const data = await load(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    throw new Error(`group '${name}' not found`);
  }
  const g = data.groups[idx];
  if (g === undefined) {
    throw new Error(`group '${name}' not found`);
  }
  const updated: GroupRecord = {
    ...g,
    workspaces: g.workspaces.filter((w) => w !== workspace),
    updatedAt: new Date().toISOString(),
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save(path, { groups });
  return updated;
}

export async function deleteGroup(
  name: string,
): Promise<GroupRecord | undefined> {
  const path = groupsJsonPath();
  const data = await load(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    return undefined;
  }
  const deleted = data.groups[idx];
  if (deleted === undefined) {
    return undefined;
  }
  await save(path, {
    groups: data.groups.filter((g) => g.name !== name),
  });
  return deleted;
}

export async function pauseGroup(
  name: string,
): Promise<GroupRecord | undefined> {
  return updateGroupRun(name, { lifecycleState: "paused" });
}

export async function resumeGroup(
  name: string,
): Promise<GroupRecord | undefined> {
  return updateGroupRun(name, { lifecycleState: "active" });
}

export async function updateGroupRun(
  name: string,
  update: GroupStoreUpdate,
): Promise<GroupRecord | undefined> {
  const path = groupsJsonPath();
  const data = await load(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    return undefined;
  }
  const current = data.groups[idx];
  if (current === undefined) {
    return undefined;
  }
  const updated: GroupRecord = {
    ...current,
    ...(update.lifecycleState !== undefined
      ? { lifecycleState: update.lifecycleState }
      : {}),
    ...(update.lastRun !== undefined ? { lastRun: update.lastRun } : {}),
    updatedAt: new Date().toISOString(),
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save(path, { groups });
  return updated;
}
