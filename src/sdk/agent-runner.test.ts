import { describe, expect, test } from "bun:test";

import { createAgentRunnerFacade } from "./agent-runner";
import type {
  CursorAgentStreamingProcess,
  HeadlessRunOptions,
  ResumeRunOptions,
} from "../cursor/process-runner";

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

  test("passes effort through to start and resume process options", async () => {
    const starts: HeadlessRunOptions[] = [];
    const resumes: ResumeRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      startHeadless: (opts, onLine) => {
        starts.push(opts);
        onLine(
          JSON.stringify({
            type: "system",
            subtype: "init",
            cwd: opts.workspace,
            session_id: "s1",
          }),
        );
        return fakeProcess([]);
      },
      startResume: (opts, onLine) => {
        resumes.push(opts);
        onLine(
          JSON.stringify({
            type: "system",
            subtype: "init",
            cwd: opts.workspace,
            session_id: opts.sessionOrChatId,
          }),
        );
        return fakeProcess([]);
      },
    });

    await runner
      .start({
        cwd: "/tmp/workspace",
        prompt: "continue",
        model: "gpt-5.3-codex",
        effort: "high",
      })
      .waitForCompletion();
    await runner
      .resume({
        cwd: "/tmp/workspace",
        sessionId: "s1",
        prompt: "again",
        model: "gpt-5.3-codex-low",
        effort: "xhigh",
      })
      .waitForCompletion();

    expect(starts).toEqual([
      {
        workspace: "/tmp/workspace",
        prompt: "continue",
        model: "gpt-5.3-codex",
        effort: "high",
      },
    ]);
    expect(resumes).toEqual([
      {
        workspace: "/tmp/workspace",
        sessionOrChatId: "s1",
        prompt: "again",
        model: "gpt-5.3-codex-low",
        effort: "xhigh",
      },
    ]);
  });
});
