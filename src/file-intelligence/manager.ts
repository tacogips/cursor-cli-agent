import { isAbsolute, relative } from "node:path";

import type { AiCodeTouchRow, AiTrackedFileRef } from "../types/ai-enrichment";
import type {
  FileHistoryResult,
  FileIndexRebuildStats,
  FileIntelligencePathRef,
  FileIntelligenceProvenance,
  FileSnapshotOptions,
  SessionDeletedFilesResult,
  SessionFileEntry,
  SessionFileSnapshot,
  SessionFileSnapshotResult,
  SessionFileSummary,
} from "../types/file-intelligence";
import type { CursorSessionRecord } from "../types/session-record";
import type { AiTrackingFileReader } from "../cursor/ai-tracking-reader";
import type { FileIndexEntryInput } from "../persistence/file-intelligence-index";
import {
  type FileIntelligenceIndex,
  normalizeIndexPath,
} from "../persistence/file-intelligence-index";
import type { SessionIndexRepository } from "../persistence/session-index";

export class FileIntelligenceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileIntelligenceNotFoundError";
  }
}

export interface FileIntelligenceService {
  listFiles(sessionId: string): Promise<SessionFileSummary>;
  listSnapshots(
    sessionId: string,
    options?: FileSnapshotOptions,
  ): Promise<SessionFileSnapshotResult>;
  listDeleted(sessionId: string): Promise<SessionDeletedFilesResult>;
  findFile(path: string): Promise<FileHistoryResult>;
  rebuild(): Promise<FileIndexRebuildStats>;
}

export function createFileIntelligenceService(deps: {
  readonly sessions: SessionIndexRepository;
  readonly aiTracking: AiTrackingFileReader;
  readonly index: FileIntelligenceIndex;
}): FileIntelligenceService {
  return new FileIntelligenceManager(
    deps.sessions,
    deps.aiTracking,
    deps.index,
  );
}

class FileIntelligenceManager implements FileIntelligenceService {
  constructor(
    private readonly sessions: SessionIndexRepository,
    private readonly aiTracking: AiTrackingFileReader,
    private readonly index: FileIntelligenceIndex,
  ) {}

  async listFiles(sessionId: string): Promise<SessionFileSummary> {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const result =
      conversationId === undefined
        ? { rows: [], provenance: "unknown" as const }
        : this.aiTracking.listCodeTouches(conversationId);
    const grouped = groupTouches(session, result.rows, result.provenance);
    return {
      sessionId:
        session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...(conversationId !== undefined ? { conversationId } : {}),
      files: grouped,
      totalFiles: grouped.length,
      provenance: commandProvenance(result.provenance, grouped.length),
    };
  }

  async listSnapshots(
    sessionId: string,
    options: FileSnapshotOptions = {},
  ): Promise<SessionFileSnapshotResult> {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const includeContent = options.includeContent === true;
    const result =
      conversationId === undefined
        ? { rows: [], provenance: "unknown" as const }
        : this.aiTracking.listTrackedSnapshots(conversationId, {
            includeContent,
          });
    const snapshots = result.rows.map((row) =>
      snapshotToResult(session, row, result.provenance, includeContent),
    );
    return {
      sessionId:
        session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...(conversationId !== undefined ? { conversationId } : {}),
      snapshots,
      totalSnapshots: snapshots.length,
      includeContent,
      provenance: commandProvenance(result.provenance, snapshots.length),
    };
  }

  async listDeleted(sessionId: string): Promise<SessionDeletedFilesResult> {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const result =
      conversationId === undefined
        ? { rows: [], provenance: "unknown" as const }
        : this.aiTracking.listDeletedFiles(conversationId);
    const deletedFiles = result.rows.map((row) => {
      const model = row.model;
      return {
        path: normalizePathRef(session, row.gitPath),
        ...(row.deletedAt > 0 ? { deletedAt: millisToIso(row.deletedAt) } : {}),
        ...(model !== undefined ? { model } : {}),
        provenance: result.provenance,
      };
    });
    return {
      sessionId:
        session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...(conversationId !== undefined ? { conversationId } : {}),
      deletedFiles,
      totalDeletedFiles: deletedFiles.length,
      provenance: commandProvenance(result.provenance, deletedFiles.length),
    };
  }

  async findFile(path: string): Promise<FileHistoryResult> {
    return this.index.findByPath(path);
  }

