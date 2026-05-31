import type { ReplayForkStore } from "../persistence/session-replay-forks-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import { type AgentEvent } from "../types/agent-event";
import type { ReplayForkRequest, ReplayForkResult } from "../types/session-replay-fork";
import { runHeadlessStreaming, type HeadlessRunOptions } from "./process-runner";
import { type ReplaySliceErrorCode } from "./session-replay-slice";
export declare class SessionReplayForkError extends Error {
    readonly code: "not_found" | "transcript_unavailable" | "slice_error" | "cursor_failed" | "trust_required";
    readonly sliceCode?: ReplaySliceErrorCode | undefined;
    constructor(code: "not_found" | "transcript_unavailable" | "slice_error" | "cursor_failed" | "trust_required", message: string, sliceCode?: ReplaySliceErrorCode | undefined);
}
export interface SessionReplayForkServiceDeps {
    readonly sessions: SessionIndexRepository;
    readonly store: ReplayForkStore;
    readonly runHeadless?: typeof runHeadlessStreaming;
    readonly now?: () => Date;
    readonly onNormalizedEvents?: (events: readonly AgentEvent[]) => void;
}
export declare function executeSessionReplayFork(request: ReplayForkRequest, headlessBase: Omit<HeadlessRunOptions, "prompt">, deps: SessionReplayForkServiceDeps): Promise<ReplayForkResult>;
//# sourceMappingURL=session-replay-fork.d.ts.map