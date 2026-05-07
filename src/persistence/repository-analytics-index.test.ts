import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { RepositoryAnalyticsIndex } from "./repository-analytics-index";

describe("RepositoryAnalyticsIndex", () => {
  test("rebuild replaces derived rows and computes weighted percentages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repo-analytics-index-"));
    const index = new RepositoryAnalyticsIndex(join(dir, "analytics.db"));
    try {
      const first = index.rebuild({
        commits: [
          {
            commitHash: "a",
            commitDate: "2026-05-07T00:00:00.000Z",
            composerLinesAdded: 10,
            composerLinesDeleted: 0,
            v1AiPercentage: 0,
            v2AiPercentage: 50,
            provenance: "ai_tracking",
            completenessNotes: [],
          },
          {
            commitHash: "a",
            commitDate: "2026-05-07T01:00:00.000Z",
            composerLinesAdded: 20,
            composerLinesDeleted: 0,
            v1AiPercentage: 10,
            v2AiPercentage: 10,
            provenance: "ai_tracking",
            completenessNotes: [],
          },
          {
            commitHash: "b",
            composerLinesAdded: 30,
            composerLinesDeleted: 10,
            v1AiPercentage: 25,
            v2AiPercentage: 100,
            provenance: "ai_tracking",
            completenessNotes: [],
          },
        ],
        sessions: [],
        files: [],
        skippedRows: 0,
        provenance: ["ai_tracking"],
        completenessNotes: [],
      });
      expect(first.indexedCommits).toBe(2);
      expect(index.getSummary().weightedV1AiPercentage).toBe(20);
      expect(index.getSummary().weightedV2AiPercentage).toBe(70);

      index.rebuild({
        commits: [],
        sessions: [],
        files: [],
        skippedRows: 0,
        provenance: ["missing_rows"],
        completenessNotes: ["empty"],
      });

      expect(index.listCommits().commits).toEqual([]);
      expect(index.getSummary().provenance).toEqual(["missing_rows"]);
    } finally {
      index.close();
    }
  });

  test("falls back to unweighted percentages when line counts are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repo-analytics-unweighted-"));
    const index = new RepositoryAnalyticsIndex(join(dir, "analytics.db"));
    try {
      index.rebuild({
        commits: [
          {
            commitHash: "a",
            v1AiPercentage: 0,
            v2AiPercentage: 20,
            provenance: "ai_tracking",
            completenessNotes: [],
          },
          {
            commitHash: "b",
            v1AiPercentage: 50,
            v2AiPercentage: 80,
            provenance: "ai_tracking",
            completenessNotes: [],
          },
        ],
        sessions: [],
        files: [],
        skippedRows: 0,
        provenance: ["ai_tracking"],
        completenessNotes: ["composer line count columns are missing"],
      });

      const summary = index.getSummary();

      expect(summary.weightedV1AiPercentage).toBe(25);
      expect(summary.weightedV2AiPercentage).toBe(50);
      expect(summary.completenessNotes).toContain(
        "v1 AI percentage uses unweighted average because composer line counts are missing",
      );
      expect(summary.completenessNotes).toContain(
        "v2 AI percentage uses unweighted average because composer line counts are missing",
      );
    } finally {
      index.close();
    }
  });
});
