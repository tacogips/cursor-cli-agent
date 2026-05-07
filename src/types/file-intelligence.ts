export type FileIntelligenceOperation =
  | "touched"
  | "deleted"
  | "snapshot"
  | "unknown";

export type FileIntelligenceProvenance =
  | "ai_tracking"
  | "index"
  | "missing_ai_tracking"
  | "missing_rows"
  | "unknown";

export interface FileIntelligencePathRef {
  readonly path: string;
  readonly pathKind: "workspace_relative" | "absolute" | "raw";
}

export interface SessionFileEntry {
  readonly path: FileIntelligencePathRef;
  readonly operation: FileIntelligenceOperation;
  readonly changeCount: number;
  readonly firstObservedAt?: string;
  readonly lastObservedAt?: string;
  readonly models: readonly string[];
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionFileSummary {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly files: readonly SessionFileEntry[];
  readonly totalFiles: number;
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionFileSnapshot {
  readonly path: FileIntelligencePathRef;
  readonly contentBytes: number;
  readonly fileExtension?: string;
  readonly model?: string;
  readonly createdAt?: string;
  readonly content?: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionFileSnapshotResult {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly snapshots: readonly SessionFileSnapshot[];
  readonly totalSnapshots: number;
  readonly includeContent: boolean;
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionDeletedFileEntry {
  readonly path: FileIntelligencePathRef;
  readonly deletedAt?: string;
  readonly model?: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface SessionDeletedFilesResult {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly deletedFiles: readonly SessionDeletedFileEntry[];
  readonly totalDeletedFiles: number;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileHistoryEntry {
  readonly sessionId: string;
  readonly recordId: string;
  readonly conversationId?: string;
  readonly path: FileIntelligencePathRef;
  readonly operation: FileIntelligenceOperation;
  readonly observedAt?: string;
  readonly model?: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileIndexStats {
  readonly indexedSessions: number;
  readonly touchedFiles: number;
  readonly deletedFiles: number;
  readonly snapshots: number;
  readonly updatedAt?: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileHistoryResult {
  readonly queryPath: string;
  readonly entries: readonly FileHistoryEntry[];
  readonly totalEntries: number;
  readonly index: FileIndexStats;
  readonly needsRebuild: boolean;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileIndexRebuildStats {
  readonly indexedSessions: number;
  readonly touchedFiles: number;
  readonly deletedFiles: number;
  readonly snapshots: number;
  readonly skippedSessions: number;
  readonly updatedAt: string;
  readonly provenance: FileIntelligenceProvenance;
}

export interface FileSnapshotOptions {
  readonly includeContent?: boolean;
}
