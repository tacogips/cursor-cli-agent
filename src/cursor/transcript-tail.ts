import { readFile, stat } from "node:fs/promises";

import { parseTranscriptLine, type TranscriptLine } from "./transcript-reader";

export interface TranscriptTailOptions {
  readonly startOffset?: number;
  readonly pollMs?: number;
  readonly signal: AbortSignal;
}

export interface TranscriptTailEvent {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly line: TranscriptLine;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function* tailTranscript(
  transcriptPath: string,
  options: TranscriptTailOptions,
): AsyncGenerator<TranscriptTailEvent, void, undefined> {
  if (
    options.startOffset !== undefined &&
    (!Number.isInteger(options.startOffset) || options.startOffset < 0)
  ) {
    throw new Error("startOffset must be a non-negative integer");
  }

  const pollMs = options.pollMs ?? 250;
  let offset = options.startOffset ?? (await fileSize(transcriptPath));
  let pending = "";
  let pendingByteOffset = offset;

  while (!options.signal.aborted) {
    let buffer: Buffer | undefined;
    try {
      buffer = await readFile(transcriptPath);
    } catch {
      buffer = undefined;
    }

    if (buffer !== undefined) {
      if (buffer.length < offset) {
        offset = buffer.length;
        pending = "";
        pendingByteOffset = offset;
      }
      if (buffer.length > offset) {
        const chunk = buffer.subarray(offset).toString("utf8");
        pending += chunk;
        offset = buffer.length;

        let newlineIndex = pending.indexOf("\n");
        while (newlineIndex >= 0) {
          const rawLine = pending.slice(0, newlineIndex);
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          const lineByteLength = Buffer.byteLength(rawLine, "utf8") + 1;
          const byteOffset = pendingByteOffset;
          pendingByteOffset += lineByteLength;
          pending = pending.slice(newlineIndex + 1);

          if (line.trim().length > 0) {
            const parsed = parseTranscriptLine(line);
            if (parsed !== undefined) {
              yield { byteOffset, byteLength: lineByteLength, line: parsed };
            }
          }
          newlineIndex = pending.indexOf("\n");
        }
      }
    }

    await waitForPoll(pollMs, options.signal);
  }
}
