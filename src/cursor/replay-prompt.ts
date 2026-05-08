import { createHash } from "node:crypto";

import type { CursorSessionRecord } from "../types/session-record";

import type { ReplayTranscriptReplayableRow } from "./session-replay-slice";

/** Limitation strings included in every replay/fork result (design-session-replay-fork). */
export const REPLAY_FORK_LIMITATIONS: readonly string[] = [
  "Cursor native fork semantics are not available through the confirmed local CLI surface.",
  "Replayed context is plain transcript text, not hidden model state.",
  "Tool calls, tool outputs, approvals, file diffs, attachments, and transient runtime state may be absent or incomplete.",
  "The new session may answer differently from the source session because the model receives a synthetic replay prompt.",
  "Transcript files are local Cursor state and may be incomplete until materialization finishes.",
];

export interface BuiltReplayPrompt {
  readonly fullPrompt: string;
  readonly promptPreview: string;
  readonly promptHash: string;
}

export function buildReplayForkPrompt(
  source: CursorSessionRecord,
  slice: readonly ReplayTranscriptReplayableRow[],
  continuationPrompt: string,
  context: {
    readonly omittedNonReplayableCount: number;
    readonly omittedReplayableTailCount: number;
  },
): BuiltReplayPrompt {
  const lines: string[] = [
    "You are continuing a Cursor agent conversation via BEST-EFFORT REPLAY.",
    "This is not a native fork; prior tool calls, approvals, hidden system state, and attachments may be missing.",
    "",
    `Source record: ${source.recordId}`,
    ...(source.localSessionId !== undefined
      ? [`Source local session: ${source.localSessionId}`]
      : []),
    ...(source.cursorChatId !== undefined
      ? [`Source Cursor chat: ${source.cursorChatId}`]
      : []),
    "",
  ];
  if (context.omittedNonReplayableCount > 0) {
    lines.push(
      `Note: ${context.omittedNonReplayableCount} non-user/assistant transcript event(s) were omitted from this replay.`,
    );
  }
  if (context.omittedReplayableTailCount > 0) {
    lines.push(
      `Note: ${context.omittedReplayableTailCount} later user/assistant message(s) were excluded by the selected fork boundary.`,
    );
  }
  lines.push("", "--- Prior conversation (transcript text only) ---", "");
  for (const row of slice) {
    lines.push(
      `[${row.role.toUpperCase()}] ${row.messageId}`,
      row.displayText,
      "",
    );
  }
  lines.push("--- User continuation ---", continuationPrompt);
  const fullPrompt = lines.join("\n");
  const promptHash = createHash("sha256")
    .update(fullPrompt, "utf8")
    .digest("hex");
  const promptPreview =
    fullPrompt.length > 240 ? `${fullPrompt.slice(0, 240)}...` : fullPrompt;
  return { fullPrompt, promptPreview, promptHash };
}
