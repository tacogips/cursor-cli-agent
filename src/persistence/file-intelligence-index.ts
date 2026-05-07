import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  FileHistoryEntry,
  FileHistoryResult,
  FileIndexRebuildStats,
  FileIndexStats,
  FileIntelligenceOperation,
  FileIntelligencePathRef,
  FileIntelligenceProvenance,
} from "../types/file-intelligence";

export interface FileIndexEntryInput {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly rawPath: string;
  readonly normalizedPath: string;
  readonly pathKind: FileIntelligencePathRef["pathKind"];
  readonly operation: FileIntelligenceOperation;
  readonly observedAt?: string;
  readonly model?: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileIndexRebuildInput {
  readonly entries: readonly FileIndexEntryInput[];
  readonly indexedSessions: number;
  readonly skippedSessions: number;
  readonly provenance: FileIntelligenceProvenance;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS file_index_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  indexed_sessions INTEGER NOT NULL,
  touched_files INTEGER NOT NULL,
  deleted_files INTEGER NOT NULL,
  snapshots INTEGER NOT NULL,
  skipped_sessions INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  provenance TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_index_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  conversation_id TEXT,
  raw_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  path_kind TEXT NOT NULL,
  operation TEXT NOT NULL,
  observed_at TEXT,
  model TEXT,
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_index_entries_normalized_path
  ON file_index_entries(normalized_path);
CREATE INDEX IF NOT EXISTS idx_file_index_entries_raw_path
  ON file_index_entries(raw_path);
`;

export class FileIntelligenceIndex {
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

  rebuild(input: FileIndexRebuildInput): FileIndexRebuildStats {
    const updatedAt = new Date().toISOString();
    const touchedFiles = input.entries.filter(
      (entry) => entry.operation === "touched",
    ).length;
    const deletedFiles = input.entries.filter(
      (entry) => entry.operation === "deleted",
    ).length;
    const snapshots = input.entries.filter(
      (entry) => entry.operation === "snapshot",
    ).length;
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM file_index_entries");
      this.db.run("DELETE FROM file_index_meta");
      const insert = this.db.prepare(`
INSERT INTO file_index_entries (
  session_id, record_id, conversation_id, raw_path, normalized_path, path_kind,
  operation, observed_at, model, provenance
) VALUES (
  @session_id, @record_id, @conversation_id, @raw_path, @normalized_path,
  @path_kind, @operation, @observed_at, @model, @provenance
)`);
      for (const entry of input.entries) {
        insert.run({
          "@session_id": entry.sessionId,
          "@record_id": entry.recordId,
          "@conversation_id": entry.conversationId ?? null,
          "@raw_path": entry.rawPath,
          "@normalized_path": entry.normalizedPath,
          "@path_kind": entry.pathKind,
          "@operation": entry.operation,
          "@observed_at": entry.observedAt ?? null,
          "@model": entry.model ?? null,
          "@provenance": entry.provenance,
        });
      }
      this.db
        .prepare(
          `INSERT INTO file_index_meta (
             singleton_id, indexed_sessions, touched_files, deleted_files,
             snapshots, skipped_sessions, updated_at, provenance
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.indexedSessions,
          touchedFiles,
          deletedFiles,
          snapshots,
          input.skippedSessions,
          updatedAt,
          input.provenance,
        );
    });
    tx();
    return {
      indexedSessions: input.indexedSessions,
      touchedFiles,
      deletedFiles,
      snapshots,
      skippedSessions: input.skippedSessions,
      updatedAt,
      provenance: input.provenance,
    };
  }

  findByPath(path: string): FileHistoryResult {
    const normalizedQuery = normalizeIndexPath(path);
    const rows = this.db
      .query(
        `SELECT * FROM file_index_entries
         WHERE normalized_path = ? OR raw_path = ?
         ORDER BY COALESCE(observed_at, ''), session_id, operation`,
      )
      .all(normalizedQuery, path) as Record<string, unknown>[];
    const stats = this.getStats();
    const entries = rows.map(rowToHistoryEntry);
    return {
      queryPath: path,
      entries,
      totalEntries: entries.length,
      index: stats,
      needsRebuild: stats.updatedAt === undefined,
      provenance: entries.length > 0 ? "index" : stats.provenance,
    };
  }

  getStats(): FileIndexStats {
    const row = this.db
      .query("SELECT * FROM file_index_meta WHERE singleton_id = 1")
      .get() as Record<string, unknown> | null;
    if (row === null) {
      return {
        indexedSessions: 0,
        touchedFiles: 0,
        deletedFiles: 0,
        snapshots: 0,
        provenance: "missing_rows",
      };
    }
    const updatedAt = stringValue(row["updated_at"]);
    return {
      indexedSessions: numberValue(row["indexed_sessions"]),
      touchedFiles: numberValue(row["touched_files"]),
      deletedFiles: numberValue(row["deleted_files"]),
      snapshots: numberValue(row["snapshots"]),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      provenance: provenanceValue(row["provenance"]),
    };
  }
}

export function normalizeIndexPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function rowToHistoryEntry(row: Record<string, unknown>): FileHistoryEntry {
  const conversationId = stringValue(row["conversation_id"]);
  const observedAt = stringValue(row["observed_at"]);
  const model = stringValue(row["model"]);
  return {
    sessionId: String(row["session_id"]),
    recordId: String(row["record_id"]),
    ...(conversationId !== undefined ? { conversationId } : {}),
    path: {
      path: String(row["normalized_path"]),
      pathKind: pathKindValue(row["path_kind"]),
    },
    operation: operationValue(row["operation"]),
    ...(observedAt !== undefined ? { observedAt } : {}),
    ...(model !== undefined ? { model } : {}),
    provenance: provenanceValue(row["provenance"]),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function pathKindValue(value: unknown): FileIntelligencePathRef["pathKind"] {
  if (
    value === "workspace_relative" ||
    value === "absolute" ||
    value === "raw"
  ) {
    return value;
  }
  return "raw";
}

function operationValue(value: unknown): FileIntelligenceOperation {
  if (
    value === "touched" ||
    value === "deleted" ||
    value === "snapshot" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function provenanceValue(value: unknown): FileIntelligenceProvenance {
  if (
    value === "ai_tracking" ||
    value === "index" ||
    value === "missing_ai_tracking" ||
    value === "missing_rows" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}
