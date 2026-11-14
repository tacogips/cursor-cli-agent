import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { cursorProjectsRoot, workspaceSlugFromPath } from "../config/paths";
import { readTranscriptFile } from "../cursor/transcript-reader";
import { resolveWorkspacePathFromWorkerLog } from "../cursor/workspace-resolver";
import type {
  CursorSessionRecord,
  IdentityState,
  SessionMode,
  SessionSource,
  SessionStatus,
} from "../types/session-record";
import type {
  SessionSearchFilters,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSearchResult,
} from "../types/session-search";

function rowToRecord(r: Record<string, unknown>): CursorSessionRecord {
  const localSessionId = optionalString(r["local_session_id"]);
  const cursorChatId = optionalString(r["cursor_chat_id"]);
  const workspacePath = optionalString(r["workspace_path"]);
  const transcriptPath = optionalString(r["transcript_path"]);
  const materializedAt = optionalString(r["materialized_at"]);
  const model = optionalString(r["model"]);
  const mode = parseMode(r["mode"]);
  const firstUserText = optionalString(r["first_user_text"]);
  const lastAssistantText = optionalString(r["last_assistant_text"]);
  return {
    recordId: String(r["record_id"]),
    identityState: r["identity_state"] as IdentityState,
    workspaceSlug: String(r["workspace_slug"]),
    createdAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
    source: r["source"] as SessionSource,
    status: r["status"] as SessionStatus,
    ...(localSessionId !== undefined ? { localSessionId } : {}),
    ...(cursorChatId !== undefined ? { cursorChatId } : {}),
    ...(workspacePath !== undefined ? { workspacePath } : {}),
    ...(transcriptPath !== undefined ? { transcriptPath } : {}),
    ...(materializedAt !== undefined ? { materializedAt } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(firstUserText !== undefined ? { firstUserText } : {}),
    ...(lastAssistantText !== undefined ? { lastAssistantText } : {}),
  };
}

function optionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return undefined;
}

/** Prefer existing id when non-empty; `??` does not treat "" as missing. */
function stableRecordId(existing: string | undefined): string {
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  return randomUUID();
}

function parseMode(v: unknown): SessionMode | undefined {
  if (v === "default" || v === "plan" || v === "ask") {
    return v;
  }
  return undefined;
}

function normalizeSearchQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("query must not be empty");
  }
  return normalized;
}

function normalizeSearchFilters(
  filters: SessionSearchFilters | undefined,
): SessionSearchFilters {
  const workspace =
    filters?.workspace === undefined ? undefined : resolve(filters.workspace);
  return {
    ...(workspace !== undefined ? { workspace } : {}),
    ...(filters?.model !== undefined ? { model: filters.model } : {}),
    ...(filters?.mode !== undefined ? { mode: filters.mode } : {}),
    ...(filters?.status !== undefined ? { status: filters.status } : {}),
  };
}

function searchCandidateFields(
  record: CursorSessionRecord,
): ReadonlyArray<readonly [string, string | undefined]> {
  return [
    ["recordId", record.recordId],
    ["localSessionId", record.localSessionId],
    ["cursorChatId", record.cursorChatId],
    ["workspaceSlug", record.workspaceSlug],
    ["workspacePath", record.workspacePath],
    ["model", record.model],
    ["mode", record.mode],
    ["status", record.status],
    ["source", record.source],
    ["firstUserText", record.firstUserText],
    ["lastAssistantText", record.lastAssistantText],
  ];
}

function matchFieldsForRecord(
  record: CursorSessionRecord,
  normalizedQuery: string,
): readonly string[] {
  const matches: string[] = [];
  for (const [field, value] of searchCandidateFields(record)) {
    if (value?.toLowerCase().includes(normalizedQuery) === true) {
      matches.push(field);
    }
  }
  return matches;
}

function toSearchHit(
  record: CursorSessionRecord,
  matchFields: readonly string[],
): SessionSearchHit {
  return {
    ...record,
    matchFields,
    provenance: "index",
  };
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files.sort();
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  record_id TEXT PRIMARY KEY NOT NULL,
  local_session_id TEXT UNIQUE,
  cursor_chat_id TEXT UNIQUE,
  identity_state TEXT NOT NULL,
  workspace_slug TEXT NOT NULL,
  workspace_path TEXT,
  transcript_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  materialized_at TEXT,
  source TEXT NOT NULL,
  model TEXT,
  mode TEXT,
  status TEXT NOT NULL,
  first_user_text TEXT,
  last_assistant_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_slug);
