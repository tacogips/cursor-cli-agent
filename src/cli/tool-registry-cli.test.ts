import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";

import { runCli } from "./cli";
import { SessionIndexRepository } from "../persistence/session-index";

const previousDataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
const previousCursorHome = process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
const previousPath = process.env["PATH"];

let testDir: string;
let logs: string[];
let errors: string[];
let logSpy: Mock<(message?: unknown) => void>;
let errorSpy: Mock<(message?: unknown) => void>;

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURORT_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
  if (previousCursorHome === undefined) {
    delete process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
  } else {
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
  }
  if (previousPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = previousPath;
  }
}

async function installFakeCursorAgent(): Promise<void> {
  const binDir = join(testDir, "bin");
  await mkdir(binDir, { recursive: true });
  const scriptPath = join(binDir, "cursor-agent");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'cursor-agent 9.9.9\\n'
  exit 0
fi
case " $* " in
  *" --model success-model "*)
    printf 'OK\\n'
    exit 0
    ;;
  *" --model fail-model "*)
    printf 'authentication required\\n' 1>&2
    exit 12
    ;;
  *" --model timeout-model "*)
    sleep 2
    printf 'late\\n'
    exit 0
    ;;
  *)
    printf 'unexpected args: %s\\n' "$*" 1>&2
    exit 13
    ;;
