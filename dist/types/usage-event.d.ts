/**
 * Normalized usage observations persisted under repository-owned storage.
 */
export type UsageEventSource = "stream_result";
export interface UsageTokenTotals {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly totalTokens: number;
}
export interface UsageEventRecord extends UsageTokenTotals {
    readonly eventId: string;
    readonly sessionId: string;
    readonly recordId?: string;
    readonly cursorChatId?: string;
    readonly workspacePath?: string;
    readonly workspaceSlug?: string;
    readonly model: string;
    readonly observedAt: string;
    readonly source: UsageEventSource;
    readonly provenance: "repository_usage_events";
}
//# sourceMappingURL=usage-event.d.ts.map