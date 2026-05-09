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
import { Database } from "bun:sqlite";

import { runCli, setCliTestOverrides } from "./cli";
import {
  parseDaemonStartArgs,
  parseServerStartArgs,
  renderDaemonStartResult,
  renderServerStartResult,
} from "./cli";
import * as groupsStore from "../persistence/groups-store";
import * as queuesStore from "../persistence/queues-store";
import { SessionIndexRepository } from "../persistence/session-index";
import { workspaceSlugFromPath } from "../config/paths";

const previousDataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
const previousConfigDir = process.env["CURSOR_CLI_AGENT_CONFIG_DIR"];
const previousCursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];

let testDir: string;
let logs: string[];
let errors: string[];
let logSpy: Mock<(message?: unknown) => void>;
let errorSpy: Mock<(message?: unknown) => void>;

async function seedSessionIndex(
  records: Parameters<SessionIndexRepository["upsert"]>[0][],
): Promise<void> {
  const dataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
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

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

describe("CLI search commands", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-cli-search-"));
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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

  test("renders files subcommands with ai-tracking provenance and rebuilt index", async () => {
    const cursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
    if (cursorHome === undefined) {
      throw new Error("test cursor home was not configured");
    }
    const workspace = resolve("/tmp/files-cli-workspace");
    await seedSessionIndex([
      {
        recordId: "rec-files",
        localSessionId: "conv-files",
        identityState: "transcript_only",
        workspaceSlug: "tmp-files-cli-workspace",
        workspacePath: workspace,
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);
    const aiTrackingDir = join(cursorHome, "ai-tracking");
    await mkdir(aiTrackingDir, { recursive: true });
    const db = new Database(join(aiTrackingDir, "ai-code-tracking.db"), {
      create: true,
    });
    db.run(`
CREATE TABLE ai_code_hashes (
  hash TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  fileExtension TEXT,
  fileName TEXT,
  requestId TEXT,
  conversationId TEXT,
  timestamp INTEGER,
  model TEXT,
  createdAt INTEGER NOT NULL
);
CREATE TABLE ai_deleted_files (
  gitPath TEXT NOT NULL,
  composerId TEXT,
  conversationId TEXT,
  model TEXT,
  deletedAt INTEGER NOT NULL,
  PRIMARY KEY (gitPath, deletedAt)
);
CREATE TABLE tracked_file_content (
  gitPath TEXT,
  content TEXT NOT NULL,
  conversationId TEXT,
  model TEXT,
  fileExtension TEXT,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (gitPath)
);
`);
    db.run(
      `INSERT INTO ai_code_hashes (hash, source, fileName, conversationId, timestamp, createdAt, model)
       VALUES ('h-files', 'src', ?, 'conv-files', 1000, 1000, 'gpt-5.4')`,
      [join(workspace, "src/a.ts")],
    );
    db.run(
      `INSERT INTO ai_deleted_files (gitPath, conversationId, deletedAt)
       VALUES ('src/old.ts', 'conv-files', 2000)`,
    );
    db.run(
      `INSERT INTO tracked_file_content (gitPath, content, conversationId, fileExtension, createdAt)
       VALUES ('src/a.ts', 'hello', 'conv-files', 'ts', 3000)`,
    );
    db.close();

    const listExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "files",
      "list",
      "conv-files",
      "--json",
    ]);
    expect(listExit).toBe(0);
    const list = JSON.parse(logs.join("\n")) as {
      provenance: string;
      files: Array<{ path: { path: string } }>;
    };
    expect(list.provenance).toBe("ai_tracking");
    expect(list.files[0]?.path.path).toBe("src/a.ts");

    logs = [];
    const snapshotsExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "files",
      "snapshots",
      "conv-files",
      "--include-content",
      "--json",
    ]);
    expect(snapshotsExit).toBe(0);
    const snapshots = JSON.parse(logs.join("\n")) as {
      snapshots: Array<{ content?: string; contentBytes: number }>;
    };
    expect(snapshots.snapshots[0]?.content).toBe("hello");
    expect(snapshots.snapshots[0]?.contentBytes).toBe(5);

    logs = [];
    const rebuildExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "files",
      "rebuild",
      "--json",
    ]);
    expect(rebuildExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).deletedFiles).toBe(1);

    logs = [];
    const findExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "files",
      "find",
      "src/old.ts",
      "--json",
    ]);
    expect(findExit).toBe(0);
    const found = JSON.parse(logs.join("\n")) as {
      totalEntries: number;
      entries: Array<{ operation: string }>;
    };
    expect(found.totalEntries).toBe(1);
    expect(found.entries[0]?.operation).toBe("deleted");
  });

  test("renders repo analytics rebuild and query JSON results", async () => {
    const cursorHome = process.env["CURSOR_CLI_AGENT_CURSOR_HOME"];
    if (cursorHome === undefined) {
      throw new Error("test cursor home was not configured");
    }
    const workspace = resolve("/tmp/repo-analytics-cli-workspace");
    await seedSessionIndex([
      {
        recordId: "rec-repo-analytics",
        localSessionId: "conv-repo-analytics",
        identityState: "transcript_only",
        workspaceSlug: "tmp-repo-analytics-cli-workspace",
        workspacePath: workspace,
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);
    const aiTrackingDir = join(cursorHome, "ai-tracking");
    await mkdir(aiTrackingDir, { recursive: true });
    const db = new Database(join(aiTrackingDir, "ai-code-tracking.db"), {
      create: true,
    });
    db.run(`
CREATE TABLE scored_commits (
  commitHash TEXT PRIMARY KEY,
  branchName TEXT,
  commitMessage TEXT,
  commitDate TEXT,
  v1AiPercentage TEXT,
  v2AiPercentage TEXT
);
CREATE TABLE ai_code_hashes (
  hash TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  fileExtension TEXT,
  fileName TEXT,
  requestId TEXT,
  conversationId TEXT,
  timestamp INTEGER,
  model TEXT,
  createdAt INTEGER NOT NULL
);
CREATE TABLE ai_deleted_files (
  gitPath TEXT NOT NULL,
  composerId TEXT,
  conversationId TEXT,
  model TEXT,
  deletedAt INTEGER NOT NULL,
  PRIMARY KEY (gitPath, deletedAt)
);
CREATE TABLE tracked_file_content (
  gitPath TEXT,
  content TEXT NOT NULL,
  conversationId TEXT,
  model TEXT,
  fileExtension TEXT,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (gitPath)
);
`);
    db.run(
      `INSERT INTO scored_commits (
         commitHash, branchName, commitMessage, commitDate,
         v1AiPercentage, v2AiPercentage
       ) VALUES ('repoabc', 'main', 'analytics', '2026-05-07T00:00:00.000Z', '0.00', '50.00')`,
    );
    db.run(
      `INSERT INTO ai_code_hashes (hash, source, fileName, conversationId, timestamp, createdAt)
       VALUES ('h-repo-analytics', 'src', 'src/repo.ts', 'conv-repo-analytics', 1000, 1000)`,
    );
    db.close();

    const rebuildExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "rebuild",
      "--json",
    ]);
    expect(rebuildExit).toBe(0);
    const rebuild = JSON.parse(logs.join("\n")) as {
      indexedCommits: number;
      indexedSessions: number;
      indexedFiles: number;
      provenance: string[];
    };
    expect(rebuild.indexedCommits).toBe(1);
    expect(rebuild.indexedSessions).toBe(1);
    expect(rebuild.indexedFiles).toBe(1);
    expect(rebuild.provenance).toContain("ai_tracking");
    expect(rebuild.provenance).toContain("file_intelligence");

    logs = [];
    const summaryExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "summary",
      "--json",
    ]);
    expect(summaryExit).toBe(0);
    const summary = JSON.parse(logs.join("\n")) as {
      weightedV1AiPercentage: number;
      weightedV2AiPercentage: number;
      completenessNotes: string[];
    };
    expect(summary.weightedV1AiPercentage).toBe(0);
    expect(summary.weightedV2AiPercentage).toBe(50);
    expect(summary.completenessNotes).toContain(
      "composer line count columns are missing",
    );
    expect(summary.completenessNotes).toContain(
      "v1 AI percentage uses unweighted average because composer line counts are missing",
    );

    logs = [];
    const commitsExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "commits",
      "--limit",
      "1",
      "--json",
    ]);
    expect(commitsExit).toBe(0);
    const commits = JSON.parse(logs.join("\n")) as {
      commits: Array<{ commitHash: string; v1AiPercentage: number }>;
    };
    expect(commits.commits[0]?.commitHash).toBe("repoabc");
    expect(commits.commits[0]?.v1AiPercentage).toBe(0);

    logs = [];
    const sessionsExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "sessions",
      "--json",
    ]);
    expect(sessionsExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).sessions[0].touchedFiles).toBe(1);

    logs = [];
    const filesExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "files",
      "--json",
    ]);
    expect(filesExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).files[0].path).toBe("src/repo.ts");

    errors = [];
    const invalidLimit = await runCli([
      "bun",
      "cursor-cli-agent",
      "repo",
      "analytics",
      "commits",
      "--limit",
      "0",
    ]);
    expect(invalidLimit).toBe(2);
    expect(errors[0]).toBe(
      "repo analytics: --limit must be a positive integer",
    );
  });

  test("renders markdown task extraction JSON results", async () => {
    const transcriptPath = join(testDir, "markdown-cli.jsonl");
    await writeFile(
      transcriptPath,
      [
        transcriptLine("user", "Ignore this"),
        transcriptLine(
          "assistant",
          ["# Plan", "- [ ] first task", "- [x] done task"].join("\n"),
        ),
      ].join("\n"),
      "utf8",
    );
    await seedSessionIndex([
      {
        recordId: "rec-markdown-cli",
        localSessionId: "local-markdown-cli",
        cursorChatId: "chat-markdown-cli",
        identityState: "linked",
        workspaceSlug: "tmp-markdown-cli",
        workspacePath: resolve("/tmp/markdown-cli"),
        transcriptPath,
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);

    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
      "markdown",
      "tasks",
      "--session",
      "chat-markdown-cli",
      "--checked",
      "false",
      "--json",
    ]);

    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      sessionId: string;
      totalTasks: number;
      tasks: Array<{ messageId: string; checked: boolean; text: string }>;
    };
    expect(parsed.sessionId).toBe("local-markdown-cli");
    expect(parsed.totalTasks).toBe(1);
    expect(parsed.tasks).toEqual([
      expect.objectContaining({
        messageId: "event-1-assistant",
        checked: false,
        text: "first task",
      }),
    ]);
  });

  test("rejects invalid markdown task flags", async () => {
    const missingSession = await runCli([
      "bun",
      "cursor-cli-agent",
      "markdown",
      "tasks",
    ]);

    expect(missingSession).toBe(2);
    expect(errors[0]).toBe("markdown tasks: --session is required");

    logs = [];
    errors = [];
    const invalidChecked = await runCli([
      "bun",
      "cursor-cli-agent",
      "markdown",
      "tasks",
      "--session",
      "chat-markdown-cli",
      "--checked",
      "maybe",
    ]);

    expect(invalidChecked).toBe(2);
    expect(errors[0]).toBe("markdown tasks: --checked must be true or false");
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
      "activity",
      "--status",
      "waiting_approval",
    ]);
    expect(invalidStatus).toBe(2);
    expect(errors[0]).toContain("activity: --status must be");

    errors = [];
    const missing = await runCli([
      "bun",
      "cursor-cli-agent",
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
      "cursor-cli-agent",
      "group",
      "create",
      "lifecycle",
    ]);
    expect(createExit).toBe(0);

    logs = [];
    const pauseExit = await runCli([
      "bun",
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
    await runCli(["bun", "cursor-cli-agent", "group", "create", "paused-run"]);
    await runCli(["bun", "cursor-cli-agent", "group", "pause", "paused-run"]);
    logs = [];
    errors = [];

    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
      await runCli(["bun", "cursor-cli-agent", "group", "create", "mid-run"]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "group",
        "add",
        "mid-run",
        "--workspace",
        "/tmp/mid-run-1",
      ]);
      await runCli([
        "bun",
        "cursor-cli-agent",
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
        "cursor-cli-agent",
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
    const dataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
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
      "cursor-cli-agent",
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
      "cursor-cli-agent",
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
    const dataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
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
      "cursor-cli-agent",
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
    const dataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];
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
      "cursor-cli-agent",
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

describe("CLI server command", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-cli-server-"));
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = join(testDir, "data");
    process.env["CURSOR_CLI_AGENT_CONFIG_DIR"] = join(testDir, "config");
    process.env["CURSOR_CLI_AGENT_CURSOR_HOME"] = join(testDir, "cursor");
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

  test("parses server start flags and validates TCP port range", () => {
    const parsed = parseServerStartArgs([
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--token",
      "secret",
      "--json",
    ]);
    expect("args" in parsed ? parsed.args : undefined).toEqual({
      host: "127.0.0.1",
      port: 0,
      token: "secret",
      json: true,
    });

    const invalid = parseServerStartArgs(["--port", "65536"]);
    expect("error" in invalid ? invalid.error : undefined).toBe(
      "server start: --port must be an integer from 0 to 65535",
    );
  });

  test("renders server start output in JSON and human modes", () => {
    renderServerStartResult(
      {
        status: "running",
        host: "127.0.0.1",
        port: 1234,
        url: "http://127.0.0.1:1234",
        auth: "bearer",
      },
      true,
    );
    expect(JSON.parse(logs[0] ?? "{}")).toEqual({
      status: "running",
      host: "127.0.0.1",
      port: 1234,
      url: "http://127.0.0.1:1234",
      auth: "bearer",
    });

    logs = [];
    renderServerStartResult(
      {
        status: "running",
        host: "127.0.0.1",
        port: 4321,
        url: "http://127.0.0.1:4321",
        auth: "none",
      },
      false,
    );
    expect(logs).toEqual([
      "Server listening on http://127.0.0.1:4321",
      "Auth: none",
    ]);
  });

  test("starts server command and stops on SIGTERM", async () => {
    let stopped = false;
    const restore = setCliTestOverrides({
      startHttpServer: async (config) => ({
        host: config.host,
        port: 3210,
        url: `http://${config.host}:3210`,
        async stop(): Promise<void> {
          stopped = true;
        },
      }),
    });
    try {
      const run = runCli([
        "bun",
        "cursor-cli-agent",
        "server",
        "start",
        "--port",
        "0",
        "--json",
      ]);
      await new Promise<void>((resolveWait) => {
        setTimeout(resolveWait, 0);
      });
      process.emit("SIGTERM");
      const exit = await run;
      expect(exit).toBe(0);
      expect(stopped).toBe(true);
      expect(JSON.parse(logs.join("\n"))).toMatchObject({
        status: "running",
        host: "127.0.0.1",
        port: 3210,
        auth: "none",
      });
    } finally {
      restore();
    }
  });

  test("manages local API tokens in human and JSON modes", async () => {
    const createdExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "create",
      "--name",
      "cli token",
      "--permissions",
      "session:read,group:*",
      "--expires-at",
      "2030-01-01T00:00:00.000Z",
      "--json",
    ]);
    expect(createdExit).toBe(0);
    const created = JSON.parse(logs.join("\n")) as {
      token: string;
      metadata: { id: string; permissions: string[]; expiresAt: string };
    };
    expect(created.metadata.permissions).toEqual(["session:read", "group:*"]);
    expect(created.metadata.expiresAt).toBe("2030-01-01T00:00:00.000Z");
    expect(JSON.stringify(created.metadata)).not.toContain("tokenHash");

    logs = [];
    const listExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "list",
      "--json",
    ]);
    expect(listExit).toBe(0);
    const listed = JSON.parse(logs.join("\n")) as {
      tokens: Array<{ id: string; name: string }>;
    };
    expect(listed.tokens[0]?.id).toBe(created.metadata.id);
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");

    logs = [];
    const rotateExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "rotate",
      created.metadata.id,
      "--json",
    ]);
    expect(rotateExit).toBe(0);
    const rotated = JSON.parse(logs.join("\n")) as { token: string };
    expect(rotated.token).not.toBe(created.token);

    logs = [];
    const revokeExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "revoke",
      created.metadata.id,
    ]);
    expect(revokeExit).toBe(0);
    expect(logs[0]).toBe(`revoked=${created.metadata.id}`);
  });

  test("rejects token usage, invalid permissions, invalid expiry, and missing ids", async () => {
    const missingName = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "create",
    ]);
    expect(missingName).toBe(2);
    expect(errors[0]).toBe("token create: --name is required");

    errors = [];
    const invalidPermission = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "create",
      "--name",
      "bad",
      "--permissions",
      "session:read,nope",
    ]);
    expect(invalidPermission).toBe(2);
    expect(errors[0]).toBe("token create: invalid permissions: nope");

    errors = [];
    const invalidExpiry = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "create",
      "--name",
      "bad",
      "--expires-at",
      "not-a-date",
    ]);
    expect(invalidExpiry).toBe(2);
    expect(errors[0]).toBe(
      "token create: --expires-at must be a valid ISO 8601 timestamp",
    );

    errors = [];
    const notFound = await runCli([
      "bun",
      "cursor-cli-agent",
      "token",
      "revoke",
      "missing",
    ]);
    expect(notFound).toBe(3);
    expect(errors[0]).toBe("token revoke: token not found: missing");
  });
});

