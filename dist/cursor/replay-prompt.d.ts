import type { CursorSessionRecord } from "../types/session-record";
import type { ReplayTranscriptReplayableRow } from "./session-replay-slice";
/** Limitation strings included in every replay/fork result (design-session-replay-fork). */
export declare const REPLAY_FORK_LIMITATIONS: readonly string[];
export interface BuiltReplayPrompt {
    readonly fullPrompt: string;
    readonly promptPreview: string;
    readonly promptHash: string;
}
export declare function buildReplayForkPrompt(source: CursorSessionRecord, slice: readonly ReplayTranscriptReplayableRow[], continuationPrompt: string, context: {
    readonly omittedNonReplayableCount: number;
    readonly omittedReplayableTailCount: number;
}): BuiltReplayPrompt;
//# sourceMappingURL=replay-prompt.d.ts.map