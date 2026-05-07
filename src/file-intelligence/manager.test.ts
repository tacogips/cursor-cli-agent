import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createFileIntelligenceService,
  FileIntelligenceNotFoundError,
} from "./manager";
import type { AiTrackingFileReader } from "../cursor/ai-tracking-reader";
import { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import { SessionIndexRepository } from "../persistence/session-index";

let testDir: string;
let sessions: SessionIndexRepository;
let index: FileIntelligenceIndex;

function reader(): AiTrackingFileReader {
  return {
    listCodeTouches() {
      return {
        provenance: "ai_tracking",
        rows: [
          {
            fileName: resolve("/tmp/work/src/a.ts"),
            model: "gpt-5.4",
            timestamp: 1000,
          },
          {
            fileName: resolve("/tmp/work/src/a.ts"),
            model: "gpt-5.4",
            timestamp: 2000,
          },
        ],
      };
    },
    listTrackedSnapshots(_conversationId, options = {}) {
      const snapshot =
        options.includeContent === true
          ? {
              gitPath: "src/a.ts",
              content: "content",
              contentBytes: 7,
              fileExtension: "ts",
              createdAt: 3000,
            }
          : {
              gitPath: "src/a.ts",
              contentBytes: 7,
              fileExtension: "ts",
              createdAt: 3000,
            };
      return {
        provenance: "ai_tracking",
        rows: [snapshot],
      };
    },
    listDeletedFiles() {
      return {
        provenance: "ai_tracking",
        rows: [{ gitPath: "src/old.ts", deletedAt: 4000 }],
      };
    },
    listConversationFileRefs() {
      return {
        provenance: "ai_tracking",
        rows: [
          {
            conversationId: "local-1",
            path: "src/a.ts",
            operation: "touched",
            observedAt: 1000,
          },
          {
            conversationId: "local-1",
            path: "src/old.ts",
            operation: "deleted",
            observedAt: 4000,
          },
        ],
      };
    },
  };
}

describe("FileIntelligenceManager", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "file-intel-manager-"));
    sessions = new SessionIndexRepository(join(testDir, "state.db"));
    index = new FileIntelligenceIndex(join(testDir, "file-index.db"));
    sessions.upsert({
      recordId: "rec-1",
      localSessionId: "local-1",
      identityState: "transcript_only",
      workspaceSlug: "tmp-work",
      workspacePath: resolve("/tmp/work"),
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:01:00.000Z",
      source: "headless",
      status: "completed",
    });
  });

  afterEach(async () => {
    sessions.close();
    index.close();
    await rm(testDir, { recursive: true, force: true });
  });

  test("lists touched, snapshot, and deleted file intelligence", async () => {
    const service = createFileIntelligenceService({
      sessions,
      aiTracking: reader(),
      index,
    });

    const files = await service.listFiles("local-1");
    const snapshots = await service.listSnapshots("local-1", {
      includeContent: true,
    });
    const deleted = await service.listDeleted("local-1");

    expect(files.provenance).toBe("ai_tracking");
    expect(files.files[0]?.path.path).toBe("src/a.ts");
    expect(files.files[0]?.changeCount).toBe(2);
    expect(snapshots.snapshots[0]?.content).toBe("content");
    expect(deleted.deletedFiles[0]?.path.path).toBe("src/old.ts");
  });

  test("rebuilds and finds indexed file history", async () => {
    const service = createFileIntelligenceService({
      sessions,
      aiTracking: reader(),
      index,
    });

    const stats = await service.rebuild();
    const found = await service.findFile("src/old.ts");

    expect(stats.indexedSessions).toBe(1);
    expect(stats.deletedFiles).toBe(1);
    expect(found.totalEntries).toBe(1);
    expect(found.entries[0]?.operation).toBe("deleted");
  });

  test("fails unknown sessions with not-found error", async () => {
    const service = createFileIntelligenceService({
      sessions,
      aiTracking: reader(),
      index,
    });

    await expect(service.listFiles("missing")).rejects.toThrow(
      FileIntelligenceNotFoundError,
    );
  });
});
