import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { workspaceSlugFromPath } from "../config/paths";
import { SessionIndexRepository } from "../persistence/session-index";
import { createHttpRouteHandler } from "./routes";
import { resolveHttpServerConfig } from "./types";

const previousDataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
const previousConfigDir = process.env["CURORT_CLI_AGENT_CONFIG_DIR"];
const previousCursorHome = process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
const previousServerToken = process.env["CURORT_CLI_AGENT_SERVER_TOKEN"];

let testDir: string;
let repo: SessionIndexRepository;

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURORT_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
  if (previousConfigDir === undefined) {
    delete process.env["CURORT_CLI_AGENT_CONFIG_DIR"];
  } else {
    process.env["CURORT_CLI_AGENT_CONFIG_DIR"] = previousConfigDir;
  }
  if (previousCursorHome === undefined) {
    delete process.env["CURORT_CLI_AGENT_CURSOR_HOME"];
  } else {
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = previousCursorHome;
  }
  if (previousServerToken === undefined) {
    delete process.env["CURORT_CLI_AGENT_SERVER_TOKEN"];
  } else {
    process.env["CURORT_CLI_AGENT_SERVER_TOKEN"] = previousServerToken;
  }
}

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

async function jsonFor(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function handler(token?: string): (request: Request) => Promise<Response> {
  return createHttpRouteHandler({
    config: resolveHttpServerConfig(token === undefined ? {} : { token }),
    startedAt: new Date("2026-05-07T00:00:00.000Z"),
    sessions: repo,
  });
}

describe("http server core", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-http-server-"));
    const dataDir = join(testDir, "data");
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = dataDir;
    process.env["CURORT_CLI_AGENT_CONFIG_DIR"] = join(testDir, "config");
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
    delete process.env["CURORT_CLI_AGENT_SERVER_TOKEN"];
    await mkdir(dataDir, { recursive: true });
    repo = new SessionIndexRepository(join(dataDir, "state.db"));
  });

  afterEach(async () => {
    repo.close();
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("resolves config defaults and rejects unauthenticated non-loopback hosts", () => {
    const config = resolveHttpServerConfig();
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(0);
    expect(config.dataDir).toBe(join(testDir, "data"));
    expect(config.configDir).toBe(join(testDir, "config"));
    expect(config.cursorHome).toBe(join(testDir, "cursor"));
    expect(config.token).toBeUndefined();

    expect(() => resolveHttpServerConfig({ host: "0.0.0.0" })).toThrow(
      "server token is required for non-loopback hosts",
    );
    expect(
      resolveHttpServerConfig({ host: "0.0.0.0", token: "secret" }).token,
    ).toBe("secret");
  });

  test("returns health and version JSON", async () => {
    const route = handler();
    const health = await route(new Request("http://server/api/health"));
    expect(health.status).toBe(200);
    const healthJson = await jsonFor(health);
    expect(healthJson["status"]).toBe("ok");
    expect(healthJson["version"]).toBe("0.1.0");

    const version = await route(new Request("http://server/api/version"));
    expect(version.status).toBe(200);
    const versionJson = await jsonFor(version);
    expect(versionJson["packageName"]).toBe("curort-cli-agent");
    expect(versionJson["apiVersion"]).toBe("v1");
  });

  test("lists sessions, resolves detail, returns messages, and searches", async () => {
    const workspace = resolve("/tmp/http-server-workspace");
    const transcriptPath = join(testDir, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      `${transcriptLine("user", "<user_query>HTTP needle</user_query>")}\n${transcriptLine("assistant", "Server answer")}\n`,
      "utf8",
    );
    repo.upsert({
      recordId: "rec-http",
      localSessionId: "local-http",
      cursorChatId: "chat-http",
      identityState: "linked",
      workspaceSlug: workspaceSlugFromPath(workspace),
      workspacePath: workspace,
      transcriptPath,
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T01:00:00.000Z",
      source: "headless",
      status: "completed",
      firstUserText: "HTTP needle",
    });

    const route = handler();
    const list = await jsonFor(
      await route(new Request("http://server/api/sessions?limit=1&offset=0")),
    );
    expect((list["sessions"] as unknown[]).length).toBe(1);
    expect(list["provenance"]).toBe("index");

    const detail = await jsonFor(
      await route(new Request("http://server/api/sessions/chat-http")),
    );
    expect((detail["session"] as { recordId: string }).recordId).toBe(
      "rec-http",
    );

    const messages = await jsonFor(
      await route(
        new Request("http://server/api/sessions/local-http/messages"),
      ),
    );
    expect(messages["total"]).toBe(2);
    expect((messages["messages"] as Array<{ id: string }>)[0]?.id).toBe(
      "event-0-user",
    );

    const sessionSearch = await jsonFor(
      await route(new Request("http://server/api/search/sessions?q=needle")),
    );
    expect(sessionSearch["total"]).toBe(1);
    expect(sessionSearch["provenance"]).toBe("index");

    const transcriptSearch = await jsonFor(
      await route(
        new Request(
          "http://server/api/search/transcripts?q=answer&role=assistant",
        ),
      ),
    );
    expect(transcriptSearch["total"]).toBe(1);
    expect(
      (transcriptSearch["hits"] as Array<{ provenance: string }>)[0]
        ?.provenance,
    ).toBe("transcript");
  });

  test("returns stable error envelope for auth, validation, missing sessions, and methods", async () => {
    const authed = handler("secret");
    const unauthorized = await jsonFor(
      await authed(new Request("http://server/api/health")),
    );
    expect((unauthorized["error"] as { code: string }).code).toBe(
      "UNAUTHORIZED",
    );

    const route = handler();
    const invalid = await route(
      new Request("http://server/api/search/sessions?q=needle&limit=0"),
    );
    expect(invalid.status).toBe(400);
    expect(((await jsonFor(invalid))["error"] as { code: string }).code).toBe(
      "INVALID_REQUEST",
    );

    const missing = await route(
      new Request("http://server/api/sessions/missing"),
    );
    expect(missing.status).toBe(404);
    expect(((await jsonFor(missing))["error"] as { code: string }).code).toBe(
      "NOT_FOUND",
    );

    const malformedDetail = await route(
      new Request("http://server/api/sessions/%E0%A4%A"),
    );
    expect(malformedDetail.status).toBe(400);
    expect(
      ((await jsonFor(malformedDetail))["error"] as { code: string }).code,
    ).toBe("INVALID_REQUEST");

    const malformedMessages = await route(
      new Request("http://server/api/sessions/%E0%A4%A/messages"),
    );
    expect(malformedMessages.status).toBe(400);
    expect(
      ((await jsonFor(malformedMessages))["error"] as { code: string }).code,
    ).toBe("INVALID_REQUEST");

    const method = await route(
      new Request("http://server/api/health", { method: "POST" }),
    );
    expect(method.status).toBe(405);
    expect(((await jsonFor(method))["error"] as { code: string }).code).toBe(
      "METHOD_NOT_ALLOWED",
    );
  });
});