describe("CLI queue lifecycle commands", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-cli-queue-"));
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

  test("pauses, resumes, updates, moves, modes, stops, and deletes queues as JSON", async () => {
    await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "create",
      "lifecycle",
      "--workspace",
      "/tmp/queue-lifecycle",
    ]);
    await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "add",
      "lifecycle",
      "--prompt",
      "first",
    ]);
    await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "add",
      "lifecycle",
      "--prompt",
      "second",
    ]);
    const firstItem = (await queuesStore.getQueue("lifecycle"))?.items[0]?.id;
    expect(firstItem).toBeDefined();

    logs = [];
    const pauseExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "pause",
      "lifecycle",
      "--json",
    ]);
    expect(pauseExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).lifecycleState).toBe("paused");

    logs = [];
    const resumeExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "resume",
      "lifecycle",
      "--json",
    ]);
    expect(resumeExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).lifecycleState).toBe("active");

    logs = [];
    const updateExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "update",
      "lifecycle",
      "--item",
      firstItem ?? "",
      "--status",
      "skipped",
      "--json",
    ]);
    expect(updateExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).items[0].status).toBe("skipped");

    logs = [];
    const modeExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "mode",
      "lifecycle",
      "--item",
      firstItem ?? "",
      "--mode",
      "manual",
      "--json",
    ]);
    expect(modeExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).items[0].mode).toBe("manual");

    logs = [];
    const moveExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "move",
      "lifecycle",
      "--from",
      "0",
      "--to",
      "1",
      "--json",
    ]);
    expect(moveExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).items[1].id).toBe(firstItem);

    logs = [];
    const stopExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "stop",
      "lifecycle",
      "--json",
    ]);
    expect(stopExit).toBe(0);
    expect(JSON.parse(logs.join("\n")).name).toBe("lifecycle");

    logs = [];
    const deleteExit = await runCli([
      "bun",
      "cursor-cli-agent",
      "queue",
      "delete",
      "lifecycle",
      "--json",
    ]);
    expect(deleteExit).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      deleted: true,
      queue: { name: "lifecycle" },
    });
  });

  test("guards paused queue runs before launching Cursor", async () => {
    let launched = false;
    const restore = setCliTestOverrides({
      runHeadlessStreaming: async () => {
        launched = true;
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    try {
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "create",
        "paused-run",
      ]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "add",
        "paused-run",
        "--prompt",
        "should not launch",
      ]);
      await runCli(["bun", "cursor-cli-agent", "queue", "pause", "paused-run"]);
      logs = [];
      errors = [];

      const exit = await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "run",
        "paused-run",
      ]);

      expect(exit).toBe(1);
      expect(launched).toBe(false);
      expect(errors[0]).toBe("queue run: queue is paused");
      expect(
        (await queuesStore.getQueue("paused-run"))?.lastRun,
      ).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("retains completed items and skips manual items during queue run", async () => {
    let runCount = 0;
    const restore = setCliTestOverrides({
      runHeadlessStreaming: async (_options, onLine) => {
        runCount += 1;
        onLine(
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: `queue-session-${runCount}`,
            cwd: `/tmp/queue-run-${runCount}`,
          }),
        );
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    try {
      await runCli(["bun", "cursor-cli-agent", "queue", "create", "run"]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "add",
        "run",
        "--prompt",
        "auto",
      ]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "add",
        "run",
        "--prompt",
        "manual",
      ]);
      const manualItem = (await queuesStore.getQueue("run"))?.items[1]?.id;
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "mode",
        "run",
        "--item",
        manualItem ?? "",
        "--mode",
        "manual",
      ]);
      logs = [];
      errors = [];

      const exit = await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "run",
        "run",
      ]);

      expect(exit).toBe(0);
      expect(runCount).toBe(1);
      const queue = await queuesStore.getQueue("run");
      expect(queue?.lifecycleState).toBe("completed");
      expect(queue?.lastRun?.status).toBe("completed");
      expect(queue?.items.map((item) => item.status)).toEqual([
        "completed",
        "pending",
      ]);
      expect(queue?.items[0]?.localSessionId).toBe("queue-session-1");
      expect(queue?.items[0]?.result?.exitCode).toBe(0);
    } finally {
      restore();
    }
  });

  test("cooperatively stops queue runs between items", async () => {
    let runCount = 0;
    const restore = setCliTestOverrides({
      runHeadlessStreaming: async () => {
        runCount += 1;
        if (runCount === 1) {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const queue = await queuesStore.getQueue("stop-run");
            if (queue?.lastRun?.status === "running") {
              break;
            }
            await new Promise((resolvePoll) => {
              setTimeout(resolvePoll, 1);
            });
          }
          await queuesStore.requestQueueStop("stop-run");
        }
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    try {
      await runCli(["bun", "cursor-cli-agent", "queue", "create", "stop-run"]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "add",
        "stop-run",
        "--prompt",
        "first",
      ]);
      await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "add",
        "stop-run",
        "--prompt",
        "second",
      ]);

      const exit = await runCli([
        "bun",
        "cursor-cli-agent",
        "queue",
        "run",
        "stop-run",
      ]);

      expect(exit).toBe(0);
      expect(runCount).toBe(1);
      const queue = await queuesStore.getQueue("stop-run");
      expect(queue?.lifecycleState).toBe("stopped");
      expect(queue?.lastRun?.status).toBe("stopped");
      expect(queue?.items.map((item) => item.status)).toEqual([
        "completed",
        "pending",
      ]);
    } finally {
      restore();
    }
  });

  test("parses daemon start flags and validates port and timeout", () => {
    const parsed = parseDaemonStartArgs([
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--token",
      "secret",
      "--timeout-ms",
      "2500",
      "--json",
    ]);
    expect("args" in parsed ? parsed.args : undefined).toEqual({
      host: "127.0.0.1",
      port: 0,
      token: "secret",
      timeoutMs: 2500,
      json: true,
    });

    const invalidPort = parseDaemonStartArgs(["--port", "65536"]);
    expect("error" in invalidPort ? invalidPort.error : undefined).toBe(
      "daemon start: --port must be an integer from 0 to 65535",
    );
    const invalidTimeout = parseDaemonStartArgs(["--timeout-ms", "0"]);
    expect("error" in invalidTimeout ? invalidTimeout.error : undefined).toBe(
      "daemon start: --timeout-ms must be a positive integer",
    );
  });

  test("renders daemon start output without raw token values", () => {
    renderDaemonStartResult(
      {
        state: "running",
        metadata: {
          schemaVersion: 1,
          state: "running",
          pid: 123,
          parentPid: 1,
          marker: "marker",
          commandPath: "/bin/bun",
          host: "127.0.0.1",
          port: 4444,
          baseUrl: "http://127.0.0.1:4444",
          dataDir: "/tmp/data",
          configDir: "/tmp/config",
          serverMode: "http",
          startedAt: "2026-05-07T00:00:00.000Z",
          auth: { mode: "required", tokenConfigured: true },
        },
        readiness: { ready: true, statusCode: 200 },
      },
      true,
    );
    const parsed = JSON.parse(logs[0] ?? "{}") as {
      metadata: { auth: { tokenConfigured: boolean }; token?: string };
    };
    expect(parsed.metadata.auth.tokenConfigured).toBe(true);
    expect(parsed.metadata.token).toBeUndefined();
  });

  test("runs daemon CLI commands through manager override", async () => {
    const restore = setCliTestOverrides({
      daemonManager: {
        async start(options) {
          expect(options?.port).toBe(0);
          return {
            state: "running",
            metadata: {
              schemaVersion: 1,
              state: "running",
              pid: 456,
              parentPid: 1,
              marker: "marker",
              commandPath: "/bin/bun",
              host: "127.0.0.1",
              port: 3210,
              baseUrl: "http://127.0.0.1:3210",
              dataDir: "/tmp/data",
              configDir: "/tmp/config",
              serverMode: "http",
              startedAt: "2026-05-07T00:00:00.000Z",
              auth: { mode: "disabled", tokenConfigured: false },
            },
            readiness: { ready: true, statusCode: 200 },
          };
        },
        async status(options) {
          expect(options?.token).toBe("status-token");
          return { state: "running" };
        },
        async stop() {
          return { state: "stopped", stopped: true };
        },
      },
    });
    try {
      const startExit = await runCli([
        "bun",
        "cursor-cli-agent",
        "daemon",
        "start",
        "--port",
        "0",
        "--json",
      ]);
      expect(startExit).toBe(0);
      expect(JSON.parse(logs.join("\n")).metadata.port).toBe(3210);

      logs = [];
      const statusExit = await runCli([
        "bun",
        "cursor-cli-agent",
        "daemon",
        "status",
        "--token",
        "status-token",
        "--json",
      ]);
      expect(statusExit).toBe(0);
      expect(JSON.parse(logs.join("\n")).state).toBe("running");

      logs = [];
      const stopExit = await runCli([
        "bun",
        "cursor-cli-agent",
        "daemon",
        "stop",
        "--json",
      ]);
      expect(stopExit).toBe(0);
      expect(JSON.parse(logs.join("\n")).stopped).toBe(true);
    } finally {
      restore();
    }
  });

  test("rejects daemon force stop in this slice", async () => {
    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
      "daemon",
      "stop",
      "--force",
    ]);
    expect(exit).toBe(2);
    expect(errors[0]).toBe("daemon stop: --force is not supported");
  });
});