`;

export class SessionIndexRepository {
  private readonly db: Database;
  private readonly projectsRoot: string | undefined;

  constructor(
    dbPath: string,
    options: { readonly cursorProjectsRoot?: string } = {},
  ) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.projectsRoot = options.cursorProjectsRoot;
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(MIGRATION);
  }

  close(): void {
    this.db.close();
  }

  upsert(record: CursorSessionRecord): void {
    const stmt = this.db.prepare(`
INSERT INTO sessions (
  record_id, local_session_id, cursor_chat_id, identity_state, workspace_slug,
  workspace_path, transcript_path, created_at, updated_at, materialized_at,
  source, model, mode, status, first_user_text, last_assistant_text
) VALUES (
  @record_id, @local_session_id, @cursor_chat_id, @identity_state, @workspace_slug,
  @workspace_path, @transcript_path, @created_at, @updated_at, @materialized_at,
  @source, @model, @mode, @status, @first_user_text, @last_assistant_text
)
ON CONFLICT(record_id) DO UPDATE SET
  local_session_id = excluded.local_session_id,
  cursor_chat_id = excluded.cursor_chat_id,
  identity_state = excluded.identity_state,
  workspace_slug = excluded.workspace_slug,
  workspace_path = excluded.workspace_path,
  transcript_path = excluded.transcript_path,
  updated_at = excluded.updated_at,
  materialized_at = excluded.materialized_at,
  source = excluded.source,
  model = excluded.model,
  mode = excluded.mode,
  status = excluded.status,
  first_user_text = excluded.first_user_text,
  last_assistant_text = excluded.last_assistant_text
