export interface ReplayTranscriptReplayableRow {
    readonly messageId: string;
    readonly role: "user" | "assistant";
    readonly displayText: string;
    readonly eventOffset: number;
}
export type ReplaySliceErrorCode = "empty_slice" | "boundary_not_found" | "invalid_nth" | "conflicting_boundary";
export interface ReplayTranscriptScanResult {
    readonly rows: readonly ReplayTranscriptReplayableRow[];
    /** Searchable transcript lines with roles other than user/assistant. */
    readonly omittedNonReplayableCount: number;
}
/**
 * Collect replayable user/assistant rows from a transcript file using the same
 * adapter used for transcript search (read-only JSONL stream).
 */
export declare function scanReplayableTranscriptRows(transcriptPath: string): Promise<ReplayTranscriptScanResult>;
export interface ReplaySliceOutcome {
    readonly slice: readonly ReplayTranscriptReplayableRow[];
    readonly omittedNonReplayableCount: number;
    /** Replayable rows excluded after the fork boundary / nth cutoff. */
    readonly omittedReplayableTailCount: number;
}
/**
 * Exactly one boundary selector may be set. When none are set the full replayable slice is kept.
 */
export declare function sliceReplayableRowsForFork(scan: ReplayTranscriptScanResult, boundary?: {
    readonly nthMessage?: number;
    readonly throughMessageId?: string;
}): ReplaySliceOutcome | {
    readonly error: ReplaySliceErrorCode;
};
//# sourceMappingURL=session-replay-slice.d.ts.map