export declare function getDataDir(): string;
export declare function getConfigDir(): string;
export declare function getCursorHome(): string;
export declare function stateDbPath(): string;
export declare function groupsJsonPath(): string;
export declare function queuesJsonPath(): string;
export declare function bookmarksJsonPath(): string;
export declare function activitySignalsJsonPath(): string;
export declare function usageEventsJsonPath(): string;
export declare function sessionReplayForksJsonPath(): string;
export declare function daemonMetadataPath(): string;
export declare function daemonLifecycleLogPath(): string;
export declare function cursorProjectsRoot(): string;
/**
 * Cursor-local SQLite used for AI code tracking (enrichment only; transcripts stay canonical).
 */
export declare function aiTrackingDbPath(): string;
/**
 * Cursor uses a slug of the absolute workspace path (slashes to hyphens, drop leading slash).
 */
export declare function workspaceSlugFromPath(workspacePath: string): string;
export declare function agentTranscriptsDirForWorkspace(workspacePath: string): string;
//# sourceMappingURL=paths.d.ts.map