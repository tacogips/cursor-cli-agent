import type { AiTrackingAnalyticsReader } from "../cursor/ai-tracking-reader";
import type { FileIntelligenceService } from "../file-intelligence";
import type { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import type { RepositoryAnalyticsIndex } from "../persistence/repository-analytics-index";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { FileHistoryEntry } from "../types/file-intelligence";
import type { CursorSessionRecord } from "../types/session-record";
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
} from "../types/repository-analytics";

export interface RepositoryAnalyticsService {
  getSummary(): Promise<RepositoryAnalyticsSummary>;
  listCommits(
    options?: RepositoryCommitListOptions,
  ): Promise<RepositoryCommitListResult>;
  listSessions(
    options?: RepositorySessionAnalyticsOptions,
  ): Promise<RepositorySessionAnalyticsResult>;
  listFiles(
    options?: RepositoryFileAnalyticsOptions,
  ): Promise<RepositoryFileAnalyticsResult>;
  rebuild(): Promise<RepositoryAnalyticsRebuildStats>;
}

export function createRepositoryAnalyticsService(deps: {
  readonly sessions: SessionIndexRepository;
  readonly aiTracking: AiTrackingAnalyticsReader;
  readonly fileIntelligence: FileIntelligenceService;
  readonly fileIndex: FileIntelligenceIndex;
  readonly analyticsIndex: RepositoryAnalyticsIndex;
}): RepositoryAnalyticsService {
  return new RepositoryAnalyticsManager(
    deps.sessions,
    deps.aiTracking,
    deps.fileIntelligence,
    deps.fileIndex,
    deps.analyticsIndex,
  );
}

class RepositoryAnalyticsManager implements RepositoryAnalyticsService {
  constructor(
    private readonly sessions: SessionIndexRepository,
    private readonly aiTracking: AiTrackingAnalyticsReader,
    private readonly fileIntelligence: FileIntelligenceService,
    private readonly fileIndex: FileIntelligenceIndex,
    private readonly analyticsIndex: RepositoryAnalyticsIndex,
  ) {}

  async getSummary(): Promise<RepositoryAnalyticsSummary> {
    return this.analyticsIndex.getSummary();
  }

  async listCommits(
    options: RepositoryCommitListOptions = {},
  ): Promise<RepositoryCommitListResult> {
    return this.analyticsIndex.listCommits(options);
  }

  async listSessions(
    options: RepositorySessionAnalyticsOptions = {},
  ): Promise<RepositorySessionAnalyticsResult> {
    return this.analyticsIndex.listSessions(options);
  }

  async listFiles(
    options: RepositoryFileAnalyticsOptions = {},
  ): Promise<RepositoryFileAnalyticsResult> {
    return this.analyticsIndex.listFiles(options);
  }

  async rebuild(): Promise<RepositoryAnalyticsRebuildStats> {
    const commitResult = this.aiTracking.listScoredCommits({ limit: 10000 });
    const fileStats = await this.fileIntelligence.rebuild();
    const fileEntries = this.fileIndex.listEntries(100000);
    const sessions = this.sessions.listSessions(10000);
    const sessionAnalytics = aggregateSessions(sessions, fileEntries);
    const fileAnalytics = aggregateFiles(fileEntries);
    const provenance = uniqueProvenance([
      commitResult.provenance,
      fileStats.provenance === "ai_tracking"
        ? "file_intelligence"
        : mapFileProvenance(fileStats.provenance),
      ...(fileEntries.length > 0 ? ["file_intelligence" as const] : []),
    ]);
    const completenessNotes = [
      ...commitResult.completenessNotes,
      ...(fileEntries.length === 0
        ? ["file-intelligence index has no file rows"]
        : []),
    ];
    return this.analyticsIndex.rebuild({
      commits: commitResult.rows,
      sessions: sessionAnalytics,
      files: fileAnalytics,
      skippedRows: fileStats.skippedSessions,
      provenance,
      completenessNotes,
    });
  }
}