`);
    stmt.run({
      "@record_id": record.recordId,
      "@local_session_id": record.localSessionId ?? null,
      "@cursor_chat_id": record.cursorChatId ?? null,
      "@identity_state": record.identityState,
      "@workspace_slug": record.workspaceSlug,
      "@workspace_path": record.workspacePath ?? null,
      "@transcript_path": record.transcriptPath ?? null,
      "@created_at": record.createdAt,
      "@updated_at": record.updatedAt,
      "@materialized_at": record.materializedAt ?? null,
      "@source": record.source,
      "@model": record.model ?? null,
      "@mode": record.mode ?? null,
      "@status": record.status,
      "@first_user_text": record.firstUserText ?? null,
      "@last_assistant_text": record.lastAssistantText ?? null,
    });
  }

  findByRecordId(recordId: string): CursorSessionRecord | undefined {
    const row = this.db
      .query("SELECT * FROM sessions WHERE record_id = ?")
      .get(recordId) as Record<string, unknown> | null;
    return row === null ? undefined : rowToRecord(row);
  }

  findByLocalSessionId(id: string): CursorSessionRecord | undefined {
    const row = this.db
      .query("SELECT * FROM sessions WHERE local_session_id = ?")
      .get(id) as Record<string, unknown> | null;
    return row === null ? undefined : rowToRecord(row);
  }

  findByCursorChatId(id: string): CursorSessionRecord | undefined {
    const row = this.db
      .query("SELECT * FROM sessions WHERE cursor_chat_id = ?")
      .get(id) as Record<string, unknown> | null;
    return row === null ? undefined : rowToRecord(row);
  }

  /**
   * Resolve a session id that may be either local transcript id or Cursor chat id.
   */
  resolveSessionKey(key: string): CursorSessionRecord | undefined {
    return (
      this.findByLocalSessionId(key) ??
      this.findByCursorChatId(key) ??
      this.findByRecordId(key)
    );
  }

  listSessions(limit: number): CursorSessionRecord[] {
    const rows = this.db
      .query("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  listSessionsForWorkspace(
    workspacePath: string,
    limit: number,
  ): CursorSessionRecord[] {
    const abs = resolve(workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const rows = this.db
      .query(
        `SELECT * FROM sessions
         WHERE workspace_slug = ? OR workspace_path = ?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(slug, abs, limit) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  listTranscriptBackedSessions(): CursorSessionRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM sessions
         WHERE transcript_path IS NOT NULL AND transcript_path != ''
         ORDER BY updated_at DESC, record_id ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  searchSessions(options: SessionSearchOptions): SessionSearchResult {
    const normalizedQuery = normalizeSearchQuery(options.query);
    if (
      !Number.isInteger(options.limit) ||
      !Number.isFinite(options.limit) ||
      options.limit <= 0
    ) {
      throw new Error("limit must be a positive integer");
    }
    if (
      !Number.isInteger(options.offset) ||
      !Number.isFinite(options.offset) ||
      options.offset < 0
    ) {
      throw new Error("offset must be a non-negative integer");
    }

    const limit = options.limit;
    const offset = options.offset;
    const filters = normalizeSearchFilters(options.filters);
    const clauses: string[] = [];
    const params: string[] = [];

    if (filters.workspace !== undefined) {
      clauses.push("(workspace_slug = ? OR workspace_path = ?)");
      params.push(workspaceSlugFromPath(filters.workspace), filters.workspace);
    }
    if (filters.model !== undefined) {
      clauses.push("model = ?");
      params.push(filters.model);
    }
    if (filters.mode !== undefined) {
      clauses.push("mode = ?");
      params.push(filters.mode);
    }
    if (filters.status !== undefined) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .query(
        `SELECT * FROM sessions ${where}
         ORDER BY updated_at DESC, record_id ASC`,
      )
      .all(...params) as Record<string, unknown>[];
    const hits = rows.flatMap((row) => {
      const record = rowToRecord(row);
      const matchFields = matchFieldsForRecord(record, normalizedQuery);
      return matchFields.length > 0 ? [toSearchHit(record, matchFields)] : [];
    });

    return {
      query: options.query,
      filters,
      sessions: hits.slice(offset, offset + limit),
      total: hits.length,
      offset,
      limit,
      provenance: "index",
    };
  }

  /**
   * When a pending chat-only row exists, attach transcript id and paths after materialization.
   */
  insertPendingChatRecord(
    cursorChatId: string,
    workspacePath: string,
  ): CursorSessionRecord {
    const now = new Date().toISOString();
    const slug = workspaceSlugFromPath(workspacePath);
    const record: CursorSessionRecord = {
      recordId: randomUUID(),
      cursorChatId,
      identityState: "chat_only",
      workspaceSlug: slug,
      workspacePath,
      createdAt: now,
      updatedAt: now,
      source: "create-chat",
      status: "pending",
    };
    this.upsert(record);
    return record;
  }

  /**
   * Scan Cursor transcript files and upsert imported sessions (`transcript_only`).
   */
  async importTranscriptsFromFilesystem(): Promise<number> {
    let count = 0;
    const root = this.projectsRoot ?? cursorProjectsRoot();
    let projectDirs: Awaited<ReturnType<typeof readdir>>;
    try {
      projectDirs = await readdir(root, { withFileTypes: true });
    } catch {
      return 0;
    }
    const now = new Date().toISOString();
    for (const ent of projectDirs) {
      if (!ent.isDirectory()) {
        continue;
      }
      const slug = ent.name;
      const transcriptsDir = join(root, slug, "agent-transcripts");
      let files: Array<{ readonly path: string; readonly name: string }>;
      try {
        files = (await listJsonlFiles(transcriptsDir)).map((path) => ({
          path,
          name: basename(path),
        }));
      } catch {
        continue;
      }
      const workspacePath = await resolveWorkspacePathFromWorkerLog(slug);
      for (const f of files) {
        const localSessionId = basename(f.name, ".jsonl");
        const transcriptPath = f.path;
        const summary = await readTranscriptFile(transcriptPath);
        const existing =
          this.findByLocalSessionId(localSessionId) ??
          this.findByCursorChatId(localSessionId);
        const wasChatOnly = existing?.identityState === "chat_only";
        const cursorChatId =
          existing?.cursorChatId !== undefined
            ? existing.cursorChatId
            : wasChatOnly
              ? localSessionId
              : undefined;
        const wp = workspacePath ?? existing?.workspacePath;
        const fu =
          summary.firstUserMessage?.displayText ?? existing?.firstUserText;
        const la =
          summary.lastAssistantMessage?.displayText ??
          existing?.lastAssistantText;
        const record: CursorSessionRecord = {
          recordId: stableRecordId(existing?.recordId),
          localSessionId,
          identityState: wasChatOnly
            ? "linked"
            : (existing?.identityState ?? "transcript_only"),
          workspaceSlug: slug,
          transcriptPath,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          materializedAt: existing?.materializedAt ?? now,
          source: existing?.source ?? "unknown",
          status: existing?.status ?? "unknown",
          ...(cursorChatId !== undefined ? { cursorChatId } : {}),
          ...(wp !== undefined ? { workspacePath: wp } : {}),
          ...(fu !== undefined ? { firstUserText: fu } : {}),
          ...(la !== undefined ? { lastAssistantText: la } : {}),
        };
        this.upsert(record);
        count += 1;
      }
    }
    return count;
  }
}
