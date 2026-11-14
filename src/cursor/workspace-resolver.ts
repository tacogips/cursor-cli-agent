import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cursorProjectsRoot } from "../config/paths";

const WORKSPACE_PATH_RE = /workspacePath=([^\s]+)/;

/**
 * Best-effort: read project `worker.log` and return the last workspace path seen.
 */
export async function resolveWorkspacePathFromWorkerLog(
  workspaceSlug: string,
): Promise<string | undefined> {
  const logPath = join(cursorProjectsRoot(), workspaceSlug, "worker.log");
  try {
    const text = await readFile(logPath, "utf8");
    let last: string | undefined;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(WORKSPACE_PATH_RE);
      if (m?.[1] !== undefined) {
        last = m[1];
      }
    }
    return last;
  } catch {
    return undefined;
  }
}
