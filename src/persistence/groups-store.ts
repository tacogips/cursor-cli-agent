import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { groupsJsonPath } from "../config/paths";

export interface GroupRecord {
  readonly name: string;
  readonly workspaces: readonly string[];
}

interface FileShape {
  readonly groups: GroupRecord[];
}

async function load(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "groups" in parsed &&
      Array.isArray((parsed as FileShape).groups)
    ) {
      return parsed as FileShape;
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
  const group: GroupRecord = { name, workspaces: [] };
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
    name: g.name,
    workspaces: [...g.workspaces, workspace],
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
    name: g.name,
    workspaces: g.workspaces.filter((w) => w !== workspace),
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save(path, { groups });
  return updated;
}
