import { describe, expect, it } from "vitest";

import { parseTranscriptLine } from "./transcript-reader";

describe("parseTranscriptLine", () => {
  it("parses observed transcript shape", () => {
    const line = JSON.stringify({
      role: "user",
      message: {
        content: [
          {
            type: "text",
            text: "<user_query>\nReply with exactly OK\n</user_query>",
          },
        ],
      },
    });
    const t = parseTranscriptLine(line);
    expect(t?.role).toBe("user");
    expect(t?.message.rawText).toContain("user_query");
    expect(t?.message.displayText.trim()).toBe("Reply with exactly OK");
  });
});
