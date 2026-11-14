import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  scanReplayableTranscriptRows,
  sliceReplayableRowsForFork,
} from "./session-replay-slice";

function userLine(text: string): string {
  return JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text }] },
  });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    role: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

describe("session-replay-slice", () => {
  let dir: string | undefined;
  let transcriptPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "replay-"));
    transcriptPath = join(dir, "t.jsonl");
    const body = [
      userLine("hi"),
      assistantLine("hello"),
      userLine("next"),
    ].join("\n");
    await writeFile(transcriptPath, body, "utf8");
  });

  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test("scan collects user/assistant in order", async () => {
    const scan = await scanReplayableTranscriptRows(transcriptPath);
    expect(scan.rows.length).toBe(3);
    expect(scan.omittedNonReplayableCount).toBe(0);
    expect(scan.rows[0]?.messageId).toBe("event-0-user");
    expect(scan.rows[1]?.messageId).toBe("event-1-assistant");
  });

  test("nthMessage boundary trims tail", async () => {
    const scan = await scanReplayableTranscriptRows(transcriptPath);
    const out = sliceReplayableRowsForFork(scan, { nthMessage: 2 });
    if ("error" in out) throw new Error(out.error);
    expect(out.slice.map((s) => s.displayText)).toEqual(["hi", "hello"]);
    expect(out.omittedReplayableTailCount).toBe(1);
  });

  test("through message id selects inclusive cutoff", async () => {
    const scan = await scanReplayableTranscriptRows(transcriptPath);
    const out = sliceReplayableRowsForFork(scan, {
      throughMessageId: "event-1-assistant",
    });
    if ("error" in out) throw new Error(out.error);
    expect(out.slice.length).toBe(2);
  });

  test("empty transcript yields empty_slice error", async () => {
    if (dir === undefined) {
      throw new Error("missing temp dir");
    }
    const emptyPath = join(dir, "empty.jsonl");
    await writeFile(emptyPath, "", "utf8");
    const scan = await scanReplayableTranscriptRows(emptyPath);
    expect(scan.rows.length).toBe(0);
    const out = sliceReplayableRowsForFork(scan);
    expect("error" in out).toBe(true);
    if ("error" in out) {
      expect(out.error).toBe("empty_slice");
    }
  });

  test("conflicting boundaries return conflicting_boundary error", async () => {
    const scan = await scanReplayableTranscriptRows(transcriptPath);
    const out = sliceReplayableRowsForFork(scan, {
      nthMessage: 1,
      throughMessageId: "event-0-user",
    });
    expect("error" in out).toBe(true);
    if ("error" in out) {
      expect(out.error).toBe("conflicting_boundary");
    }
  });

  test("out-of-range nthMessage returns invalid_nth error", async () => {
    const scan = await scanReplayableTranscriptRows(transcriptPath);
    const out = sliceReplayableRowsForFork(scan, { nthMessage: 100 });
    expect("error" in out).toBe(true);
    if ("error" in out) {
      expect(out.error).toBe("invalid_nth");
    }
  });
});
