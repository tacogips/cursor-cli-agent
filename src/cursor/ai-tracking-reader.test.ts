import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createAiTrackingAnalyticsReader,
  createAiTrackingFileReader,
  loadAiTrackingEnrichment,
} from "./ai-tracking-reader";

describe("loadAiTrackingEnrichment", () => {
  test("returns undefined when database file is missing", () => {
    const got = loadAiTrackingEnrichment(
      "any-id",
      join(tmpdir(), "no-such-ai-tracking-db.sqlite"),
    );
    expect(got).toBeUndefined();
  });

  test("joins rows by conversationId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-track-"));
    const dbPath = join(dir, "track.db");
    const db = new Database(dbPath, { create: true });
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
CREATE TABLE conversation_summaries (
  conversationId TEXT PRIMARY KEY,
  title TEXT,
  tldr TEXT,
  overview TEXT,
  summaryBullets TEXT,
  model TEXT,
  mode TEXT,
  updatedAt INTEGER NOT NULL
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
      `INSERT INTO conversation_summaries (conversationId, title, updatedAt)
       VALUES ('conv-1', 'Hello', 1)`,
    );
    db.run(
      `INSERT INTO ai_code_hashes (hash, source, fileName, conversationId, createdAt)
       VALUES ('h1', 'src', 'a.ts', 'conv-1', 10)`,
    );
    db.run(
      `INSERT INTO ai_deleted_files (gitPath, conversationId, deletedAt)
       VALUES ('old.ts', 'conv-1', 20)`,
    );
    db.run(
      `INSERT INTO tracked_file_content (gitPath, content, conversationId, createdAt)
       VALUES ('b.ts', 'x', 'conv-1', 30)`,
    );
    db.close();

    const got = loadAiTrackingEnrichment("conv-1", dbPath);
    expect(got).toBeDefined();
    expect(got?.conversationId).toBe("conv-1");
    expect(got?.summary?.title).toBe("Hello");
    expect(got?.codeTouches.length).toBe(1);
    expect(got?.deletedFiles[0]?.gitPath).toBe("old.ts");
    expect(got?.trackedFiles[0]?.gitPath).toBe("b.ts");
    expect(got?.trackedFiles[0]?.contentBytes).toBe(1);
  });

  test("reports missing ai-tracking provenance for incompatible schemas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-track-missing-schema-"));
    const dbPath = join(dir, "track.db");
    const db = new Database(dbPath, { create: true });
    db.run("CREATE TABLE unrelated (id TEXT)");
    db.close();

    const reader = createAiTrackingFileReader(dbPath);
    const got = reader.listCodeTouches("conv-1");

    expect(got.provenance).toBe("missing_ai_tracking");
    expect(got.rows).toEqual([]);
  });

  test("loads snapshot content only when requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-track-content-"));
    const dbPath = join(dir, "track.db");
    const db = new Database(dbPath, { create: true });
    db.run(`
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
      `INSERT INTO tracked_file_content (gitPath, content, conversationId, createdAt)
       VALUES ('src/a.ts', 'hello', 'conv-1', 30)`,
    );
    db.close();

    const reader = createAiTrackingFileReader(dbPath);
    const metadataOnly = reader.listTrackedSnapshots("conv-1");
    const withContent = reader.listTrackedSnapshots("conv-1", {
      includeContent: true,
    });

    expect(metadataOnly.provenance).toBe("ai_tracking");
    expect(metadataOnly.rows[0]?.contentBytes).toBe(5);
    expect(metadataOnly.rows[0]?.content).toBeUndefined();
    expect(withContent.rows[0]?.content).toBe("hello");
  });

  test("reads scored commits with valid zero percentages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-track-scored-"));
    const dbPath = join(dir, "track.db");
    const db = new Database(dbPath, { create: true });
    db.run(`
CREATE TABLE scored_commits (
  commitHash TEXT PRIMARY KEY,
  branchName TEXT,
  commitMessage TEXT,
  commitDate TEXT,
  composerLinesAdded TEXT,
  composerLinesDeleted TEXT,
  v1AiPercentage TEXT,
  v2AiPercentage TEXT
);
`);
    db.run(
      `INSERT INTO scored_commits (
         commitHash, branchName, commitMessage, commitDate,
         composerLinesAdded, composerLinesDeleted, v1AiPercentage,
         v2AiPercentage
       ) VALUES ('abc', 'main', 'initial', '2026-05-07T00:00:00.000Z', '10', '5', '0.00', '40.5')`,
    );
    db.close();

    const got = createAiTrackingAnalyticsReader(dbPath).listScoredCommits();

    expect(got.provenance).toBe("ai_tracking");
    expect(got.rows[0]?.commitHash).toBe("abc");
    expect(got.rows[0]?.composerLinesAdded).toBe(10);
    expect(got.rows[0]?.composerLinesDeleted).toBe(5);
    expect(got.rows[0]?.v1AiPercentage).toBe(0);
    expect(got.rows[0]?.v2AiPercentage).toBe(40.5);
  });

  test("reports missing scored commits separately from missing database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-track-no-scored-"));
    const dbPath = join(dir, "track.db");
    const db = new Database(dbPath, { create: true });
    db.run("CREATE TABLE unrelated (id TEXT)");
    db.close();

    const got = createAiTrackingAnalyticsReader(dbPath).listScoredCommits();

    expect(got.provenance).toBe("missing_scored_commits");
    expect(got.rows).toEqual([]);
  });
});
