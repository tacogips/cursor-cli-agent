import { describe, expect, test } from "bun:test";

import { getToolVersions, readToolVersion } from "./tool-versions";
import type { ToolVersionCommandRunner } from "../types/tool-versions";

describe("tool version helpers", () => {
  test("returns package version and cursor-agent by default", async () => {
    const runner: ToolVersionCommandRunner = async (command) => ({
      exitCode: 0,
      signal: null,
      stdout: `${command} 9.9.9\nextra\n`,
      stderr: "",
      timedOut: false,
    });

    const report = await getToolVersions({
      cursorAgentBinary: "fake-cursor-agent",
      commandRunner: runner,
      now: () => new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(report.packageVersion).toBe("0.1.0");
    expect(report.tools).toEqual([
      {
        name: "cursor-agent",
        command: "fake-cursor-agent",
        version: "fake-cursor-agent 9.9.9",
        status: "available",
        checkedAt: "2026-05-07T00:00:00.000Z",
      },
    ]);
  });

  test("includes Git and Bun only when requested", async () => {
    const commands: string[] = [];
    const runner: ToolVersionCommandRunner = async (command) => {
      commands.push(command);
      return {
        exitCode: 0,
        signal: null,
        stdout: `${command} version\n`,
        stderr: "",
        timedOut: false,
      };
    };

    const report = await getToolVersions({
      includeGit: true,
      includeBun: true,
      cursorAgentBinary: "cursor",
      gitBinary: "git-custom",
      bunBinary: "bun-custom",
      commandRunner: runner,
    });

    expect(commands).toEqual(["cursor", "git-custom", "bun-custom"]);
    expect(report.tools.map((item) => item.name)).toEqual([
      "cursor-agent",
      "git",
      "bun",
    ]);
  });

  test("returns structured unavailable errors for timeout and empty stdout", async () => {
    const timedOut = await readToolVersion("cursor-agent", "cursor", {
      commandRunner: async () => ({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: true,
        error: "command timed out after 1ms",
      }),
    });
    expect(timedOut.status).toBe("unavailable");
    expect(timedOut.error).toBe("version command timed out");

    const empty = await readToolVersion("cursor-agent", "cursor", {
      commandRunner: async () => ({
        exitCode: 0,
        signal: null,
        stdout: "  \n",
        stderr: "",
        timedOut: false,
      }),
    });
    expect(empty.status).toBe("unavailable");
    expect(empty.error).toBe(
      "version command succeeded but produced no output",
    );
  });
});