describe("CLI session fork and image flags", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-cli-fork-"));
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

  test("session fork dry-run emits JSON replay plan", async () => {
    const workspace = join(testDir, "ws");
    await mkdir(workspace, { recursive: true });
    const transcriptPath = join(workspace, "t.jsonl");
    await writeFile(
      transcriptPath,
      [transcriptLine("user", "hi"), transcriptLine("assistant", "yo")].join(
        "\n",
      ),
      "utf8",
    );
    await seedSessionIndex([
      {
        recordId: "rec-fork",
        localSessionId: "local-fork",
        identityState: "transcript_only",
        workspaceSlug: workspaceSlugFromPath(workspace),
        workspacePath: resolve(workspace),
        transcriptPath,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        source: "headless",
        status: "completed",
      },
    ]);

    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
      "session",
      "fork",
      "local-fork",
      "--prompt",
      "go on",
      "--dry-run",
      "--json",
      "--stream",
      "json",
      "--workspace",
      resolve(workspace),
    ]);
    expect(exit).toBe(0);
    const line = logs.find((l) => l.startsWith("{"));
    expect(line).toBeDefined();
    const payload = JSON.parse(line ?? "{}") as {
      mode: string;
      replay: { messageCount: number };
    };
    expect(payload.mode).toBe("best_effort_replay");
    expect(payload.replay.messageCount).toBe(2);
  });

  test("session fork rejects conflicting boundaries", async () => {
    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
      "session",
      "fork",
      "any",
      "--prompt",
      "x",
      "--through-message",
      "event-0-user",
      "--nth-message",
      "1",
      "--stream",
      "json",
    ]);
    expect(exit).toBe(2);
    expect(errors.some((e) => e.includes("mutually exclusive"))).toBe(true);
  });

  test("session run rejects --image without path", async () => {
    const exit = await runCli([
      "bun",
      "cursor-cli-agent",
      "session",
      "run",
      "--prompt",
      "hi",
      "--image",
      "--stream",
      "json",
    ]);
    expect(exit).toBe(2);
    expect(errors.some((e) => e.includes("requires a path"))).toBe(true);
  });
});
