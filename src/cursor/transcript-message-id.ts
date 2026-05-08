import type { TranscriptSearchRole } from "../types/transcript-search";

/** Stable transcript message id aligned with transcript search hits. */
export function stableTranscriptMessageId(
  eventOffset: number,
  role: TranscriptSearchRole,
): string {
  return `event-${eventOffset}-${role}`;
}
