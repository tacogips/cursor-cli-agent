import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function envOverride(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) {
      return expandHome(value);
    }
  }
  return undefined;
}

function preferRenamedDefault(nextPath: string, legacyPath: string): string {
  if (existsSync(nextPath)) {
    return nextPath;
  }
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return nextPath;
}

export function getDataDir(): string {
  const override = envOverride(
    "CURORT_CLI_AGENT_DATA_DIR",
    "CURSOR_CLI_AGENT_DATA_DIR",
  );
  if (override !== undefined) {
    return override;
  }
  return preferRenamedDefault(
    join(homedir(), ".local/share/curort-cli-agent"),
    join(homedir(), ".local/share/cursor-cli-agent"),
  );
}

export function getConfigDir(): string {
  const override = envOverride(
    "CURORT_CLI_AGENT_CONFIG_DIR",
    "CURSOR_CLI_AGENT_CONFIG_DIR",
  );
  if (override !== undefined) {
    return override;
  }
  return preferRenamedDefault(
    join(homedir(), ".config/curort-cli-agent"),
    join(homedir(), ".config/cursor-cli-agent"),
  );
}

export function getCursorHome(): string {
  const override = envOverride(
    "CURORT_CLI_AGENT_CURSOR_HOME",
    "CURSOR_CLI_AGENT_CURSOR_HOME",
  );
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".cursor");
}

export function stateDbPath(): string {
  return join(getDataDir(), "state.db");
}

export function groupsJsonPath(): string {
  return join(getDataDir(), "groups.json");
}

export function queuesJsonPath(): string {
  return join(getDataDir(), "queues.json");
}

export function cursorProjectsRoot(): string {
  return join(getCursorHome(), "projects");
}

/**
 * Cursor-local SQLite used for AI code tracking (enrichment only; transcripts stay canonical).
 */
export function aiTrackingDbPath(): string {
  return join(getCursorHome(), "ai-tracking", "ai-code-tracking.db");
}

/**
 * Cursor uses a slug of the absolute workspace path (slashes to hyphens, drop leading slash).
 */
export function workspaceSlugFromPath(workspacePath: string): string {
  const abs = resolve(workspacePath);
  const trimmed = abs.replace(/^\/+/, "");
  if (trimmed.length === 0) {
    return "workspace";
  }
  return trimmed.replace(/\//g, "-");
}

export function agentTranscriptsDirForWorkspace(workspacePath: string): string {
  const slug = workspaceSlugFromPath(workspacePath);
  return join(cursorProjectsRoot(), slug, "agent-transcripts");
}