  async rebuild(): Promise<FileIndexRebuildStats> {
    const sessions = this.sessions.listSessions(10000);
    if (sessions.length === 0) {
      const availability = this.aiTracking.listConversationFileRefs([]);
      return this.index.rebuild({
        entries: [],
        indexedSessions: 0,
        skippedSessions: 0,
        provenance: availability.provenance,
      });
    }
    const entries: FileIndexEntryInput[] = [];
    let skippedSessions = 0;
    let sawMissingAiTracking = false;
    for (const session of sessions) {
      const conversationId = conversationIdForSession(session);
      if (conversationId === undefined) {
        skippedSessions += 1;
        continue;
      }
      const refs = this.aiTracking.listConversationFileRefs([conversationId]);
      if (refs.provenance === "missing_ai_tracking") {
        sawMissingAiTracking = true;
        skippedSessions += 1;
        continue;
      }
      if (refs.rows.length === 0) {
        skippedSessions += 1;
        continue;
      }
      for (const ref of refs.rows) {
        const pathRef = normalizePathRef(session, ref.path);
        entries.push({
          sessionId:
            session.localSessionId ?? session.cursorChatId ?? session.recordId,
          recordId: session.recordId,
          conversationId,
          rawPath: ref.path,
          normalizedPath: normalizeIndexPath(pathRef.path),
          pathKind: pathRef.pathKind,
          operation: ref.operation,
          ...(ref.observedAt !== undefined
            ? { observedAt: millisToIso(ref.observedAt) }
            : {}),
          ...(ref.model !== undefined ? { model: ref.model } : {}),
          provenance: "ai_tracking",
        });
      }
    }
    return this.index.rebuild({
      entries,
      indexedSessions: sessions.length - skippedSessions,
      skippedSessions,
      provenance:
        sawMissingAiTracking && entries.length === 0
          ? "missing_ai_tracking"
          : "ai_tracking",
    });
  }

  private resolveSession(sessionId: string): CursorSessionRecord {
    const session = this.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new FileIntelligenceNotFoundError("session not found");
    }
    return session;
  }
}

function conversationIdForSession(
  session: CursorSessionRecord,
): string | undefined {
  return session.localSessionId ?? session.cursorChatId;
}

function groupTouches(
  session: CursorSessionRecord,
  rows: readonly AiCodeTouchRow[],
  provenance: FileIntelligenceProvenance,
): readonly SessionFileEntry[] {
  const grouped = new Map<
    string,
    {
      path: FileIntelligencePathRef;
      count: number;
      first?: number;
      last?: number;
      models: Set<string>;
    }
  >();
  for (const row of rows) {
    if (row.fileName === undefined) {
      continue;
    }
    const path = normalizePathRef(session, row.fileName);
    const key = path.path;
    const current =
      grouped.get(key) ??
      ({ path, count: 0, models: new Set<string>() } as {
        path: FileIntelligencePathRef;
        count: number;
        first?: number;
        last?: number;
        models: Set<string>;
      });
    current.count += 1;
    if (row.timestamp !== undefined) {
      current.first =
        current.first === undefined
          ? row.timestamp
          : Math.min(current.first, row.timestamp);
      current.last =
        current.last === undefined
          ? row.timestamp
          : Math.max(current.last, row.timestamp);
    }
    if (row.model !== undefined) {
      current.models.add(row.model);
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((entry) => ({
      path: entry.path,
      operation: "touched" as const,
      changeCount: entry.count,
      ...(entry.first !== undefined
        ? { firstObservedAt: millisToIso(entry.first) }
        : {}),
      ...(entry.last !== undefined
        ? { lastObservedAt: millisToIso(entry.last) }
        : {}),
      models: [...entry.models].sort(),
      provenance,
    }))
    .sort((a, b) => a.path.path.localeCompare(b.path.path));
}

function snapshotToResult(
  session: CursorSessionRecord,
  row: AiTrackedFileRef,
  provenance: FileIntelligenceProvenance,
  includeContent: boolean,
): SessionFileSnapshot {
  return {
    path: normalizePathRef(session, row.gitPath),
    contentBytes: row.contentBytes,
    ...(row.fileExtension !== undefined
      ? { fileExtension: row.fileExtension }
      : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.createdAt > 0 ? { createdAt: millisToIso(row.createdAt) } : {}),
    ...(includeContent && row.content !== undefined
      ? { content: row.content }
      : {}),
    provenance,
  };
}

function normalizePathRef(
  session: CursorSessionRecord,
  path: string,
): FileIntelligencePathRef {
  const normalizedRaw = normalizeIndexPath(path);
  const workspace = session.workspacePath;
  if (workspace !== undefined && isAbsolute(path)) {
    const rel = normalizeIndexPath(relative(workspace, path));
    if (!rel.startsWith("../") && rel !== ".." && rel.length > 0) {
      return { path: rel, pathKind: "workspace_relative" };
    }
    return { path: normalizedRaw, pathKind: "absolute" };
  }
  if (!isAbsolute(path) && path.length > 0) {
    return { path: normalizedRaw, pathKind: "workspace_relative" };
  }
  return { path: normalizedRaw, pathKind: "raw" };
}

function millisToIso(value: number): string {
  return new Date(value).toISOString();
}

function commandProvenance(
  provenance: FileIntelligenceProvenance,
  rowCount: number,
): FileIntelligenceProvenance {
  if (provenance === "ai_tracking" && rowCount === 0) {
    return "missing_rows";
  }
  return provenance;
}
