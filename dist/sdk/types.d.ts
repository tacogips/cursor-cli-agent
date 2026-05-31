import type { ActivityListOptions, ActivityManager } from "../activity/manager";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { UsageEventStore } from "../persistence/usage-event-store";
import type { ToolVersionCommandRunner } from "../types/tool-versions";
import type { AgentRunnerFacade, CursorAgentEffort, CursorAgentRequest, CursorAgentRunResult, CursorAgentStreamMode, CursorRunningAgent } from "./agent-runner";
import type { ActivityFacade, BookmarkFacade, FileFacade, GroupFacade, QueueFacade, SearchFacade, SessionFacade } from "./facades";
import type { ToolHelperSdk } from "./helpers";
export type { ActivityFacade, ActivityListOptions, AgentRunnerFacade, CursorAgentEffort, BookmarkFacade, CursorAgentRequest, CursorAgentRunResult, CursorAgentStreamMode, CursorRunningAgent, FileFacade, GroupFacade, QueueFacade, SearchFacade, SessionFacade, };
export type { SessionIndexRepository } from "../persistence/session-index";
export type { UsageEventStore } from "../persistence/usage-event-store";
export type { ActivitySignal, ActivitySignalSource, ActivityStatus, SessionActivity, } from "../types/activity";
export type { AgentEvent, NormalizedMessage, UsageStats, } from "../types/agent-event";
export type { BookmarkExcerpt, BookmarkFilter, BookmarkRecord, BookmarkSearchHit, BookmarkSearchOptions, BookmarkSearchResult, BookmarkType, CreateBookmarkInput, } from "../types/bookmark";
export type { FileHistoryEntry, FileHistoryResult, FileIndexRebuildStats, FileIndexStats, FileIntelligenceOperation, FileIntelligencePathRef, FileIntelligenceProvenance, FileSnapshotOptions, SessionDeletedFileEntry, SessionDeletedFilesResult, SessionFileEntry, SessionFileSnapshot, SessionFileSnapshotResult, SessionFileSummary, } from "../types/file-intelligence";
export type { GroupLifecycleState, GroupProgressSnapshot, GroupProgressTotals, GroupRecord, GroupRunRecord, GroupRunStatus, GroupRunWorkspaceRecord, GroupRunWorkspaceStatus, } from "../types/group";
export type { QueueItemMode, QueueItemRecord, QueueItemStatus, QueueLifecycleState, QueueProgressSnapshot, QueueProgressTotals, QueueRecord, QueueRunRecord, QueueRunStatus, } from "../types/queue";
export type { IdentityState, CursorSessionRecord, SessionMode, SessionSource, SessionStatus, } from "../types/session-record";
export type { SessionSearchFilters, SessionSearchHit, SessionSearchOptions, SessionSearchResult, } from "../types/session-search";
export type { TranscriptSearchHit, TranscriptSearchOptions, TranscriptSearchResult, TranscriptSearchRole, } from "../types/transcript-search";
export type { RegisteredTool, ToolConfig, ToolContext, ToolRegistrySdk, ToolSummary, } from "../types/tool-registry";
export type { ToolAvailabilityStatus, ToolCommandRunOptions, ToolCommandRunResult, ToolVersionCommandRunner, ToolVersionInfo, ToolVersionOptions, ToolVersionReport, } from "../types/tool-versions";
export type { AuthAvailabilityInfo, ModelAvailabilityOptions, ModelAvailabilityReport, ModelReachabilityInfo, } from "../types/model-availability";
export type { DailyUsageActivity, UsageDailyTokenActivity, UsageEvidenceCoverage, UsageStatsOptions, UsageStatsReport, } from "../types/usage-stats";
export type { ToolHelperSdk };
export interface CursorAgentSdk {
    readonly sessions: SessionFacade;
    readonly search: SearchFacade;
    readonly groups: GroupFacade;
    readonly queues: QueueFacade;
    readonly bookmarks: BookmarkFacade;
    readonly files: FileFacade;
    readonly activity: ActivityFacade;
    readonly runner: AgentRunnerFacade;
    readonly tools: ToolHelperSdk;
}
export interface CursorAgentSdkOptions {
    readonly stateRoot?: string;
    readonly cursorHome?: string;
    readonly cursorBinary?: string;
    readonly now?: () => Date;
    readonly sessionRepository?: SessionIndexRepository;
    readonly activityManager?: ActivityManager;
    readonly usageEventStore?: UsageEventStore;
    readonly commandRunner?: ToolVersionCommandRunner;
}
//# sourceMappingURL=types.d.ts.map