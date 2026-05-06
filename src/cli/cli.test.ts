import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

import { runCli, setCliTestOverrides } from "./cli";
import * as groupsStore from "../persistence/groups-store";
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

  test("creates and searches bookmark JSON records", async () => {
    const workspace = resolve("/tmp/bookmark-cli-workspace");
    const transcriptPath = join(testDir, "bookmark-cli.jsonl");
    await writeFile(
      transcriptPath,
      `${transcriptLine("user", "<user_query>\nBookmark CLI needle\n</user_query>")}\n`,
      "utf8",
    );
    await seedSessionIndex([
      {
        recordId: "rec-bookmark-cli",
        localSessionId: "local-bookmark-cli",
        cursorChatId: "chat-bookmark-cli",
        identityState: "linked",
        workspaceSlug: "tmp-bookmark-cli-workspace",
        workspacePath: workspace,
        transcriptPath,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);

    const addExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "add",
      "--type",
      "message",
      "--session",
      "chat-bookmark-cli",
      "--message",
      "event-0-user",
      "--name",
      "CLI bookmark",
      "--tag",
      "cli",
      "--json",
    ]);

    expect(addExit).toBe(0);
    const bookmark = JSON.parse(logs.join("\n")) as {
      id: string;
      messageId: string;
      excerpt: { displayText: string; rawText: string };
    };
    expect(bookmark.messageId).toBe("event-0-user");
    expect(bookmark.excerpt.displayText).toBe("Bookmark CLI needle");
    expect(bookmark.excerpt.rawText).toContain("user_query");

    logs = [];
    const listExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "list",
      "--session",
      "chat-bookmark-cli",
      "--json",
    ]);

    expect(listExit).toBe(0);
    const list = JSON.parse(logs.join("\n")) as {
      bookmarks: Array<{ id: string }>;
    };
    expect(list.bookmarks[0]?.id).toBe(bookmark.id);

    logs = [];
    const searchExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "search",
      "needle",
      "--limit",
      "5",
      "--json",
    ]);

    expect(searchExit).toBe(0);
    const result = JSON.parse(logs.join("\n")) as {
      total: number;
      hits: Array<{ bookmark: { id: string } }>;
    };
    expect(result.total).toBe(1);
    expect(result.hits[0]?.bookmark.id).toBe(bookmark.id);
  });

  test("enforces bookmark not-found and chat-only validation exits", async () => {
    await seedSessionIndex([
      {
        recordId: "rec-bookmark-pending",
        cursorChatId: "chat-bookmark-pending",
        identityState: "chat_only",
        workspaceSlug: "tmp-bookmark-pending",
        workspacePath: resolve("/tmp/bookmark-pending"),
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        source: "create-chat",
        status: "pending",
      },
    ]);

    const sessionExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "add",
      "--type",
      "session",
      "--session",
      "chat-bookmark-pending",
      "--name",
      "Pending session bookmark",
      "--json",
    ]);
    expect(sessionExit).toBe(0);

    logs = [];
    errors = [];
    const messageExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "add",
      "--type",
      "message",
      "--session",
      "chat-bookmark-pending",
      "--message",
      "event-0-user",
      "--name",
      "Invalid pending bookmark",
    ]);
    expect(messageExit).toBe(2);
    expect(errors[0]).toContain(
      "message and range bookmarks require a transcript-backed session",
    );

    errors = [];
    const showMissingExit = await runCli([
      "bun",
      "curort-cli-agent",
      "bookmark",
      "show",
      "missing",
    ]);
    expect(showMissingExit).toBe(3);
    expect(errors[0]).toBe("bookmark not found");
  });

  test("renders derived activity JSON and filters by status and limit", async () => {
    await seedSessionIndex([
      {
        recordId: "rec-activity-running",
        localSessionId: "local-activity-running",
        identityState: "transcript_only",
        workspaceSlug: "tmp-activity-cli",
        workspacePath: resolve("/tmp/activity-cli"),
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:02:00.000Z",
        source: "headless",
        status: "active",
      },
      {
        recordId: "rec-activity-idle",
        cursorChatId: "chat-activity-idle",
        identityState: "chat_only",
        workspaceSlug: "tmp-activity-cli",
        workspacePath: resolve("/tmp/activity-cli"),
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:01:00.000Z",
        source: "create-chat",
        status: "pending",
      },
    ]);

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "activity",
      "--status",
      "running",
      "--limit",
      "1",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      activities: Array<{
        localSessionId?: string;
        status: string;
        provenance: string;
        signals: Array<{ source: string }>;
      }>;
    };
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.activities[0]?.localSessionId).toBe("local-activity-running");
    expect(parsed.activities[0]?.status).toBe("running");
    expect(parsed.activities[0]?.provenance).toBe("derived");
    expect(parsed.activities[0]?.signals[0]?.source).toBe("index");
  });

  test("supports activity session lookup and validation exits", async () => {
    await seedSessionIndex([
      {
        recordId: "rec-activity-lookup",
        cursorChatId: "chat-activity-lookup",
        identityState: "chat_only",
        workspaceSlug: "tmp-activity-cli",
        workspacePath: resolve("/tmp/activity-cli"),
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:01:00.000Z",
        source: "create-chat",
        status: "pending",
      },
    ]);

    const lookupExit = await runCli([
      "bun",
      "curort-cli-agent",
      "activity",
      "--session",
      "chat-activity-lookup",
      "--json",
    ]);

    expect(lookupExit).toBe(0);
    const activity = JSON.parse(logs.join("\n")) as {
      cursorChatId: string;
      status: string;
    };
    expect(activity.cursorChatId).toBe("chat-activity-lookup");
    expect(activity.status).toBe("idle");

    errors = [];
    const invalidStatus = await runCli([
      "bun",
      "curort-cli-agent",
      "activity",
      "--status",
      "waiting_approval",
    ]);
    expect(invalidStatus).toBe(2);
    expect(errors[0]).toContain("activity: --status must be");

    errors = [];
    const missing = await runCli([
      "bun",
      "curort-cli-agent",
      "activity",
      "--session",
      "missing",
    ]);
    expect(missing).toBe(3);
    expect(errors[0]).toBe("session not found");
  });

  test("supports group pause, resume, delete, and JSON output", async () => {
    const createExit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "create",
      "lifecycle",
    ]);
    expect(createExit).toBe(0);

    logs = [];
    const pauseExit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "pause",
      "lifecycle",
      "--json",
    ]);
    expect(pauseExit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      name: "lifecycle",
      lifecycleState: "paused",
    });

    logs = [];
    const resumeExit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "resume",
      "lifecycle",
      "--json",
    ]);
    expect(resumeExit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      name: "lifecycle",
      lifecycleState: "active",
    });

    logs = [];
    const deleteExit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "delete",
      "lifecycle",
      "--json",
    ]);
    expect(deleteExit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      deleted: true,
      group: { name: "lifecycle" },
    });
  });

  test("guards paused group runs before launching Cursor", async () => {
    await runCli(["bun", "curort-cli-agent", "group", "create", "paused-run"]);
    await runCli(["bun", "curort-cli-agent", "group", "pause", "paused-run"]);
    logs = [];
    errors = [];

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "run",
      "paused-run",
      "--prompt",
      "should not launch",
    ]);

    expect(exit).toBe(1);
    expect(errors[0]).toBe("group run: group is paused");
    logs = [];
    const showExit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "show",
      "paused-run",
      "--json",
    ]);
    expect(showExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).lastRun).toBeUndefined();
  });

  test("stops scheduling after a mid-run pause and persists revealed session ids", async () => {
    let runCount = 0;
    const restore = setCliTestOverrides({
      runHeadlessStreaming: async (_options, onLine) => {
        runCount += 1;
        onLine(
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: `mid-run-session-${runCount}`,
            cwd: `/tmp/mid-run-${runCount}`,
          }),
        );
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const group = await groupsStore.getGroup("mid-run");
          const workspace = group?.lastRun?.workspaces.find(
            (record) => record.localSessionId === "mid-run-session-1",
          );
          if (workspace !== undefined) {
            break;
          }
          await new Promise((resolvePoll) => {
            setTimeout(resolvePoll, 1);
          });
        }
        await groupsStore.pauseGroup("mid-run");
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    try {
      await runCli(["bun", "curort-cli-agent", "group", "create", "mid-run"]);
      await runCli([
        "bun",
        "curort-cli-agent",
        "group",
        "add",
        "mid-run",
        "--workspace",
        "/tmp/mid-run-1",
      ]);
      await runCli([
        "bun",
        "curort-cli-agent",
        "group",
        "add",
        "mid-run",
        "--workspace",
        "/tmp/mid-run-2",
      ]);
      logs = [];
      errors = [];

      const exit = await runCli([
        "bun",
        "curort-cli-agent",
        "group",
        "run",
        "mid-run",
        "--prompt",
        "pause after first workspace",
      ]);

      expect(exit).toBe(0);
      expect(runCount).toBe(1);
      const group = await groupsStore.getGroup("mid-run");
      expect(group?.lifecycleState).toBe("paused");
      expect(group?.lastRun?.status).toBe("paused");
      expect(group?.lastRun?.workspaces[0]?.localSessionId).toBe(
        "mid-run-session-1",
      );
      expect(group?.lastRun?.workspaces[0]?.status).toBe("completed");
      expect(group?.lastRun?.workspaces[1]?.status).toBe("pending");
    } finally {
      restore();
    }
  });

  test("rejects deleting a running latest run unless forced", async () => {
    const dataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
    if (dataDir === undefined) {
      throw new Error("test data dir was not configured");
    }
    await writeFile(
      join(dataDir, "groups.json"),
      JSON.stringify({
        groups: [
          {
            name: "running",
            workspaces: ["/tmp/a"],
            lifecycleState: "active",
            lastRun: {
              id: "run-1",
              status: "running",
              startedAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
              workspaces: [
                {
                  workspace: "/tmp/a",
                  status: "running",
                  updatedAt: "2026-05-06T00:00:00.000Z",
                },
              ],
            },
          },
        ],
      }),
      "utf8",
    );

    const blocked = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "delete",
      "running",
    ]);
    expect(blocked).toBe(1);
    expect(errors[0]).toBe("group delete: latest run is running; use --force");

    logs = [];
    errors = [];
    const forced = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "delete",
      "running",
      "--force",
      "--json",
    ]);
    expect(forced).toBe(0);
    expect(JSON.parse(logs.join("\n")).deleted).toBe(true);
  });

  test("renders one-shot group watch snapshots from activity", async () => {
    const dataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
    if (dataDir === undefined) {
      throw new Error("test data dir was not configured");
    }
    await writeFile(
      join(dataDir, "groups.json"),
      JSON.stringify({
        groups: [
          {
            name: "watching",
            workspaces: ["/tmp/watch"],
            lifecycleState: "active",
            lastRun: {
              id: "run-watch",
              status: "running",
              startedAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
              workspaces: [
                {
                  workspace: "/tmp/watch",
                  localSessionId: "watch-session",
                  status: "pending",
                  updatedAt: "2026-05-06T00:00:00.000Z",
                },
              ],
            },
          },
        ],
      }),
      "utf8",
    );
    await seedSessionIndex([
      {
        recordId: "rec-watch",
        localSessionId: "watch-session",
        identityState: "transcript_only",
        workspaceSlug: "tmp-watch",
        workspacePath: resolve("/tmp/watch"),
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:02:00.000Z",
        source: "headless",
        status: "active",
      },
    ]);

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "watch",
      "watching",
      "--once",
      "--json",
    ]);

    expect(exit).toBe(0);
    const snapshot = JSON.parse(logs.join("\n")) as {
      provenance: string;
      totals: { running: number };
      run: { workspaces: Array<{ status: string }> };
    };
    expect(snapshot.provenance).toBe("group-store+activity");
    expect(snapshot.totals.running).toBe(1);
    expect(snapshot.run.workspaces[0]?.status).toBe("running");
  });

  test("renders polling group watch JSON as newline-delimited compact objects", async () => {
    const dataDir = process.env["CURORT_CLI_AGENT_DATA_DIR"];
    if (dataDir === undefined) {
      throw new Error("test data dir was not configured");
    }
    await writeFile(
      join(dataDir, "groups.json"),
      JSON.stringify({
        groups: [
          {
            name: "watch-lines",
            workspaces: ["/tmp/watch-lines"],
            lifecycleState: "completed",
            lastRun: {
              id: "run-watch-lines",
              status: "completed",
              startedAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:01:00.000Z",
              completedAt: "2026-05-06T00:01:00.000Z",
              workspaces: [
                {
                  workspace: "/tmp/watch-lines",
                  status: "completed",
                  updatedAt: "2026-05-06T00:01:00.000Z",
                  completedAt: "2026-05-06T00:01:00.000Z",
                  exitCode: 0,
                },
              ],
            },
          },
        ],
      }),
      "utf8",
    );

    const exit = await runCli([
      "bun",
      "curort-cli-agent",
      "group",
      "watch",
      "watch-lines",
      "--json",
    ]);

    expect(exit).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain("\n");
    const snapshot = JSON.parse(logs[0] ?? "") as {
      group: { name: string };
      provenance: string;
      totals: { completed: number };
    };
    expect(snapshot.group.name).toBe("watch-lines");
    expect(snapshot.provenance).toBe("group-store+activity");
    expect(snapshot.totals.completed).toBe(1);
  });
});