function aggregateSessions(
  sessions: readonly CursorSessionRecord[],
  entries: readonly FileHistoryEntry[],
): readonly RepositorySessionAnalytics[] {
  const bySession = new Map<string, FileHistoryEntry[]>();
  for (const entry of entries) {
    const current = bySession.get(entry.sessionId) ?? [];
    current.push(entry);
    bySession.set(entry.sessionId, current);
  }
  return sessions
    .map((session) => {
      const sessionId =
        session.localSessionId ?? session.cursorChatId ?? session.recordId;
      const rows = bySession.get(sessionId) ?? [];
      const conversationId = session.localSessionId ?? session.cursorChatId;
      return {
        sessionId,
        recordId: session.recordId,
        ...(conversationId !== undefined ? { conversationId } : {}),
        ...(session.workspacePath !== undefined
          ? { workspacePath: session.workspacePath }
          : {}),
        touchedFiles: rows.filter((row) => row.operation === "touched").length,
        deletedFiles: rows.filter((row) => row.operation === "deleted").length,
        snapshots: rows.filter((row) => row.operation === "snapshot").length,
        unknownFiles: rows.filter((row) => row.operation === "unknown").length,
        provenance:
          rows.length > 0
            ? (["file_intelligence"] as const)
            : (["missing_file_intelligence"] as const),
        completenessNotes:
          rows.length > 0 ? [] : ["no file-intelligence rows for session"],
      };
    })
    .sort(
      (a, b) =>
        b.touchedFiles +
          b.deletedFiles +
          b.snapshots -
          (a.touchedFiles + a.deletedFiles + a.snapshots) ||
        a.sessionId.localeCompare(b.sessionId),
    );
}

function aggregateFiles(
  entries: readonly FileHistoryEntry[],
): readonly RepositoryFileAnalytics[] {
  const byPath = new Map<
    string,
    {
      sessions: Set<string>;
      touchedCount: number;
      deletedCount: number;
      snapshotCount: number;
      firstObservedAt?: string;
      lastObservedAt?: string;
    }
  >();
  for (const entry of entries) {
    const current =
      byPath.get(entry.path.path) ??
      ({
        sessions: new Set<string>(),
        touchedCount: 0,
        deletedCount: 0,
        snapshotCount: 0,
      } as {
        sessions: Set<string>;
        touchedCount: number;
        deletedCount: number;
        snapshotCount: number;
        firstObservedAt?: string;
        lastObservedAt?: string;
      });
    current.sessions.add(entry.sessionId);
    if (entry.operation === "touched") {
      current.touchedCount += 1;
    } else if (entry.operation === "deleted") {
      current.deletedCount += 1;
    } else if (entry.operation === "snapshot") {
      current.snapshotCount += 1;
    }
    if (entry.observedAt !== undefined) {
      current.firstObservedAt =
        current.firstObservedAt === undefined
          ? entry.observedAt
          : minIso(current.firstObservedAt, entry.observedAt);
      current.lastObservedAt =
        current.lastObservedAt === undefined
          ? entry.observedAt
          : maxIso(current.lastObservedAt, entry.observedAt);
    }
    byPath.set(entry.path.path, current);
  }
  return [...byPath.entries()]
    .map(([path, value]) => ({
      path,
      sessions: value.sessions.size,
      touchedCount: value.touchedCount,
      deletedCount: value.deletedCount,
      snapshotCount: value.snapshotCount,
      ...(value.firstObservedAt !== undefined
        ? { firstObservedAt: value.firstObservedAt }
        : {}),
      ...(value.lastObservedAt !== undefined
        ? { lastObservedAt: value.lastObservedAt }
        : {}),
      provenance: ["file_intelligence"] as const,
    }))
    .sort(
      (a, b) =>
        b.touchedCount +
          b.deletedCount +
          b.snapshotCount -
          (a.touchedCount + a.deletedCount + a.snapshotCount) ||
        a.path.localeCompare(b.path),
    );
}

function mapFileProvenance(
  provenance:
    | "ai_tracking"
    | "index"
    | "missing_ai_tracking"
    | "missing_rows"
    | "unknown",
): RepositoryAnalyticsProvenance {
  if (provenance === "missing_ai_tracking") {
    return "missing_ai_tracking";
  }
  if (provenance === "missing_rows") {
    return "missing_rows";
  }
  if (provenance === "index") {
    return "file_intelligence";
  }
  return "unknown";
}

function uniqueProvenance(
  values: readonly RepositoryAnalyticsProvenance[],
): readonly RepositoryAnalyticsProvenance[] {
  return [...new Set(values)];
}

function minIso(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b;
}

function maxIso(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b;
}
