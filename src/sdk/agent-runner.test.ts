import { describe, expect, test } from "bun:test";

import { createAgentRunnerFacade } from "./agent-runner";
import type { CursorAgentStreamingProcess } from "../cursor/process-runner";

function fakeProcess(lines: readonly string[]): CursorAgentStreamingProcess {
  let cancelled = false;
  return {
    done: new Promise((resolve) => {
      queueMicrotask(() => {
        resolve({
          code: cancelled ? null : 0,
          signal: cancelled ? "SIGTERM" : null,
          stdout: lines.join("\n"),
          stderr: "",
        });
      });
    }),
    async cancel(): Promise<void> {
      cancelled = true;
    },
    async interrupt(): Promise<void> {
      cancelled = true;
    },
  };
}

describe("SDK agent runner facade", () => {
  test("streams normalized AgentEvent values and completion result", async () => {
    const lines = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        cwd: "/tmp/workspace",
        session_id: "s1",
      }),
      JSON.stringify({
        type: "result",
        session_id: "s1",
        is_error: false,
        result: "done",
      }),
    ];
    const runner = createAgentRunnerFacade({
      startHeadless: (_opts, onLine) => {
        for (const line of lines) {
          onLine(line);
        }
        return fakeProcess(lines);
      },
    });

    const running = runner.start({
      cwd: "/tmp/workspace",
      prompt: "continue",
    });
    const events = [];
    for await (const event of running.messages()) {
      events.push(event);
    }
    const result = await running.waitForCompletion();

    expect(events.map((event) => event.type)).toEqual([
      "session.started",
      "session.completed",
    ]);
    expect(result.sessionId).toBe("s1");
    expect(result.exitCode).toBe(0);
  });
});
