import { describe, expect, test } from "bun:test";

import { buildReplayForkPrompt } from "./replay-prompt";
import type { CursorSessionRecord } from "../types/session-record";
import type { ReplayTranscriptReplayableRow } from "./session-replay-slice";

describe("replay-prompt", () => {
  test("includes continuation and hashes prompt", () => {
    const source = {
      recordId: "r1",
      identityState: "transcript_only" as const,
      workspaceSlug: "w",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
      source: "headless" as const,
      status: "completed" as const,
    } satisfies CursorSessionRecord;
    const slice: ReplayTranscriptReplayableRow[] = [
      {
        messageId: "event-0-user",
        role: "user",
        displayText: "hi",
        eventOffset: 0,
      },
    ];
    const out = buildReplayForkPrompt(source, slice, "next step", {
      omittedNonReplayableCount: 0,
      omittedReplayableTailCount: 1,
    });
    expect(out.fullPrompt).toContain("next step");
    expect(out.fullPrompt).toContain("BEST-EFFORT REPLAY");
    expect(out.promptHash.length).toBe(64);
    expect(out.promptPreview.length).toBeGreaterThan(0);
  });
});
