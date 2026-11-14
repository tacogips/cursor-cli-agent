import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTokenManager } from "../auth";
import { COMPAT_COMMAND_CAPABILITIES } from "../compat/commands";
import { SessionIndexRepository } from "../persistence/session-index";
import { createAppServerCompatMetadata } from "./app-server-compat";
import { createHttpRouteHandler } from "./routes";
import { resolveHttpServerConfig } from "./types";

const previousDataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
const previousConfigDir = process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
const previousCursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];

let testDir: string;
let repo: SessionIndexRepository;

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
  if (previousConfigDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = previousConfigDir;
  }
  if (previousCursorHome === undefined) {
    delete process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
  } else {
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
  }
}

function route(token?: string) {
  return createHttpRouteHandler({
    config: resolveHttpServerConfig({
      compatGraphql: true,
      ...(token !== undefined ? { token } : {}),
    }),
    startedAt: new Date("2026-05-07T00:00:00.000Z"),
    sessions: repo,
  });
}

async function jsonFor(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("app-server compatibility metadata", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-app-server-compat-"));
    const dataDir = join(testDir, "data");
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = dataDir;
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = join(testDir, "config");
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
    await mkdir(dataDir, { recursive: true });
    repo = new SessionIndexRepository(join(dataDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("reports compat-local mode, command names, and limitation codes", () => {
    const metadata = createAppServerCompatMetadata({
      capabilities: COMPAT_COMMAND_CAPABILITIES,
      async execute() {
        return { kind: "single", value: null };
      },
    });

    expect(metadata.mode).toBe("compat-local");
    expect(metadata.capabilities).toContain("session.list");
    expect(metadata.capabilities).toContain("files.patches");
    expect(metadata.limitations).toContain("cursor-no-patch-history");
  });

  test("exposes opt-in auth-gated compat-local metadata route", async () => {
    const disabled = createHttpRouteHandler({
      config: resolveHttpServerConfig(),
      startedAt: new Date("2026-05-07T00:00:00.000Z"),
      sessions: repo,
    });
    const disabledResponse = await disabled(
      new Request("http://server/api/compat/app-server"),
    );
    expect(disabledResponse.status).toBe(404);

    const openResponse = await route()(
      new Request("http://server/api/compat/app-server"),
    );
    expect(openResponse.status).toBe(200);
    expect(await jsonFor(openResponse)).toMatchObject({
      mode: "compat-local",
    });

    const authedRoute = route("server-token");
    const missing = await authedRoute(
      new Request("http://server/api/compat/app-server"),
    );
    expect(missing.status).toBe(401);

    const token = await createTokenManager({
      configDir: join(testDir, "config"),
    }).createToken({
      name: "compat reader",
      permissions: ["session:read"],
    });
    const authorized = await authedRoute(
      new Request("http://server/api/compat/app-server", {
        headers: { authorization: `Bearer ${token.token}` },
      }),
    );
    expect(authorized.status).toBe(200);
    expect(await jsonFor(authorized)).toMatchObject({
      mode: "compat-local",
    });
  });
});
