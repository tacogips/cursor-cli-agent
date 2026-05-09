import { homedir } from "node:os";
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

export function getDataDir(): string {
  const override = envOverride("CURSOR_CLI_AGENT_DATA_DIR");
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".local/share/cursor-cli-agent");
}

export function getConfigDir(): string {
  const override = envOverride("CURSOR_CLI_AGENT_CONFIG_DIR");
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".config/cursor-cli-agent");
}

export function getCursorHome(): string {
  const override = envOverride("CURSOR_CLI_AGENT_CURSOR_HOME");
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

export function bookmarksJsonPath(): string {
  return join(getDataDir(), "bookmarks.json");
}

export function activitySignalsJsonPath(): string {
  return join(getDataDir(), "activity-signals.json");
}

export function usageEventsJsonPath(): string {
  return join(getDataDir(), "usage-events.json");
}

export function sessionReplayForksJsonPath(): string {
  return join(getDataDir(), "session-replay-forks.json");
}

export function daemonMetadataPath(): string {
  return join(getConfigDir(), "daemon.json");
}

export function daemonLifecycleLogPath(): string {
  return join(getDataDir(), "daemon.log");
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
