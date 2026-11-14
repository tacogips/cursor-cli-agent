import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createTranscriptBookmarkLookup } from "./transcript-bookmark-lookup";

function transcriptLine(role: string, text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

describe("transcript bookmark lookup", () => {
  test("finds stable message ids and inclusive ranges", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-bookmark-lookup-"));
    const transcriptPath = join(dir, "session.jsonl");
    try {
      await writeFile(
        transcriptPath,
        [
          transcriptLine("user", "<user_query>\nFind alpha\n</user_query>"),
          "{not json",
          transcriptLine("assistant", "assistant beta"),
          transcriptLine("tool", "tool gamma"),
        ].join("\n"),
        "utf8",
      );

      const lookup = createTranscriptBookmarkLookup();
      const message = await lookup.findMessage(transcriptPath, "event-0-user");
      const range = await lookup.findRange(
        transcriptPath,
        "event-0-user",
        "event-3-tool",
      );
      const missing = await lookup.findMessage(transcriptPath, "event-9-user");
      const invalidRange = await lookup.findRange(
        transcriptPath,
        "event-3-tool",
        "event-0-user",
      );

      expect(message?.rawText).toContain("user_query");
      expect(message?.displayText).toBe("Find alpha");
      expect(range.map((item) => item.messageId)).toEqual([
        "event-0-user",
        "event-2-assistant",
        "event-3-tool",
      ]);
      expect(missing).toBeNull();
      expect(invalidRange).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
