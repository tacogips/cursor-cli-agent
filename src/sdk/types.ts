import type { ActivityListOptions } from "../activity/manager";
import type {
  AgentRunnerFacade,
  CursorAgentRequest,
  CursorAgentRunResult,
  CursorAgentStreamMode,
  CursorRunningAgent,
} from "./agent-runner";
import type {
  ActivityFacade,
  BookmarkFacade,
  FileFacade,
  GroupFacade,
  QueueFacade,
  SearchFacade,
  SessionFacade,
} from "./facades";

export type {
  ActivityFacade,
  ActivityListOptions,
  AgentRunnerFacade,
  BookmarkFacade,
  CursorAgentRequest,
  CursorAgentRunResult,
  CursorAgentStreamMode,
  CursorRunningAgent,
  FileFacade,
  GroupFacade,
  QueueFacade,
  SearchFacade,
  SessionFacade,
};

export type {
  ActivitySignal,
  ActivitySignalSource,
  ActivityStatus,
  SessionActivity,
} from "../types/activity";
export type {
  AgentEvent,
  NormalizedMessage,
  UsageStats,
} from "../types/agent-event";
export type {
  BookmarkExcerpt,
  BookmarkFilter,
  BookmarkRecord,
  BookmarkSearchHit,
  BookmarkSearchOptions,
  BookmarkSearchResult,
  BookmarkType,
  CreateBookmarkInput,
} from "../types/bookmark";
export type {
  FileHistoryEntry,
  FileHistoryResult,
  FileIndexRebuildStats,
  FileIndexStats,
  FileIntelligenceOperation,
  FileIntelligencePathRef,
  FileIntelligenceProvenance,
  FileSnapshotOptions,
  SessionDeletedFileEntry,
  SessionDeletedFilesResult,
  SessionFileEntry,
  SessionFileSnapshot,
  SessionFileSnapshotResult,
  SessionFileSummary,
} from "../types/file-intelligence";
export type {
  GroupLifecycleState,
  GroupProgressSnapshot,
  GroupProgressTotals,
  GroupRecord,
  GroupRunRecord,
  GroupRunStatus,
  GroupRunWorkspaceRecord,
  GroupRunWorkspaceStatus,
} from "../types/group";
export type {
  QueueItemMode,
  QueueItemRecord,
  QueueItemStatus,
  QueueLifecycleState,
  QueueProgressSnapshot,
  QueueProgressTotals,
  QueueRecord,
  QueueRunRecord,
  QueueRunStatus,
} from "../types/queue";
export type {
  IdentityState,
  CursorSessionRecord,
  SessionMode,
  SessionSource,
  SessionStatus,
} from "../types/session-record";
export type {
  SessionSearchFilters,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSearchResult,
} from "../types/session-search";
export type {
  TranscriptSearchHit,
  TranscriptSearchOptions,
  TranscriptSearchResult,
  TranscriptSearchRole,
} from "../types/transcript-search";

export interface CursorAgentSdk {
  readonly sessions: SessionFacade;
  readonly search: SearchFacade;
  readonly groups: GroupFacade;
  readonly queues: QueueFacade;
  readonly bookmarks: BookmarkFacade;
  readonly files: FileFacade;
  readonly activity: ActivityFacade;
  readonly runner: AgentRunnerFacade;
}

export interface CursorAgentSdkOptions {
  readonly stateRoot?: string;
  readonly cursorHome?: string;
  readonly cursorBinary?: string;
  readonly now?: () => Date;
}
