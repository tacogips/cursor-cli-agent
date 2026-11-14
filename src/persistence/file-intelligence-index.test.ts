import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { FileIntelligenceIndex } from "./file-intelligence-index";

let testDir: string;
let index: FileIntelligenceIndex;

describe("FileIntelligenceIndex", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "file-index-"));
    index = new FileIntelligenceIndex(join(testDir, "file-index.db"));
  });

  afterEach(async () => {
    index.close();
    await rm(testDir, { recursive: true, force: true });
  });

  test("reports missing rows before the index is rebuilt", () => {
    const result = index.findByPath("src/a.ts");

    expect(result.needsRebuild).toBe(true);
    expect(result.index.provenance).toBe("missing_rows");
    expect(result.totalEntries).toBe(0);
  });

  test("rebuild replaces derived rows atomically and supports path lookup", () => {
    index.rebuild({
      indexedSessions: 1,
      skippedSessions: 0,
      provenance: "ai_tracking",
      entries: [
        {
          sessionId: "local-1",
          recordId: "rec-1",
          conversationId: "local-1",
          rawPath: "/tmp/work/src/a.ts",
          normalizedPath: "src/a.ts",
          pathKind: "workspace_relative",
          operation: "touched",
          observedAt: "2026-05-07T00:00:00.000Z",
          model: "gpt-5.4",
          provenance: "ai_tracking",
        },
      ],
    });

    const first = index.findByPath("src/a.ts");
    expect(first.needsRebuild).toBe(false);
    expect(first.totalEntries).toBe(1);
    expect(first.entries[0]?.operation).toBe("touched");
    expect(first.index.touchedFiles).toBe(1);

    index.rebuild({
      indexedSessions: 0,
      skippedSessions: 1,
      provenance: "ai_tracking",
      entries: [],
    });

    const second = index.findByPath("src/a.ts");
    expect(second.needsRebuild).toBe(false);
    expect(second.totalEntries).toBe(0);
    expect(second.index.touchedFiles).toBe(0);
  });
});
