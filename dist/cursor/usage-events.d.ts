import type { AgentEvent } from "../types/agent-event";
import type { UsageEventRecord } from "../types/usage-event";
export interface UsageEventContext {
    readonly sessionId: string;
    readonly recordId?: string;
    readonly cursorChatId?: string;
    readonly workspacePath?: string;
    readonly workspaceSlug?: string;
    readonly model?: string;
    readonly observedAt: string;
}
export interface UsageEventExtractor {
    fromAgentEvent(event: AgentEvent, context: UsageEventContext): UsageEventRecord | null;
}
export declare function createUsageEventExtractor(): UsageEventExtractor;
//# sourceMappingURL=usage-events.d.ts.map