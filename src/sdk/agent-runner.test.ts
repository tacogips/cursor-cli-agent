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

  test("propagates factory cursorApiKey and cursorAgentEnv to start and resume", async () => {
    const starts: HeadlessRunOptions[] = [];
    const resumes: ResumeRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      cursorApiKey: "factory-key",
      cursorAgentEnv: { FOO: "bar" },
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
            session_id: "s1",
          }),
        );
        return fakeProcess([]);
      },
    });

    await runner.start({ cwd: "/tmp", prompt: "hello" }).waitForCompletion();
    await runner.resume({ cwd: "/tmp", sessionId: "s1" }).waitForCompletion();

    expect(starts[0]?.cursorApiKey).toBe("factory-key");
    expect(starts[0]?.env).toEqual({ FOO: "bar" });
    expect(resumes[0]?.cursorApiKey).toBe("factory-key");
    expect(resumes[0]?.env).toEqual({ FOO: "bar" });
  });

  test("per-request cursorApiKey overrides factory key", async () => {
    const starts: HeadlessRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      cursorApiKey: "factory-key",
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
    });

    await runner
      .start({ cwd: "/tmp", prompt: "hello", cursorApiKey: "per-request-key" })
      .waitForCompletion();

    expect(starts[0]?.cursorApiKey).toBe("per-request-key");
  });

  test("per-request cursorAgentEnv overlays on factory env", async () => {
    const starts: HeadlessRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      cursorAgentEnv: { FOO: "factory", BAR: "factory" },
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
    });

    await runner
      .start({
        cwd: "/tmp",
        prompt: "hello",
        cursorAgentEnv: { FOO: "request" },
      })
      .waitForCompletion();

    expect(starts[0]?.env).toEqual({ FOO: "request", BAR: "factory" });
  });

  test("propagates factory cursorAuthToken to start and resume", async () => {
    const starts: HeadlessRunOptions[] = [];
    const resumes: ResumeRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      cursorAuthToken: "factory-auth-token",
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
            session_id: "s1",
          }),
        );
        return fakeProcess([]);
      },
    });

    await runner.start({ cwd: "/tmp", prompt: "hello" }).waitForCompletion();
    await runner.resume({ cwd: "/tmp", sessionId: "s1" }).waitForCompletion();

    expect(starts[0]?.cursorAuthToken).toBe("factory-auth-token");
    expect(resumes[0]?.cursorAuthToken).toBe("factory-auth-token");
  });

  test("per-request cursorAuthToken overrides factory auth token", async () => {
    const starts: HeadlessRunOptions[] = [];
    const runner = createAgentRunnerFacade({
      cursorAuthToken: "factory-auth-token",
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
    });

    await runner
      .start({
        cwd: "/tmp",
        prompt: "hello",
        cursorAuthToken: "per-request-auth-token",
      })
      .waitForCompletion();

    expect(starts[0]?.cursorAuthToken).toBe("per-request-auth-token");
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
        systemPrompt: "system",
        model: "gpt-5.3-codex",
        effort: "high",
      })
      .waitForCompletion();
    await runner
      .resume({
        cwd: "/tmp/workspace",
        sessionId: "s1",
        prompt: "again",
        systemPrompt: "system",
        model: "gpt-5.3-codex-low",
        effort: "xhigh",
      })
      .waitForCompletion();

    expect(starts).toEqual([
      {
        workspace: "/tmp/workspace",
        prompt: "continue",
        systemPrompt: "system",
        model: "gpt-5.3-codex",
        effort: "high",
      },
    ]);
    expect(resumes).toEqual([
      {
        workspace: "/tmp/workspace",
        sessionOrChatId: "s1",
        prompt: "again",
        systemPrompt: "system",
        model: "gpt-5.3-codex-low",
        effort: "xhigh",
      },
    ]);
  });
});
