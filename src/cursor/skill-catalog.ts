import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { getCursorHome } from "../config/paths";
import type { CursorSkillRecord, SkillScope } from "../types/skill-record";

export interface SkillCatalogOptions {
  /** When set, also scan `<projectRoot>/.cursor/skills`. */
  readonly projectRoot?: string;
}

function skillRoots(
  opts: SkillCatalogOptions,
): { root: string; scope: SkillScope }[] {
  const cursor = getCursorHome();
  const out: { root: string; scope: SkillScope }[] = [
    { root: join(cursor, "skills-cursor"), scope: "builtin" },
    { root: join(cursor, "skills"), scope: "user" },
  ];
  if (opts.projectRoot !== undefined && opts.projectRoot.length > 0) {
    out.push({
      root: join(opts.projectRoot, ".cursor/skills"),
      scope: "project",
    });
  }
  return out;
}

async function listSkillFilesUnder(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(p);
      } else if (ent.isFile() && ent.name === "SKILL.md") {
        out.push(p);
      }
    }
  };
  await walk(root);
  return out;
}

/**
 * Parse minimal YAML frontmatter from a SKILL.md body.
 * Recognizes `name`, `description`, and `disableModelInvocation` when present.
 */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
} {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { disableModelInvocation: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { disableModelInvocation: false };
  }
  const fm = lines.slice(1, end).join("\n");
  let name: string | undefined;
  let description: string | undefined;
  let disableModelInvocation = false;
  for (const raw of fm.split("\n")) {
    const line = raw.trim();
    const mName = /^name:\s*(.+)$/.exec(line);
    if (mName !== null) {
      name = stripQuotes(mName[1]?.trim() ?? "");
    }
    const mDesc = /^description:\s*(.+)$/.exec(line);
    if (mDesc !== null) {
      description = stripQuotes(mDesc[1]?.trim() ?? "");
    }
    const mDis = /^disableModelInvocation:\s*(true|false)\s*$/i.exec(line);
    if (mDis !== null) {
      disableModelInvocation = mDis[1]?.toLowerCase() === "true";
    }
  }
  return {
    ...(name !== undefined && name.length > 0 ? { name } : {}),
    ...(description !== undefined && description.length > 0
      ? { description }
      : {}),
    disableModelInvocation,
  };
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function fallbackName(skillPath: string): string {
  const parent = basename(dirname(skillPath));
  if (parent.length > 0) {
    return parent;
  }
  return basename(skillPath, ".md");
}

/**
 * Read all discoverable skills from built-in, user, and optional project roots.
 * Never writes; `skills-cursor` is read for metadata only.
 */
export async function listSkillRecords(
  opts: SkillCatalogOptions = {},
): Promise<CursorSkillRecord[]> {
  const records: CursorSkillRecord[] = [];
  for (const { root, scope } of skillRoots(opts)) {
    const files = await listSkillFilesUnder(root);
    for (const path of files) {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkillFrontmatter(text);
      const name =
        parsed.name !== undefined && parsed.name.length > 0
          ? parsed.name
          : fallbackName(path);
      records.push({
        name,
        scope,
        path,
        disableModelInvocation: parsed.disableModelInvocation,
        ...(parsed.description !== undefined && parsed.description.length > 0
          ? { description: parsed.description }
          : {}),
      });
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

export async function findSkillByName(
  name: string,
  opts: SkillCatalogOptions = {},
): Promise<CursorSkillRecord | undefined> {
  const rows = await listSkillRecords(opts);
  return rows.find(
    (r) =>
      r.name === name ||
      basename(dirname(r.path)) === name ||
      basename(dirname(r.path)).toLowerCase() === name.toLowerCase(),
  );
}
