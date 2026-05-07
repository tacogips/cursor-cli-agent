import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  RepositoryAnalyticsProvenance,
  RepositoryAnalyticsRebuildStats,
  RepositoryAnalyticsSummary,
  RepositoryCommitListOptions,
  RepositoryCommitListResult,
  RepositoryFileAnalytics,
  RepositoryFileAnalyticsOptions,
  RepositoryFileAnalyticsResult,
  RepositorySessionAnalytics,
  RepositorySessionAnalyticsOptions,
  RepositorySessionAnalyticsResult,
  ScoredCommitAnalytics,
} from "../types/repository-analytics";

export interface RepositoryAnalyticsRebuildInput {
  readonly commits: readonly ScoredCommitAnalytics[];
  readonly sessions: readonly RepositorySessionAnalytics[];
  readonly files: readonly RepositoryFileAnalytics[];
  readonly skippedRows: number;
  readonly provenance: readonly RepositoryAnalyticsProvenance[];
  readonly completenessNotes: readonly string[];
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS repository_analytics_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  indexed_commits INTEGER NOT NULL,
  indexed_sessions INTEGER NOT NULL,
  indexed_files INTEGER NOT NULL,
  skipped_rows INTEGER NOT NULL,
  total_composer_lines INTEGER NOT NULL,
  weighted_v1_ai_percentage REAL,
  weighted_v2_ai_percentage REAL,
  updated_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_commits (
  commit_hash TEXT PRIMARY KEY,
  branch_name TEXT,
  commit_message TEXT,
  commit_date TEXT,
  composer_lines_added INTEGER,
  composer_lines_deleted INTEGER,
  v1_ai_percentage REAL,
  v2_ai_percentage REAL,
  provenance TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_sessions (
  session_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  conversation_id TEXT,
  workspace_path TEXT,
  touched_files INTEGER NOT NULL,
  deleted_files INTEGER NOT NULL,
  snapshots INTEGER NOT NULL,
  unknown_files INTEGER NOT NULL,
  provenance_json TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_files (
  path TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL,
  touched_count INTEGER NOT NULL,
  deleted_count INTEGER NOT NULL,
  snapshot_count INTEGER NOT NULL,
  first_observed_at TEXT,
  last_observed_at TEXT,
  provenance_json TEXT NOT NULL
);
`;

export class RepositoryAnalyticsIndex {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(MIGRATION);
  }

  close(): void {
    this.db.close();
  }

  rebuild(
    input: RepositoryAnalyticsRebuildInput,
  ): RepositoryAnalyticsRebuildStats {
    const updatedAt = new Date().toISOString();
    const commits = uniqueCommits(input.commits);
    const summary = summarizeCommits(commits);
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM repository_analytics_commits");
      this.db.run("DELETE FROM repository_analytics_sessions");
      this.db.run("DELETE FROM repository_analytics_files");
      this.db.run("DELETE FROM repository_analytics_meta");
      const insertCommit = this.db.prepare(`
INSERT INTO repository_analytics_commits (
  commit_hash, branch_name, commit_message, commit_date,
  composer_lines_added, composer_lines_deleted, v1_ai_percentage,
  v2_ai_percentage, provenance, completeness_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const commit of commits) {
        insertCommit.run(
          commit.commitHash,
          commit.branchName ?? null,
          commit.commitMessage ?? null,
          commit.commitDate ?? null,
          commit.composerLinesAdded ?? null,
          commit.composerLinesDeleted ?? null,
          commit.v1AiPercentage ?? null,
          commit.v2AiPercentage ?? null,
          commit.provenance,
          JSON.stringify(commit.completenessNotes),
        );
      }
      const insertSession = this.db.prepare(`
INSERT INTO repository_analytics_sessions (
  session_id, record_id, conversation_id, workspace_path, touched_files,
  deleted_files, snapshots, unknown_files, provenance_json,
  completeness_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const session of input.sessions) {
        insertSession.run(
          session.sessionId,
          session.recordId,
          session.conversationId ?? null,
          session.workspacePath ?? null,
          session.touchedFiles,
          session.deletedFiles,
          session.snapshots,
          session.unknownFiles,
          JSON.stringify(session.provenance),
          JSON.stringify(session.completenessNotes),
        );
      }
      const insertFile = this.db.prepare(`
INSERT INTO repository_analytics_files (
  path, sessions, touched_count, deleted_count, snapshot_count,
  first_observed_at, last_observed_at, provenance_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const file of input.files) {
        insertFile.run(
          file.path,
          file.sessions,
          file.touchedCount,
          file.deletedCount,
          file.snapshotCount,
          file.firstObservedAt ?? null,
          file.lastObservedAt ?? null,
          JSON.stringify(file.provenance),
        );
      }
      this.db
        .prepare(
          `INSERT INTO repository_analytics_meta (
            singleton_id, indexed_commits, indexed_sessions, indexed_files,
            skipped_rows, total_composer_lines, weighted_v1_ai_percentage,
            weighted_v2_ai_percentage, updated_at, provenance_json,
            completeness_notes_json
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          commits.length,
          input.sessions.length,
          input.files.length,
          input.skippedRows,
          summary.totalComposerLines,
          summary.weightedV1AiPercentage ?? null,
          summary.weightedV2AiPercentage ?? null,
          updatedAt,
          JSON.stringify(input.provenance),
          JSON.stringify([
            ...input.completenessNotes,
            ...summary.completenessNotes,
          ]),
        );
    });
    tx();
    return {
      indexedCommits: commits.length,
      indexedSessions: input.sessions.length,
      indexedFiles: input.files.length,
      skippedRows: input.skippedRows,
      updatedAt,
      provenance: input.provenance,
      completenessNotes: input.completenessNotes,
    };
  }

  getSummary(): RepositoryAnalyticsSummary {
    const row = this.db
      .query("SELECT * FROM repository_analytics_meta WHERE singleton_id = 1")
      .get() as Record<string, unknown> | null;
    if (row === null) {
      return {
        totalCommits: 0,
        scoredCommits: 0,
        totalComposerLines: 0,
        provenance: ["missing_rows"],
        completenessNotes: ["repository analytics index has not been rebuilt"],
      };
    }
    const weightedV1AiPercentage = optionalNumber(
      row["weighted_v1_ai_percentage"],
    );
    const weightedV2AiPercentage = optionalNumber(
      row["weighted_v2_ai_percentage"],
    );
    const updatedAt = stringValue(row["updated_at"]);
    return {
      totalCommits: numberValue(row["indexed_commits"]),
      scoredCommits: numberValue(row["indexed_commits"]),
      totalComposerLines: numberValue(row["total_composer_lines"]),
      ...(weightedV1AiPercentage !== undefined
        ? { weightedV1AiPercentage }
        : {}),
      ...(weightedV2AiPercentage !== undefined
        ? { weightedV2AiPercentage }
        : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      provenance: provenanceList(row["provenance_json"]),
      completenessNotes: stringList(row["completeness_notes_json"]),
    };
  }

  listCommits(
    options: RepositoryCommitListOptions = {},
  ): RepositoryCommitListResult {
    const limit = sanitizeLimit(options.limit, 200);
    const rows = this.db
      .query(
        `SELECT * FROM repository_analytics_commits
         ORDER BY COALESCE(commit_date, '') DESC, commit_hash ASC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    const commits = rows.map(rowToCommit);
    return {
      commits,
      totalCommits: commits.length,
      provenance: commits.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes:
        commits.length > 0 ? [] : ["repository analytics index has no commits"],
    };
  }

  listSessions(
    options: RepositorySessionAnalyticsOptions = {},
  ): RepositorySessionAnalyticsResult {
    const limit = sanitizeLimit(options.limit, 200);
    const rows = this.db
      .query(
        `SELECT * FROM repository_analytics_sessions
         ORDER BY touched_files + deleted_files + snapshots DESC, session_id ASC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    const sessions = rows.map(rowToSession);
    return {
      sessions,
      totalSessions: sessions.length,
      provenance: sessions.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes:
        sessions.length > 0
          ? []
          : ["repository analytics index has no sessions"],
    };
  }

  listFiles(
    options: RepositoryFileAnalyticsOptions = {},
  ): RepositoryFileAnalyticsResult {
    const limit = sanitizeLimit(options.limit, 200);
    const rows = this.db
      .query(
        `SELECT * FROM repository_analytics_files
         ORDER BY touched_count + deleted_count + snapshot_count DESC, path ASC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    const files = rows.map(rowToFile);
    return {
      files,
      totalFiles: files.length,
      provenance: files.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes:
        files.length > 0 ? [] : ["repository analytics index has no files"],
    };
  }
}

function uniqueCommits(
  commits: readonly ScoredCommitAnalytics[],
): readonly ScoredCommitAnalytics[] {
  const byHash = new Map<string, ScoredCommitAnalytics>();
  for (const commit of commits) {
    if (commit.commitHash.length === 0) {
      continue;
    }
    const existing = byHash.get(commit.commitHash);
    if (
      existing === undefined ||
      (commit.commitDate ?? "").localeCompare(existing.commitDate ?? "") > 0
    ) {
      byHash.set(commit.commitHash, commit);
    }
  }
  return [...byHash.values()];
}

function summarizeCommits(commits: readonly ScoredCommitAnalytics[]): {
  readonly totalComposerLines: number;
  readonly weightedV1AiPercentage?: number;
  readonly weightedV2AiPercentage?: number;
  readonly completenessNotes: readonly string[];
} {
  let totalComposerLines = 0;
  let v1Weight = 0;
  let v1Lines = 0;
  let v1Unweighted = 0;
  let v1Count = 0;
  let v2Weight = 0;
  let v2Lines = 0;
  let v2Unweighted = 0;
  let v2Count = 0;
  for (const commit of commits) {
    const lines =
      (commit.composerLinesAdded ?? 0) + (commit.composerLinesDeleted ?? 0);
    totalComposerLines += lines;
    if (commit.v1AiPercentage !== undefined) {
      v1Unweighted += commit.v1AiPercentage;
      v1Count += 1;
      if (lines > 0) {
        v1Weight += commit.v1AiPercentage * lines;
        v1Lines += lines;
      }
    }
    if (commit.v2AiPercentage !== undefined) {
      v2Unweighted += commit.v2AiPercentage;
      v2Count += 1;
      if (lines > 0) {
        v2Weight += commit.v2AiPercentage * lines;
        v2Lines += lines;
      }
    }
  }
  const usedUnweightedV1 = v1Lines === 0 && v1Count > 0;
  const usedUnweightedV2 = v2Lines === 0 && v2Count > 0;
  return {
    totalComposerLines,
    ...(v1Lines > 0
      ? { weightedV1AiPercentage: v1Weight / v1Lines }
      : usedUnweightedV1
        ? { weightedV1AiPercentage: v1Unweighted / v1Count }
        : {}),
    ...(v2Lines > 0
      ? { weightedV2AiPercentage: v2Weight / v2Lines }
      : usedUnweightedV2
        ? { weightedV2AiPercentage: v2Unweighted / v2Count }
        : {}),
    completenessNotes: [
      ...(usedUnweightedV1
        ? [
            "v1 AI percentage uses unweighted average because composer line counts are missing",
          ]
        : []),
      ...(usedUnweightedV2
        ? [
            "v2 AI percentage uses unweighted average because composer line counts are missing",
          ]
        : []),
    ],
  };
}

function rowToCommit(row: Record<string, unknown>): ScoredCommitAnalytics {
  const branchName = stringValue(row["branch_name"]);
  const commitMessage = stringValue(row["commit_message"]);
  const commitDate = stringValue(row["commit_date"]);
  const composerLinesAdded = optionalNumber(row["composer_lines_added"]);
  const composerLinesDeleted = optionalNumber(row["composer_lines_deleted"]);
  const v1AiPercentage = optionalNumber(row["v1_ai_percentage"]);
  const v2AiPercentage = optionalNumber(row["v2_ai_percentage"]);
  return {
    commitHash: String(row["commit_hash"] ?? ""),
    ...(branchName !== undefined ? { branchName } : {}),
    ...(commitMessage !== undefined ? { commitMessage } : {}),
    ...(commitDate !== undefined ? { commitDate } : {}),
    ...(composerLinesAdded !== undefined ? { composerLinesAdded } : {}),
    ...(composerLinesDeleted !== undefined ? { composerLinesDeleted } : {}),
    ...(v1AiPercentage !== undefined ? { v1AiPercentage } : {}),
    ...(v2AiPercentage !== undefined ? { v2AiPercentage } : {}),
    provenance: provenanceValue(row["provenance"]),
    completenessNotes: stringList(row["completeness_notes_json"]),
  };
}

function rowToSession(
  row: Record<string, unknown>,
): RepositorySessionAnalytics {
  const conversationId = stringValue(row["conversation_id"]);
  const workspacePath = stringValue(row["workspace_path"]);
  return {
    sessionId: String(row["session_id"] ?? ""),
    recordId: String(row["record_id"] ?? ""),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(workspacePath !== undefined ? { workspacePath } : {}),
    touchedFiles: numberValue(row["touched_files"]),
    deletedFiles: numberValue(row["deleted_files"]),
    snapshots: numberValue(row["snapshots"]),
    unknownFiles: numberValue(row["unknown_files"]),
    provenance: provenanceList(row["provenance_json"]),
    completenessNotes: stringList(row["completeness_notes_json"]),
  };
}

function rowToFile(row: Record<string, unknown>): RepositoryFileAnalytics {
  const firstObservedAt = stringValue(row["first_observed_at"]);
  const lastObservedAt = stringValue(row["last_observed_at"]);
  return {
    path: String(row["path"] ?? ""),
    sessions: numberValue(row["sessions"]),
    touchedCount: numberValue(row["touched_count"]),
    deletedCount: numberValue(row["deleted_count"]),
    snapshotCount: numberValue(row["snapshot_count"]),
    ...(firstObservedAt !== undefined ? { firstObservedAt } : {}),
    ...(lastObservedAt !== undefined ? { lastObservedAt } : {}),
    provenance: provenanceList(row["provenance_json"]),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function numberValue(value: unknown): number {
  return optionalNumber(value) ?? 0;
}

function stringList(value: unknown): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
      : [];
  } catch {
    return [];
  }
}

function provenanceList(
  value: unknown,
): readonly RepositoryAnalyticsProvenance[] {
  const parsed = stringList(value);
  return parsed.flatMap((item) =>
    isRepositoryAnalyticsProvenance(item) ? [item] : [],
  );
}

function provenanceValue(value: unknown): RepositoryAnalyticsProvenance {
  return typeof value === "string" && isRepositoryAnalyticsProvenance(value)
    ? value
    : "unknown";
}

function isRepositoryAnalyticsProvenance(
  value: string,
): value is RepositoryAnalyticsProvenance {
  return (
    value === "ai_tracking" ||
    value === "file_intelligence" ||
    value === "git" ||
    value === "index" ||
    value === "missing_ai_tracking" ||
    value === "missing_scored_commits" ||
    value === "missing_file_intelligence" ||
    value === "missing_rows" ||
    value === "unknown"
  );
}

function sanitizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, 10000);
}
