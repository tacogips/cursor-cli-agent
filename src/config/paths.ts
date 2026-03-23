import { homedir } from "node:os";
import { join, resolve } from "node:path";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export function getDataDir(): string {
  const override = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
  if (override !== undefined && override.length > 0) {
    return expandHome(override);
  }
  return join(homedir(), ".local/share/cursor-cli-agent");
}

export function getConfigDir(): string {
  const override = process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
  if (override !== undefined && override.length > 0) {
    return expandHome(override);
  }
  return join(homedir(), ".config/cursor-cli-agent");
}

export function getCursorHome(): string {
  const override = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
  if (override !== undefined && override.length > 0) {
    return expandHome(override);
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
