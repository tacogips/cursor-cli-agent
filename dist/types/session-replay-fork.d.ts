import type { CursorSessionRecord } from "./session-record";
export type ReplayForkMode = "best_effort_replay";
export type ReplayForkSemantics = "replay_not_native_fork";
export interface ReplayForkBoundary {
    readonly messageId?: string;
    readonly nthMessage?: number;
    readonly eventOffset?: number;
    readonly role?: "user" | "assistant";
    readonly inclusive: true;
}
export interface ReplayForkRequest {
    readonly sourceSessionId: string;
    readonly continuationPrompt: string;
    readonly throughMessageId?: string;
    readonly nthMessage?: number;
    readonly dryRun: boolean;
}
export interface ReplayForkProvenance {
    readonly replayForkId: string;
    readonly sourceRecordId: string;
    readonly sourceLocalSessionId?: string;
    readonly sourceCursorChatId?: string;
    readonly newRecordId?: string;
    readonly newLocalSessionId?: string;
    readonly promptHash: string;
    readonly createdAt: string;
    readonly semantics: ReplayForkSemantics;
}
export interface ReplayForkResult {
    readonly mode: ReplayForkMode;
    readonly sourceSession: CursorSessionRecord;
    readonly forkPoint: ReplayForkBoundary;
    readonly replay: ReplayForkPlan;
    readonly newSession?: CursorSessionRecord;
    readonly provenance: ReplayForkProvenance;
    readonly limitations: readonly string[];
    readonly warnings: readonly string[];
}
export interface ReplayForkPlan {
    readonly messageCount: number;
    readonly omittedMessageCount: number;
    readonly truncated: boolean;
    readonly promptPreview: string;
}
//# sourceMappingURL=session-replay-fork.d.ts.map