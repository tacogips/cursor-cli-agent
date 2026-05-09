import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { runGraphqlCli } from "./graphql";

const previousDataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
const previousCursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];

let testDir: string;
let logs: string[];
let errors: string[];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
  if (previousCursorHome === undefined) {
    delete process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
  } else {
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
  }
}

describe("GraphQL CLI", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-graphql-cli-"));
    const dataDir = join(testDir, "data");
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = dataDir;
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
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

  test("executes explicit ping document", async () => {
    const exit = await runGraphqlCli(["query { ping }"], {
      dataDir: join(testDir, "data"),
      cursorHome: join(testDir, "cursor"),
    });

    expect(exit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toEqual({ data: { ping: true } });
  });

  test("infers shorthand command kind and parses param JSON", async () => {
    const exit = await runGraphqlCli(
      ["session.list", "--param", '{"limit":1}', "--json"],
      {
        dataDir: join(testDir, "data"),
        cursorHome: join(testDir, "cursor"),
      },
    );

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      data: { command: { sessions: unknown[] } };
    };
    expect(parsed.data.command.sessions).toEqual([]);
  });

  test("rejects unknown shorthand commands", async () => {
    const exit = await runGraphqlCli(["missing.command"]);

    expect(exit).toBe(2);
    expect(errors[0]).toBe(
      "graphql: unknown shorthand command: missing.command",
    );
  });
});
