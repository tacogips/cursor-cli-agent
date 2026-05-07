import { existsSync } from "node:fs";

import { Database } from "bun:sqlite";

import { aiTrackingDbPath } from "../config/paths";
import type {
  AiCodeTouchRow,
  AiConversationEnrichment,
  AiConversationSummary,
  AiDeletedFileRow,
  AiTrackedFileRef,
} from "../types/ai-enrichment";
import type { FileIntelligenceProvenance } from "../types/file-intelligence";

const MAX_TRACKED_PATHS = 64;
const MAX_CODE_TOUCH_ROWS = 200;
const MAX_DELETED_ROWS = 200;

export interface AiTrackingReadResult<T> {
  readonly rows: readonly T[];
  readonly provenance: FileIntelligenceProvenance;
}

export interface AiTrackingFileReader {
  listCodeTouches(conversationId: string): AiTrackingReadResult<AiCodeTouchRow>;
  listTrackedSnapshots(
    conversationId: string,
    options?: { readonly includeContent?: boolean },
  ): AiTrackingReadResult<AiTrackedFileRef>;
  listDeletedFiles(
    conversationId: string,
  ): AiTrackingReadResult<AiDeletedFileRow>;
  listConversationFileRefs(
    conversationIds: readonly string[],
  ): AiTrackingReadResult<AiTrackingConversationFileRef>;
}

export interface AiTrackingConversationFileRef {
  readonly conversationId: string;
  readonly path: string;
  readonly operation: "touched" | "deleted" | "snapshot";
  readonly observedAt?: number;
  readonly model?: string;
}

function openReadonlyDb(path: string): Database | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return new Database(path, { readonly: true });
  } catch {
    return undefined;
  }
}

function degraded<T>(): AiTrackingReadResult<T> {
  return { rows: [], provenance: "missing_ai_tracking" };
}

function rowsResult<T>(rows: readonly T[]): AiTrackingReadResult<T> {
  return {
    rows,
    provenance: rows.length > 0 ? "ai_tracking" : "missing_rows",
  };
}

