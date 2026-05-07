import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { tailTranscript } from "./transcript-tail";

let testDir: string;

function transcriptLine(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    role,
    message: { content: [{ type: "text", text }] },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("transcript tail", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "curort-transcript-tail-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("starts from current file size by default", async () => {
    const path = join(testDir, "session.jsonl");
    await writeFile(path, `${transcriptLine("user", "old")}\n`, "utf8");
    const controller = new AbortController();
    const iterator = tailTranscript(path, {
      pollMs: 5,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();

    await delay(10);
    await appendFile(path, `${transcriptLine("assistant", "new")}\n`, "utf8");
    const next = await pending;
    controller.abort();
    await iterator.return?.();
    expect(next.value?.line.role).toBe("assistant");
    expect(next.value?.line.message.displayText).toBe("new");
  });

  test("replays from explicit start offset and ignores malformed rows", async () => {
    const path = join(testDir, "session.jsonl");
    const first = `${transcriptLine("user", "first")}\n`;
    await writeFile(
      path,
      `${first}not-json\n${transcriptLine("assistant", "second")}\n`,
      "utf8",
    );
    const controller = new AbortController();
    const iterator = tailTranscript(path, {
      startOffset: Buffer.byteLength(first, "utf8"),
      pollMs: 5,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const next = await iterator.next();
    controller.abort();
    await iterator.return?.();
    expect(next.value?.byteOffset).toBe(Buffer.byteLength(first, "utf8") + 9);
    expect(next.value?.line.message.displayText).toBe("second");
  });

  test("aborts pending polls without unhandled rejection", async () => {
    const path = join(testDir, "session.jsonl");
    await writeFile(path, "", "utf8");
    const controller = new AbortController();
    const iterator = tailTranscript(path, {
      pollMs: 50,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
  });
});
