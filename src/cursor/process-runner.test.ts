import { EventEmitter } from "node:events";

import { afterEach, describe, expect, mock, test } from "bun:test";

describe("cursor process runner", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns raw stdout while streaming lines", async () => {
    mock.module("node:child_process", () => ({
      spawn: () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => {
          proc.stdout.emit("data", Buffer.from("Waiting for user input\n"));
          proc.emit("close", 0, null);
        });
        return proc;
      },
    }));
    const { runHeadlessStreaming } = await import("./process-runner");
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
});
