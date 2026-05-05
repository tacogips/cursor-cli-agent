import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  parseTranscriptLine,
  streamTranscriptScanLines,
  streamTranscriptSearchLines,
} from "./transcript-reader";

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

describe("streamTranscriptSearchLines", () => {
  it("streams searchable rows with deterministic offsets and skips malformed input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-transcript-reader-"));
    const transcriptPath = join(dir, "session.jsonl");
    try {
      const first = JSON.stringify({
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\nFind the NEEDLE\n</user_query>",
            },
          ],
        },
      });
      const malformed = "{not json";
      const unknown = JSON.stringify({
        role: "unknown",
        message: { content: [{ type: "text", text: "ignored" }] },
      });
      const tool = JSON.stringify({
        role: "tool",
        message: { content: [{ type: "text", text: "tool needle" }] },
      });
      const inputText = JSON.stringify({
        role: "user",
        message: { content: [{ type: "input_text", text: "input needle" }] },
      });
      await writeFile(
        transcriptPath,
        `${first}\n${malformed}\n${unknown}\n${tool}\n${inputText}\n`,
        "utf8",
      );

      const lines = [];
      for await (const line of streamTranscriptSearchLines(transcriptPath)) {
        lines.push(line);
      }

      expect(lines).toHaveLength(3);
      expect(lines[0]?.role).toBe("user");
      expect(lines[0]?.text.trim()).toBe("Find the NEEDLE");
      expect(lines[0]?.eventOffset).toBe(0);
      expect(lines[0]?.byteOffset).toBe(0);
      expect(lines[0]?.byteLength).toBeGreaterThan(0);
      expect(lines[1]?.role).toBe("tool");
      expect(lines[1]?.eventOffset).toBe(3);
      expect(lines[1]?.byteOffset).toBeGreaterThan(0);
      expect(lines[2]?.text).toBe("input needle");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("streams scan rows for malformed and unknown-role input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curort-transcript-reader-"));
    const transcriptPath = join(dir, "session.jsonl");
    try {
      const unknown = JSON.stringify({
        role: "unknown",
        message: { content: [{ type: "text", text: "ignored" }] },
      });
      await writeFile(transcriptPath, `{not json\n${unknown}\n`, "utf8");

      const lines = [];
      for await (const line of streamTranscriptScanLines(transcriptPath)) {
        lines.push(line);
      }

      expect(lines).toHaveLength(2);
      expect(lines[0]?.searchable).toBe(false);
      expect(lines[0]?.eventOffset).toBe(0);
      expect(lines[0]?.byteOffset).toBe(0);
      expect(lines[0]?.byteLength).toBeGreaterThan(0);
      expect(lines[1]?.searchable).toBe(false);
      expect(lines[1]?.eventOffset).toBe(1);
      expect(lines[1]?.byteOffset).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
