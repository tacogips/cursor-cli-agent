import { describe, expect, test } from "bun:test";
import { CursorAuthKeepAlive } from "./auth-keepalive";
import type { ToolVersionCommandRunner } from "../types/tool-versions";

const FAKE_VERSION_RESULT = {
  exitCode: 0,
  signal: null as null,
  stdout: "cursor-agent 1.0.0\n",
  stderr: "",
  timedOut: false,
};

const FAKE_PROBE_SUCCESS_RESULT = {
  exitCode: 0,
  signal: null as null,
  stdout: "OK\n",
  stderr: "",
  timedOut: false,
};

const FAKE_PROBE_FAILURE_RESULT = {
  exitCode: 1,
  signal: null as null,
  stdout: "",
  stderr: "auth failed\n",
  timedOut: false,
};

function makeRunner(probeShouldFail: boolean): ToolVersionCommandRunner {
  return async (_command, args) => {
    if (args[0] === "--version") {
      return FAKE_VERSION_RESULT;
    }
    return probeShouldFail
      ? FAKE_PROBE_FAILURE_RESULT
      : FAKE_PROBE_SUCCESS_RESULT;
  };
}

function makeCaptureRunner(): {
  runner: ToolVersionCommandRunner;
  capturedEnvs: Array<Readonly<Record<string, string | undefined>> | undefined>;
} {
  const capturedEnvs: Array<
    Readonly<Record<string, string | undefined>> | undefined
  > = [];
  const runner: ToolVersionCommandRunner = async (_command, args, opts) => {
    if (args[0] === "--version") {
      return FAKE_VERSION_RESULT;
    }
    capturedEnvs.push(opts.env);
    return FAKE_PROBE_SUCCESS_RESULT;
  };
  return { runner, capturedEnvs };
}

describe("CursorAuthKeepAlive", () => {
  test("interval is clamped to minimum 60 seconds", () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      intervalMs: 100, // below minimum
      commandRunner: makeRunner(false),
      setInterval: (fn, ms) => {
        timers.push({ fn, ms });
        return 0 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });
    keepalive.start();
    expect(timers.length).toBe(1);
    expect(timers[0]?.ms).toBe(60 * 1000);
    keepalive.stop();
  });

  test("probeNow records success on available model", async () => {
    const fixedNow = new Date("2026-06-01T00:00:00.000Z");
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      commandRunner: makeRunner(false),
      now: () => fixedNow,
    });

    expect(keepalive.status().probeCount).toBe(0);
    await keepalive.probeNow();

    const s = keepalive.status();
    expect(s.probeCount).toBe(1);
    expect(s.lastSuccessAt).toBe("2026-06-01T00:00:00.000Z");
    expect(s.lastFailureAt).toBeUndefined();
  });

  test("probeNow records failure without throwing from timer", async () => {
    const fixedNow = new Date("2026-06-01T12:00:00.000Z");
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      commandRunner: makeRunner(true),
      now: () => fixedNow,
    });

    await keepalive.probeNow();

    const s = keepalive.status();
    expect(s.probeCount).toBe(1);
    expect(s.lastFailureAt).toBe("2026-06-01T12:00:00.000Z");
    expect(typeof s.lastFailureMessage).toBe("string");
    expect(s.lastSuccessAt).toBeUndefined();
  });

  test("timer fires and calls probeNow via setInterval", async () => {
    let storedFn: (() => void) | undefined;
    let cleared = false;
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      intervalMs: 5 * 60 * 1000,
      commandRunner: makeRunner(false),
      now: () => new Date(),
      setInterval: (fn, _ms) => {
        storedFn = fn;
        return 99 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: (_id) => {
        cleared = true;
      },
    });

    keepalive.start();
    expect(storedFn).toBeDefined();
    expect(keepalive.status().probeCount).toBe(0);

    storedFn?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(keepalive.status().probeCount).toBe(1);
    keepalive.stop();
    expect(cleared).toBe(true);
    expect(keepalive.status().running).toBe(false);
  });

  test("start is idempotent", () => {
    const timers: number[] = [];
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      commandRunner: makeRunner(false),
      setInterval: (_fn, _ms) => {
        timers.push(1);
        return 0 as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => {},
    });
    keepalive.start();
    keepalive.start(); // second call should be no-op
    expect(timers.length).toBe(1);
    keepalive.stop();
  });

  test("cursorAuthToken is forwarded to checkModelAvailability probe env", async () => {
    const { runner, capturedEnvs } = makeCaptureRunner();
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      cursorAuthToken: "token-abc",
      commandRunner: runner,
      now: () => new Date(),
    });
    await keepalive.probeNow();
    expect(capturedEnvs.length).toBeGreaterThan(0);
    const probeEnv = capturedEnvs[0];
    expect(probeEnv?.["CURSOR_AUTH_TOKEN"]).toBe("token-abc");
  });

  test("cursorApiKey and cursorAuthToken are both forwarded when both provided", async () => {
    const { runner, capturedEnvs } = makeCaptureRunner();
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      cursorApiKey: "key-xyz",
      cursorAuthToken: "token-abc",
      commandRunner: runner,
      now: () => new Date(),
    });
    await keepalive.probeNow();
    expect(capturedEnvs.length).toBeGreaterThan(0);
    const probeEnv = capturedEnvs[0];
    expect(probeEnv?.["CURSOR_API_KEY"]).toBe("key-xyz");
    expect(probeEnv?.["CURSOR_AUTH_TOKEN"]).toBe("token-abc");
  });

  test("stop is idempotent", () => {
    let clearCount = 0;
    const keepalive = new CursorAuthKeepAlive({
      model: "gpt-test",
      commandRunner: makeRunner(false),
      setInterval: (_fn, _ms) =>
        0 as unknown as ReturnType<typeof globalThis.setInterval>,
      clearInterval: () => {
        clearCount++;
      },
    });
    keepalive.stop(); // no-op when not running
    keepalive.start();
    keepalive.stop();
    keepalive.stop(); // second stop is no-op
    expect(clearCount).toBe(1);
  });
});
