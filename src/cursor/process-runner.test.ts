import { EventEmitter } from "node:events";
import type { spawn as nodeSpawn } from "node:child_process";

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  resolveModelForEffort,
  resumeStreaming,
  runHeadlessStreaming,
  setCursorAgentSpawnForTesting,
  startHeadlessStreaming,
} from "./process-runner";

type MockChildProc = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
};

type SpawnMock = typeof nodeSpawn;

function mockSpawnProc(
  onSchedule: (proc: MockChildProc) => void,
): (_cmd: string, args: readonly string[]) => MockChildProc {
  return () => {
    const proc = new EventEmitter() as MockChildProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = mock((_signal?: NodeJS.Signals) => {
      proc.killed = true;
      return true;
    });
    onSchedule(proc);
    return proc;
  };
}

let restoreSpawn: (() => void) | undefined;

function useMockSpawn(
  spawn: (_cmd: string, args: readonly string[]) => MockChildProc,
): void {
  restoreSpawn = setCursorAgentSpawnForTesting(spawn as SpawnMock);
}

describe("cursor process runner", () => {
  afterEach(() => {
    restoreSpawn?.();
    restoreSpawn = undefined;
    mock.restore();
  });

  test("returns raw stdout while streaming lines", async () => {
    useMockSpawn(
      mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.stdout.emit("data", Buffer.from("Waiting for user input\n"));
          proc.emit("close", 0, null);
        });
      }),
    );
    const lines: string[] = [];

    const result = await runHeadlessStreaming(
      { workspace: "/tmp/workspace", prompt: "continue" },
      (line) => {
        lines.push(line);
      },
    );

    expect(lines).toEqual(["Waiting for user input"]);
    expect(result.stdout).toBe("Waiting for user input\n");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  test("flushes final stdout buffer without trailing newline to onLine", async () => {
    useMockSpawn(
      mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.stdout.emit("data", Buffer.from("no newline tail"));
          proc.emit("close", 0, null);
        });
      }),
    );
    const lines: string[] = [];
    await runHeadlessStreaming(
      { workspace: "/tmp/workspace", prompt: "p" },
      (line) => {
        lines.push(line);
      },
    );
    expect(lines).toEqual(["no newline tail"]);
  });

  test("headless spawn uses -- before positional prompt argv, not --prompt", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await runHeadlessStreaming(
      {
        workspace: "/tmp/workspace",
        prompt: "hello world",
        systemPrompt: "system",
        model: "m1",
        streamPartialOutput: true,
      },
      () => {},
    );

    expect(spawnArgs).toBeDefined();
    const args = spawnArgs as string[];
    expect(args.includes("--prompt")).toBe(false);
    const dash = args.indexOf("--");
    expect(dash).toBeGreaterThan(-1);
    expect(args[dash + 1]).toBe("system\n\nhello world");
    expect(args.lastIndexOf("--")).toBe(dash);
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args.indexOf("--model")).toBeGreaterThan(-1);
    expect(args.includes("m1")).toBe(true);
    expect(args.includes("--stream-partial-output")).toBe(true);
  });

  test("headless applies requested effort to effort-bearing model ids", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await runHeadlessStreaming(
      {
        workspace: "/tmp/workspace",
        prompt: "hello world",
        model: "gpt-5.3-codex-low-fast",
        effort: "high",
      },
      () => {},
    );

    const args = spawnArgs as string[];
    const modelIndex = args.indexOf("--model");
    expect(modelIndex).toBeGreaterThan(-1);
    expect(args[modelIndex + 1]).toBe("gpt-5.3-codex-high-fast");
  });

  test("resolves xhigh effort token for GPT-5.5 model ids", () => {
    expect(resolveModelForEffort("gpt-5.5", "xhigh")).toBe(
      "gpt-5.5-extra-high",
    );
    expect(resolveModelForEffort("gpt-5.5-medium-fast", "xhigh")).toBe(
      "gpt-5.5-extra-high-fast",
    );
    expect(resolveModelForEffort("gpt-5.5-extra-high", "medium")).toBe(
      "gpt-5.5-medium",
    );
    expect(resolveModelForEffort("gpt-5.3-codex-medium-fast", "xhigh")).toBe(
      "gpt-5.3-codex-xhigh-fast",
    );
  });

  test("headless preserves extra-high effort token for GPT-5.5 model ids", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await runHeadlessStreaming(
      {
        workspace: "/tmp/workspace",
        prompt: "hello world",
        model: "gpt-5.5-medium-fast",
        effort: "xhigh",
      },
      () => {},
    );

    const args = spawnArgs as string[];
    const modelIndex = args.indexOf("--model");
    expect(modelIndex).toBeGreaterThan(-1);
    expect(args[modelIndex + 1]).toBe("gpt-5.5-extra-high-fast");
  });

  test("headless places promptImages and worktree options before -- and prompt after", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await runHeadlessStreaming(
      {
        workspace: "/tmp/workspace",
        prompt: "go",
        promptImages: { flag: "--image", paths: ["/a.png", "/b.png"] },
        worktree: true,
        worktreeBase: "/tmp/base",
        skipWorktreeSetup: true,
      },
      () => {},
    );

    const args = spawnArgs as string[];
    const dash = args.indexOf("--");
    expect(dash).toBeGreaterThan(-1);
    expect(args.slice(dash)).toEqual(["--", "go"]);
    expect(args.indexOf("--image")).toBeLessThan(dash);
    expect(args.indexOf("/a.png")).toBeLessThan(dash);
    expect(args.indexOf("/b.png")).toBeLessThan(dash);
    expect(args.indexOf("--worktree")).toBeLessThan(dash);
    expect(args.indexOf("--worktree-base")).toBeLessThan(dash);
    expect(args.indexOf("/tmp/base")).toBeLessThan(dash);
    expect(args.indexOf("--skip-worktree-setup")).toBeLessThan(dash);
  });

  test("resume with prompt passes positional argv after option flags with -- terminator", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await resumeStreaming(
      {
        workspace: "/tmp/workspace",
        sessionOrChatId: "sess-99",
        prompt: "continue please",
        systemPrompt: "system",
        model: "m2",
        effort: "xhigh",
      },
      () => {},
    );

    expect(spawnArgs).toBeDefined();
    const args = spawnArgs as string[];
    expect(args.includes("--prompt")).toBe(false);
    const modelIndex = args.indexOf("--model");
    expect(modelIndex).toBeGreaterThan(-1);
    expect(args[modelIndex + 1]).toBe("m2-xhigh");
    const resumeAt = args.indexOf("--resume");
    expect(resumeAt).toBeGreaterThan(-1);
    expect(args[resumeAt + 1]).toBe("sess-99");
    const dash = args.indexOf("--");
    expect(dash).toBeGreaterThan(resumeAt);
    expect(args[dash + 1]).toBe("system\n\ncontinue please");
  });

  test("resume without prompt does not add a trailing -- terminator", async () => {
    let spawnArgs: readonly string[] | undefined;
    useMockSpawn((_cmd: string, args: readonly string[]) => {
      spawnArgs = args;
      return mockSpawnProc((proc) => {
        process.nextTick(() => {
          proc.emit("close", 0, null);
        });
      })(_cmd, args);
    });
    await resumeStreaming(
      {
        workspace: "/tmp/workspace",
        sessionOrChatId: "sess-empty",
      },
      () => {},
    );
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs as string[]).not.toContain("--");
  });

  test("startHeadlessStreaming cancel invokes kill with SIGTERM", async () => {
    const killSpy = mock((_signal?: NodeJS.Signals) => true);
    let hooked: MockChildProc | undefined;
    useMockSpawn(() => {
      const proc = new EventEmitter() as MockChildProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = killSpy;
      hooked = proc;
      process.nextTick(() => {
        proc.emit("close", 0, null);
      });
      return proc;
    });
    const ctl = startHeadlessStreaming(
      { workspace: "/tmp/workspace", prompt: "x" },
      () => {},
    );
    await ctl.cancel();
    expect(hooked).toBeDefined();
    expect(killSpy.mock.calls).toEqual([["SIGTERM"]]);
    await ctl.done;
  });

  test("startHeadlessStreaming interrupt invokes kill with SIGINT", async () => {
    const killSpy = mock((_signal?: NodeJS.Signals) => true);
    let hooked: MockChildProc | undefined;
    useMockSpawn(() => {
      const proc = new EventEmitter() as MockChildProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = killSpy;
      hooked = proc;
      process.nextTick(() => {
        proc.emit("close", 0, null);
      });
      return proc;
    });
    const ctl = startHeadlessStreaming(
      { workspace: "/tmp/workspace", prompt: "x" },
      () => {},
    );
    await ctl.interrupt();
    expect(hooked).toBeDefined();
    expect(killSpy.mock.calls).toEqual([["SIGINT"]]);
    await ctl.done;
  });
});
