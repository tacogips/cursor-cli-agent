import { afterEach, describe, expect, test } from "bun:test";

import { getConfigDir, getCursorHome, getDataDir } from "./paths";

const ENV_KEYS = [
  "CURSOR_CLI_AGENT_DATA_DIR",
  "CURSOR_CLI_AGENT_CONFIG_DIR",
  "CURSOR_CLI_AGENT_CURSOR_HOME",
] as const;

const previousEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function clearPathEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function restorePathEnv(): void {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("config path environment overrides", () => {
  afterEach(() => {
    restorePathEnv();
  });

  test("uses CURSOR_CLI_AGENT_* overrides", () => {
    clearPathEnv();
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = "/tmp/cursor-data";
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = "/tmp/cursor-config";
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = "/tmp/cursor-home";

    expect(getDataDir()).toBe("/tmp/cursor-data");
    expect(getConfigDir()).toBe("/tmp/cursor-config");
    expect(getCursorHome()).toBe("/tmp/cursor-home");
  });
});
