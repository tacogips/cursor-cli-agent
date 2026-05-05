import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

let testDir: string;
let logs: string[];
let errors: string[];
let logSpy: Mock<(message?: unknown) => void>;
let errorSpy: Mock<(message?: unknown) => void>;

async function seedSessionIndex(
  records: Parameters<SessionIndexRepository["upsert"]>[0][],
): Promise<void> {
  const dataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
  if (dataDir === undefined) {
    throw new Error("test data dir was not configured");
  }
  const repo = new SessionIndexRepository(join(dataDir, "state.db"));
  try {
    for (const record of records) {
      repo.upsert(record);
    }
  } finally {
    repo.close();
  }
}

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
}

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

describe("CLI search commands", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-cli-search-"));
    process.env["CURORT_CLI_AGENT_DATA_DIR"] = join(testDir, "data");
    process.env["CURORT_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
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

  test("renders JSON search results with match fields and index provenance", async () => {
    const workspace = resolve("/tmp/cli-search-workspace");
    await seedSessionIndex([
      {
        recordId: "rec-json",
        localSessionId: "local-json",
        identityState: "transcript_only",
        workspaceSlug: "tmp-cli-search-workspace",
        workspacePath: workspace,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        source: "headless",
        model: "gpt-5.4",
        mode: "plan",
        status: "completed",
        firstUserText: "Find JSON search contract",
      },
    ]);

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "session",
      "search",
      "json",
      "--workspace",
      workspace,
      "--model",
      "gpt-5.4",
      "--mode",
      "plan",
      "--status",
      "completed",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      provenance: string;
      total: number;
      sessions: Array<{
        recordId: string;
        provenance: string;
        matchFields: string[];
      }>;
    };
    expect(parsed.provenance).toBe("index");
    expect(parsed.total).toBe(1);
    expect(parsed.sessions[0]?.recordId).toBe("rec-json");
    expect(parsed.sessions[0]?.provenance).toBe("index");
    expect(parsed.sessions[0]?.matchFields).toContain("firstUserText");
  });

  test("renders human results with pending marker and matched fields", async () => {
    await seedSessionIndex([
      {
        recordId: "rec-pending-human",
        cursorChatId: "chat-pending-human",
        identityState: "chat_only",
        workspaceSlug: "tmp-human-workspace",
        workspacePath: resolve("/tmp/human-workspace"),
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T02:00:00.000Z",
        source: "create-chat",
        status: "pending",
      },
    ]);

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "session",
      "search",
      "chat-pending",
    ]);

    expect(exit).toBe(0);
    expect(logs[0]).toContain("chat-pending-human [pending-chat]");
    expect(logs[0]).toContain("tmp-human-workspace");
    expect(logs[0]).toContain("pending");
    expect(logs[0]).toContain("matches=cursorChatId");
  });

  test("rejects invalid search input with usage exit code", async () => {
    const invalidMode = await runCli([
      "bun",
      "curort-cli-agent",
      "session",
      "search",
      "query",
      "--mode",
      "edit",
    ]);

    expect(invalidMode).toBe(2);
    expect(errors[0]).toBe(
      "session search: --mode must be default, plan, or ask",
    );

    errors = [];
    const blankQuery = await runCli([
      "bun",
      "curort-cli-agent",
      "session",
      "search",
      "   ",
    ]);

    expect(blankQuery).toBe(2);
    expect(errors[0]).toBe("session search: missing query");
  });

  test("renders transcript search JSON results with transcript provenance", async () => {
    const transcriptPath = join(testDir, "cli-transcript.jsonl");
    await writeFile(
      transcriptPath,
      `${transcriptLine("user", "<user_query>\nCLI needle\n</user_query>")}\n`,
      "utf8",
    );
    await seedSessionIndex([
      {
        recordId: "rec-transcript-json",
        localSessionId: "local-transcript-json",
        cursorChatId: "chat-transcript-json",
        identityState: "linked",
        workspaceSlug: "tmp-transcript-json",
        workspacePath: resolve("/tmp/transcript-json"),
        transcriptPath,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "transcript",
      "search",
      "needle",
      "--session",
      "chat-transcript-json",
      "--role",
      "user",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      total: number;
      hits: Array<{
        recordId: string;
        messageId: string;
        provenance: string;
      }>;
      scannedSessions: number;
    };
    expect(parsed.total).toBe(1);
    expect(parsed.scannedSessions).toBe(1);
    expect(parsed.hits[0]?.recordId).toBe("rec-transcript-json");
    expect(parsed.hits[0]?.messageId).toBe("event-0-user");
    expect(parsed.hits[0]?.provenance).toBe("transcript");
  });

  test("rejects invalid transcript search flags", async () => {
    const invalidRole = await runCli([
      "bun",
      "curort-cli-agent",
      "transcript",
      "search",
      "query",
      "--role",
      "both",
    ]);

    expect(invalidRole).toBe(2);
    expect(errors[0]).toBe(
      "transcript search: --role must be user, assistant, system, or tool",
    );

    errors = [];
    const invalidBudget = await runCli([
      "bun",
      "curort-cli-agent",
      "transcript",
      "search",
      "query",
      "--max-events",
      "0",
    ]);

    expect(invalidBudget).toBe(2);
    expect(errors[0]).toBe(
      "transcript search: --max-events must be a positive integer",
    );
  });
});