function rowSummary(row: Record<string, unknown>): AiConversationSummary {
  const title = optionalString(row["title"]);
  const tldr = optionalString(row["tldr"]);
  const overview = optionalString(row["overview"]);
  const summaryBullets = optionalString(row["summaryBullets"]);
  const model = optionalString(row["model"]);
  const mode = optionalString(row["mode"]);
  const updatedAt =
    typeof row["updatedAt"] === "number" ? row["updatedAt"] : undefined;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(tldr !== undefined ? { tldr } : {}),
    ...(overview !== undefined ? { overview } : {}),
    ...(summaryBullets !== undefined ? { summaryBullets } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function optionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/**
 * Load optional per-conversation metadata from the local ai-tracking database.
 * Returns undefined if the DB is missing, unreadable, or has no rows for this id.
 */
export function loadAiTrackingEnrichment(
  conversationId: string,
  dbPath: string = aiTrackingDbPath(),
): AiConversationEnrichment | undefined {
  if (conversationId.length === 0) {
    return undefined;
  }
  const db = openReadonlyDb(dbPath);
  if (db === undefined) {
    return undefined;
  }
  try {
    return loadFromDb(db, conversationId);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function loadFromDb(
  db: Database,
  conversationId: string,
): AiConversationEnrichment | undefined {
  const summaryRow = db
    .query(
      "SELECT * FROM conversation_summaries WHERE conversationId = ? LIMIT 1",
    )
    .get(conversationId) as Record<string, unknown> | null;

  const summary = summaryRow !== null ? rowSummary(summaryRow) : undefined;

  const codeRows = db
    .query(
      `SELECT fileName, fileExtension, model, timestamp
       FROM ai_code_hashes
       WHERE conversationId = ?
       ORDER BY COALESCE(timestamp, createdAt) DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_CODE_TOUCH_ROWS) as Record<string, unknown>[];

  const codeTouches: AiCodeTouchRow[] = codeRows.map((r) => {
    const fileName = optionalString(r["fileName"]);
    const fileExtension = optionalString(r["fileExtension"]);
    const model = optionalString(r["model"]);
    const timestamp =
      typeof r["timestamp"] === "number" ? r["timestamp"] : undefined;
    return {
      ...(fileName !== undefined ? { fileName } : {}),
      ...(fileExtension !== undefined ? { fileExtension } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    };
  });

  const deletedRows = db
    .query(
      `SELECT gitPath, deletedAt, model
       FROM ai_deleted_files
       WHERE conversationId = ?
       ORDER BY deletedAt DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_DELETED_ROWS) as Record<string, unknown>[];

  const deletedFiles: AiDeletedFileRow[] = deletedRows.map((r) => {
    const gitPath = String(r["gitPath"] ?? "");
    const deletedAt = typeof r["deletedAt"] === "number" ? r["deletedAt"] : 0;
    const model = optionalString(r["model"]);
    return {
      gitPath,
      deletedAt,
      ...(model !== undefined ? { model } : {}),
    };
  });

  const trackedRows = db
    .query(
      `SELECT gitPath, length(content) AS contentBytes, fileExtension, model, createdAt
       FROM tracked_file_content
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_TRACKED_PATHS) as Record<string, unknown>[];

  const trackedFiles: AiTrackedFileRef[] = trackedRows.map((r) => {
    const gitPath = optionalString(r["gitPath"]) ?? "";
    const fileExtension = optionalString(r["fileExtension"]);
    const model = optionalString(r["model"]);
    const createdAt = typeof r["createdAt"] === "number" ? r["createdAt"] : 0;
    const contentBytes =
      typeof r["contentBytes"] === "number" ? r["contentBytes"] : 0;
    return {
      gitPath,
      contentBytes,
      createdAt,
      ...(fileExtension !== undefined ? { fileExtension } : {}),
      ...(model !== undefined ? { model } : {}),
    };
  });

  const summaryForPayload =
    summary !== undefined && Object.keys(summary).length > 0
      ? summary
      : undefined;

  const hasPayload =
    summaryForPayload !== undefined ||
    codeTouches.length > 0 ||
    deletedFiles.length > 0 ||
    trackedFiles.length > 0;

  if (!hasPayload) {
    return undefined;
  }

  return {
    conversationId,
    ...(summaryForPayload !== undefined ? { summary: summaryForPayload } : {}),
    codeTouches,
    deletedFiles,
    trackedFiles,
  };
}

export function createAiTrackingFileReader(
  dbPath: string = aiTrackingDbPath(),
): AiTrackingFileReader {
  return {
    listCodeTouches(
      conversationId: string,
    ): AiTrackingReadResult<AiCodeTouchRow> {
      return withDb(dbPath, (db) =>
        rowsResult(readCodeTouches(db, conversationId)),
      );
    },
    listTrackedSnapshots(
      conversationId: string,
      options: { readonly includeContent?: boolean } = {},
    ): AiTrackingReadResult<AiTrackedFileRef> {
      return withDb(dbPath, (db) =>
        rowsResult(readTrackedSnapshots(db, conversationId, options)),
      );
    },
    listDeletedFiles(
      conversationId: string,
    ): AiTrackingReadResult<AiDeletedFileRow> {
      return withDb(dbPath, (db) =>
        rowsResult(readDeletedFiles(db, conversationId)),
      );
    },
    listConversationFileRefs(
      conversationIds: readonly string[],
    ): AiTrackingReadResult<AiTrackingConversationFileRef> {
      return withDb(dbPath, (db) =>
        rowsResult(readConversationFileRefs(db, conversationIds)),
      );
    },
  };
}

function withDb<T>(
  dbPath: string,
  fn: (db: Database) => AiTrackingReadResult<T>,
): AiTrackingReadResult<T> {
  const db = openReadonlyDb(dbPath);
  if (db === undefined) {
    return degraded();
  }
  try {
    return fn(db);
  } catch {
    return degraded();
  } finally {
    db.close();
  }
}

function readCodeTouches(
  db: Database,
  conversationId: string,
): readonly AiCodeTouchRow[] {
  const rows = db
    .query(
      `SELECT fileName, fileExtension, model, timestamp
       FROM ai_code_hashes
       WHERE conversationId = ?
       ORDER BY COALESCE(timestamp, createdAt) DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_CODE_TOUCH_ROWS) as Record<string, unknown>[];
  return rows.map((r) => {
    const fileName = optionalString(r["fileName"]);
    const fileExtension = optionalString(r["fileExtension"]);
    const model = optionalString(r["model"]);
    const timestamp =
      typeof r["timestamp"] === "number" ? r["timestamp"] : undefined;
    return {
      ...(fileName !== undefined ? { fileName } : {}),
      ...(fileExtension !== undefined ? { fileExtension } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    };
  });
}

function readDeletedFiles(
  db: Database,
  conversationId: string,
): readonly AiDeletedFileRow[] {
  const rows = db
    .query(
      `SELECT gitPath, deletedAt, model
       FROM ai_deleted_files
       WHERE conversationId = ?
       ORDER BY deletedAt DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_DELETED_ROWS) as Record<string, unknown>[];
  return rows.map((r) => {
    const gitPath = String(r["gitPath"] ?? "");
    const deletedAt = typeof r["deletedAt"] === "number" ? r["deletedAt"] : 0;
    const model = optionalString(r["model"]);
    return {
      gitPath,
      deletedAt,
      ...(model !== undefined ? { model } : {}),
    };
  });
}

function readTrackedSnapshots(
  db: Database,
  conversationId: string,
  options: { readonly includeContent?: boolean },
): readonly AiTrackedFileRef[] {
  const contentExpr = options.includeContent === true ? ", content" : "";
  const rows = db
    .query(
      `SELECT gitPath, length(content) AS contentBytes, fileExtension, model, createdAt${contentExpr}
       FROM tracked_file_content
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(conversationId, MAX_TRACKED_PATHS) as Record<string, unknown>[];
  return rows.map((r) => {
    const gitPath = optionalString(r["gitPath"]) ?? "";
    const fileExtension = optionalString(r["fileExtension"]);
    const model = optionalString(r["model"]);
    const content = optionalString(r["content"]);
    const createdAt = typeof r["createdAt"] === "number" ? r["createdAt"] : 0;
    const contentBytes =
      typeof r["contentBytes"] === "number" ? r["contentBytes"] : 0;
    return {
      gitPath,
      contentBytes,
      createdAt,
      ...(content !== undefined ? { content } : {}),
      ...(fileExtension !== undefined ? { fileExtension } : {}),
      ...(model !== undefined ? { model } : {}),
    };
  });
}

function readConversationFileRefs(
  db: Database,
  conversationIds: readonly string[],
): readonly AiTrackingConversationFileRef[] {
  const refs: AiTrackingConversationFileRef[] = [];
  for (const conversationId of conversationIds) {
    for (const row of readCodeTouches(db, conversationId)) {
      if (row.fileName !== undefined) {
        refs.push({
          conversationId,
          path: row.fileName,
          operation: "touched",
          ...(row.timestamp !== undefined ? { observedAt: row.timestamp } : {}),
          ...(row.model !== undefined ? { model: row.model } : {}),
        });
      }
    }
    for (const row of readDeletedFiles(db, conversationId)) {
      refs.push({
        conversationId,
        path: row.gitPath,
        operation: "deleted",
        observedAt: row.deletedAt,
        ...(row.model !== undefined ? { model: row.model } : {}),
      });
    }
    for (const row of readTrackedSnapshots(db, conversationId, {})) {
      refs.push({
        conversationId,
        path: row.gitPath,
        operation: "snapshot",
        observedAt: row.createdAt,
        ...(row.model !== undefined ? { model: row.model } : {}),
      });
    }
  }
  return refs;
}
