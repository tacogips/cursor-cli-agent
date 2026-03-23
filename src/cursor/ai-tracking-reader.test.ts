import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "vitest";

import { loadAiTrackingEnrichment } from "./ai-tracking-reader";

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
  });
});
