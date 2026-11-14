import { streamTranscriptSearchLines } from "./transcript-reader";
import { stableTranscriptMessageId } from "./transcript-message-id";

export interface ReplayTranscriptReplayableRow {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly displayText: string;
  readonly eventOffset: number;
}

export type ReplaySliceErrorCode =
  | "empty_slice"
  | "boundary_not_found"
  | "invalid_nth"
  | "conflicting_boundary";

export interface ReplayTranscriptScanResult {
  readonly rows: readonly ReplayTranscriptReplayableRow[];
  /** Searchable transcript lines with roles other than user/assistant. */
  readonly omittedNonReplayableCount: number;
}

/**
 * Collect replayable user/assistant rows from a transcript file using the same
 * adapter used for transcript search (read-only JSONL stream).
 */
export async function scanReplayableTranscriptRows(
  transcriptPath: string,
): Promise<ReplayTranscriptScanResult> {
  const rows: ReplayTranscriptReplayableRow[] = [];
  let omittedNonReplayableCount = 0;
  for await (const line of streamTranscriptSearchLines(transcriptPath)) {
    if (line.role !== "user" && line.role !== "assistant") {
      omittedNonReplayableCount += 1;
      continue;
    }
    rows.push({
      messageId: stableTranscriptMessageId(line.eventOffset, line.role),
      role: line.role,
      displayText: line.text,
      eventOffset: line.eventOffset,
    });
  }
  return { rows, omittedNonReplayableCount };
}

export interface ReplaySliceOutcome {
  readonly slice: readonly ReplayTranscriptReplayableRow[];
  readonly omittedNonReplayableCount: number;
  /** Replayable rows excluded after the fork boundary / nth cutoff. */
  readonly omittedReplayableTailCount: number;
}

/**
 * Exactly one boundary selector may be set. When none are set the full replayable slice is kept.
 */
export function sliceReplayableRowsForFork(
  scan: ReplayTranscriptScanResult,
  boundary?: {
    readonly nthMessage?: number;
    readonly throughMessageId?: string;
  },
): ReplaySliceOutcome | { readonly error: ReplaySliceErrorCode } {
  const nth = boundary?.nthMessage;
  const mid = boundary?.throughMessageId;
  if (nth !== undefined && mid !== undefined) {
    return { error: "conflicting_boundary" };
  }
  let slice = scan.rows;
  if (mid !== undefined) {
    const idx = scan.rows.findIndex((r) => r.messageId === mid);
    if (idx < 0) {
      return { error: "boundary_not_found" };
    }
    slice = scan.rows.slice(0, idx + 1);
  } else if (nth !== undefined) {
    if (!Number.isInteger(nth) || nth <= 0) {
      return { error: "invalid_nth" };
    }
    slice = scan.rows.slice(0, nth);
    if (slice.length < nth) {
      return { error: "invalid_nth" };
    }
  }
  if (slice.length === 0) {
    return { error: "empty_slice" };
  }
  const omittedReplayableTailCount = scan.rows.length - slice.length;
  return {
    slice,
    omittedNonReplayableCount: scan.omittedNonReplayableCount,
    omittedReplayableTailCount,
  };
}
