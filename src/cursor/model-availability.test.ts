import { describe, expect, test } from "bun:test";

import { checkModelAvailability } from "./model-availability";
import type { ToolVersionCommandRunner } from "../types/tool-versions";

describe("model availability", () => {
  test("defaults auth to unknown and skips reachability probe", async () => {
    const report = await checkModelAvailability({
      model: " gpt-test ",
      cursorAgentBinary: "cursor",
      commandRunner: async () => ({
        exitCode: 0,
        signal: null,
        stdout: "cursor-agent 1.0.0\n",
        stderr: "",
        timedOut: false,
      }),
      now: () => new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(report.model).toBe("gpt-test");
    expect(report.auth).toEqual({
      status: "unknown",
      detail:
        "Cursor has no stable local auth-status API; auth was not inferred.",
      provenance: "not_available",
    });
    expect(report.modelReachability).toEqual({
      status: "not_checked",
      probed: false,
    });
  });

  test("runs explicit bounded probe and reports success", async () => {
    const calls: Array<readonly string[]> = [];
    const runner: ToolVersionCommandRunner = async (_command, args) => {
      calls.push(args);
      if (args[0] === "--version") {
        return {
          exitCode: 0,
          signal: null,
          stdout: "cursor-agent 1.0.0\n",
          stderr: "",
          timedOut: false,
        };
      }
      return {
        exitCode: 0,
        signal: null,
        stdout: "OK\n",
        stderr: "",
        timedOut: false,
      };
    };

    const report = await checkModelAvailability({
      model: "gpt-test",
      probe: true,
      cursorAgentBinary: "cursor",
      commandRunner: runner,
    });

    const probeArgs = calls[1];
    expect(probeArgs).toBeDefined();
    expect(probeArgs).not.toContain("--prompt");
    expect(probeArgs).toContain("--model");
    expect(probeArgs?.indexOf("--model")).not.toBe(-1);
    expect(probeArgs?.[probeArgs.indexOf("--model") + 1]).toBe("gpt-test");
    const dash = probeArgs?.indexOf("--") ?? -1;
    expect(dash).not.toBe(-1);
    expect(probeArgs?.[dash + 1]).toBe("Reply with exactly OK.");
    expect(report.modelReachability).toEqual({
      status: "available",
      probed: true,
      output: "OK",
    });
  });

  test("classifies auth-looking probe failures conservatively", async () => {
    const runner: ToolVersionCommandRunner = async (_command, args) => {
      if (args[0] === "--version") {
        return {
          exitCode: 0,
          signal: null,
          stdout: "cursor-agent 1.0.0\n",
          stderr: "",
          timedOut: false,
        };
      }
      return {
        exitCode: 12,
        signal: null,
        stdout: "",
        stderr: "authentication required\n",
        timedOut: false,
      };
    };

    const report = await checkModelAvailability({
      model: "gpt-test",
      probe: true,
      cursorAgentBinary: "cursor",
      commandRunner: runner,
    });

    expect(report.modelReachability).toEqual({
      status: "unavailable",
      probed: true,
      error: "probe failure: authentication required",
    });
  });

  test("rejects blank models", async () => {
    await expect(
      checkModelAvailability({
        model: " ",
        commandRunner: async () => ({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
        }),
      }),
    ).rejects.toThrow("model is required");
  });
});