esac
`,
    "utf8",
  );
  await chmod(scriptPath, 0o755);
  process.env["PATH"] = `${binDir}:${previousPath ?? ""}`;
}

describe("tool, model, and usage CLI helpers", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-tool-cli-"));
    const dataDir = join(testDir, "data");
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = dataDir;
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
    await mkdir(dataDir, { recursive: true });
    logs = [];
    errors = [];
    logSpy = spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ""));
    });
    errorSpy = spyOn(console, "error").mockImplementation(
      (message?: unknown) => {
        errors.push(String(message ?? ""));
      },
    );
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("lists registered helper tools as JSON", async () => {
    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "list",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      tools: Array<{ readonly name: string }>;
    };
    expect(parsed.tools.map((item) => item.name)).toEqual([
      "model.check",
      "tool.versions",
      "usage.stats",
    ]);
  });

  test("runs usage.stats through tool run with structured JSON input", async () => {
    const repo = new SessionIndexRepository(
      join(process.env["CURORT_CLI_AGENT_DATA_DIR"] ?? "", "state.db"),
    );
    repo.upsert({
      recordId: "rec-cli",
      localSessionId: "local-cli",
      identityState: "transcript_only",
      workspaceSlug: "workspace",
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T01:00:00.000Z",
      source: "headless",
      status: "completed",
      model: "gpt-cli",
    });
    repo.close();

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "run",
      "usage.stats",
      "--input",
      '{"recentDays":1}',
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      totalSessions: number;
      models: Record<string, number>;
    };
    expect(parsed.totalSessions).toBe(1);
    expect(parsed.models).toEqual({ "gpt-cli": 1 });
  });

  test("runs tool input from a path and reports unreadable path errors", async () => {
    const inputPath = join(testDir, "tool-input.json");
    await writeFile(inputPath, '{"recentDays":1}', "utf8");

    let exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "run",
      "usage.stats",
      "--input",
      inputPath,
      "--json",
    ]);
    expect(exit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      totalSessions: 0,
    });

    logs = [];
    exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "run",
      "usage.stats",
      "--input",
      `@${join(testDir, "missing.json")}`,
    ]);
    expect(exit).toBe(2);
    expect(
      errors.at(-1)?.startsWith("tool run: failed to read input file:"),
    ).toBe(true);
  });

  test("rejects non-object tool run JSON input", async () => {
    for (const input of ["[]", '"text"', "1", "null"]) {
      logs = [];
      errors = [];
      const exit = await runCli([
        "bun",
        "curort-cli-agent",
        "tool",
        "run",
        "usage.stats",
        "--input",
        input,
        "--json",
      ]);
      expect(exit).toBe(2);
      expect(logs).toEqual([]);
      expect(errors.at(-1)).toBe("tool run: --input must be a JSON object");
    }
  });

  test("rejects invalid tool run structured input as usage errors", async () => {
    const actualErrors: string[] = [];
    for (const input of [
      "{}",
      '{"model":" "}',
      '{"model":1}',
      '{"model":"test-model","probe":"yes"}',
      '{"model":"test-model","timeoutMs":"fast"}',
    ]) {
      logs = [];
      errors = [];
      const exit = await runCli([
        "bun",
        "curort-cli-agent",
        "tool",
        "run",
        "model.check",
        "--input",
        input,
        "--json",
      ]);
      expect(exit).toBe(2);
      expect(logs).toEqual([]);
      actualErrors.push(errors.at(-1) ?? "");
    }
    expect(actualErrors).toEqual([
      "model.check input requires non-empty model",
      "model.check input requires non-empty model",
      "model.check input requires non-empty model",
      "model.check input field probe must be boolean",
      "model.check input field timeoutMs must be a positive integer",
    ]);
  });

  test("rejects non-positive and fractional numeric tool run fields", async () => {
    const cases = [
      {
        name: "usage.stats",
        input: '{"recentDays":0}',
        error: "usage.stats input field recentDays must be a positive integer",
      },
      {
        name: "usage.stats",
        input: '{"recentDays":-1}',
        error: "usage.stats input field recentDays must be a positive integer",
      },
      {
        name: "usage.stats",
        input: '{"recentDays":1.5}',
        error: "usage.stats input field recentDays must be a positive integer",
      },
      {
        name: "tool.versions",
        input: '{"timeoutMs":0}',
        error: "tool.versions input field timeoutMs must be a positive integer",
      },
      {
        name: "tool.versions",
        input: '{"timeoutMs":-1}',
        error: "tool.versions input field timeoutMs must be a positive integer",
      },
      {
        name: "tool.versions",
        input: '{"timeoutMs":1.5}',
        error: "tool.versions input field timeoutMs must be a positive integer",
      },
      {
        name: "model.check",
        input: '{"model":"test-model","timeoutMs":0}',
        error: "model.check input field timeoutMs must be a positive integer",
      },
      {
        name: "model.check",
        input: '{"model":"test-model","timeoutMs":-1}',
        error: "model.check input field timeoutMs must be a positive integer",
      },
      {
        name: "model.check",
        input: '{"model":"test-model","timeoutMs":1.5}',
        error: "model.check input field timeoutMs must be a positive integer",
      },
    ] as const;

    for (const item of cases) {
      logs = [];
      errors = [];
      const exit = await runCli([
        "bun",
        "curort-cli-agent",
        "tool",
        "run",
        item.name,
        "--input",
        item.input,
        "--json",
      ]);
      expect(exit).toBe(2);
      expect(logs).toEqual([]);
      expect(errors.at(-1)).toBe(item.error);
    }
  });

  test("rejects extra positional arguments for tool show and run", async () => {
    let exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "show",
      "usage.stats",
      "extra",
      "--json",
    ]);
    expect(exit).toBe(2);
    expect(errors.at(-1)).toBe("tool show: unexpected positional arguments");
    expect(logs).toEqual([]);

    errors = [];
    logs = [];
    exit = await runCli([
      "bun",
      "curort-cli-agent",
      "tool",
      "run",
      "usage.stats",
      "extra",
      "--input",
      "{}",
      "--json",
    ]);
    expect(exit).toBe(2);
    expect(errors.at(-1)).toBe("tool run: unexpected positional arguments");
    expect(logs).toEqual([]);
  });

  test("model check without probe returns JSON and does not fail when binary is missing", async () => {
    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "model",
      "check",
      "--model",
      "test-model",
      "--json",
      "--timeout-ms",
      "1",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      model: string;
      auth: { readonly status: string };
      modelReachability: { readonly status: string; readonly probed: boolean };
    };
    expect(parsed.model).toBe("test-model");
    expect(parsed.auth.status).toBe("unknown");
    expect(parsed.modelReachability).toEqual({
      status: "not_checked",
      probed: false,
    });
  });

  test("model check probe reports success, failures, timeout, and invalid input", async () => {
    await installFakeCursorAgent();

    let exit = await runCli([
      "bun",
      "curort-cli-agent",
      "model",
      "check",
      "--model",
      "success-model",
      "--probe",
      "--json",
    ]);
    expect(exit).toBe(0);
    let parsed = JSON.parse(logs.join("\n")) as {
      modelReachability: {
        readonly status: string;
        readonly probed?: boolean;
        readonly output?: string;
        readonly error?: string;
      };
    };
    expect(parsed.modelReachability).toEqual({
      status: "available",
      probed: true,
      output: "OK",
    });

    logs = [];
    exit = await runCli([
      "bun",
      "curort-cli-agent",
      "model",
      "check",
      "--model",
      "fail-model",
      "--probe",
      "--json",
    ]);
    expect(exit).toBe(4);
    parsed = JSON.parse(logs.join("\n")) as {
      modelReachability: { readonly status: string; readonly error: string };
    };
    expect(parsed.modelReachability.status).toBe("unavailable");
    expect(parsed.modelReachability.error).toBe(
      "probe failure: authentication required",
    );

    logs = [];
    exit = await runCli([
      "bun",
      "curort-cli-agent",
      "model",
      "check",
      "--model",
      "timeout-model",
      "--probe",
      "--json",
      "--timeout-ms",
      "1",
    ]);
    expect(exit).toBe(4);
    parsed = JSON.parse(logs.join("\n")) as {
      modelReachability: { readonly status: string; readonly error: string };
    };
    expect(parsed.modelReachability.status).toBe("unavailable");
    expect(parsed.modelReachability.error).toBe("probe timed out after 1ms");

    exit = await runCli([
      "bun",
      "curort-cli-agent",
      "model",
      "check",
      "--model",
      " ",
    ]);
    expect(exit).toBe(2);
    expect(errors.at(-1)).toBe("model check: --model is required");
  });

  test("usage stats command emits local aggregate JSON", async () => {
    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "usage",
      "stats",
      "--recent-days",
      "1",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      totalSessions: number;
      completenessNotes: string[];
    };
    expect(parsed.totalSessions).toBe(0);
    expect(parsed.completenessNotes).toContain(
      "token totals are unknown because no repository-owned usage event store exists",
    );
  });
});
