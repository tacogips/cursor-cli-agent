import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

import type { NormalizedMessage } from "../types/agent-event";
import type { TranscriptSearchRole } from "../types/transcript-search";
import { joinTextParts, normalizeTextBlock } from "./normalize-message";

export interface TranscriptLine {
  readonly role: "user" | "assistant";
  readonly message: NormalizedMessage;
}

export interface TranscriptSummary {
  readonly lines: readonly TranscriptLine[];
  readonly firstUserMessage?: NormalizedMessage;
  readonly lastAssistantMessage?: NormalizedMessage;
}

export interface TranscriptParseError {
  readonly line: number;
  readonly message: string;
}

export interface TranscriptSearchLine {
  readonly role: TranscriptSearchRole;
  readonly rawText: string;
  readonly text: string;
  readonly eventOffset: number;
  readonly byteOffset: number;
  readonly byteLength: number;
}

export type TranscriptScanLine =
  | (TranscriptSearchLine & { readonly searchable: true })
  | {
      readonly searchable: false;
      readonly eventOffset: number;
      readonly byteOffset: number;
      readonly byteLength: number;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseRole(raw: unknown): "user" | "assistant" | undefined {
  if (raw === "user" || raw === "assistant") {
    return raw;
  }
  return undefined;
}

function parseSearchRole(raw: unknown): TranscriptSearchRole | undefined {
  if (
    raw === "user" ||
    raw === "assistant" ||
    raw === "system" ||
    raw === "tool"
  ) {
    return raw;
  }
  return undefined;
}

function joinSearchTextParts(parts: readonly unknown[]): string {
  let out = "";
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    const type = part["type"];
    const text = part["text"];
    if (
      typeof text === "string" &&
      (type === "text" || type === "input_text" || type === "output_text")
    ) {
      out += text;
    }
  }
  return out;
}

/**
 * Parse a single JSONL transcript line.
 */
export function parseTranscriptLine(json: string): TranscriptLine | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const role = parseRole(parsed["role"]);
  if (role === undefined) {
    return undefined;
  }
  const message = parsed["message"];
  if (!isRecord(message)) {
    return undefined;
  }
  const content = message["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts = content as { type?: string; text?: string }[];
  const rawText = joinTextParts(textParts);
  const norm = normalizeTextBlock(role, rawText);
  return { role, message: norm };
}

function parseTranscriptSearchJsonLine(
  json: string,
  eventOffset: number,
  byteOffset: number,
  byteLength: number,
): TranscriptSearchLine | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const message = parsed["message"];
  const messageRecord = isRecord(message) ? message : undefined;
  const role = parseSearchRole(
    parsed["role"] ?? messageRecord?.["role"] ?? parsed["type"],
  );
  if (role === undefined || messageRecord === undefined) {
    return undefined;
  }
  const content = messageRecord["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }
  const rawText = joinSearchTextParts(content);
  if (rawText.length === 0) {
    return undefined;
  }
  const text =
    role === "user" || role === "assistant"
      ? normalizeTextBlock(role, rawText).displayText
      : rawText;
  return { role, rawText, text, eventOffset, byteOffset, byteLength };
}

/**
 * Read a full transcript file and compute summary fields.
 */
export async function readTranscriptFile(
  path: string,
): Promise<TranscriptSummary> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parsed: TranscriptLine[] = [];
  for (const line of lines) {
    const t = parseTranscriptLine(line);
    if (t !== undefined) {
      parsed.push(t);
    }
  }
  let firstUser: NormalizedMessage | undefined;
  let lastAsst: NormalizedMessage | undefined;
  for (const row of parsed) {
    if (row.role === "user" && firstUser === undefined) {
      firstUser = row.message;
    }
    if (row.role === "assistant") {
      lastAsst = row.message;
    }
  }
  return {
    lines: parsed,
    ...(firstUser !== undefined ? { firstUserMessage: firstUser } : {}),
    ...(lastAsst !== undefined ? { lastAssistantMessage: lastAsst } : {}),
  };
}

/**
 * Stream transcript rows with scan metadata for full-text search budgets.
 */
export async function* streamTranscriptScanLines(
  transcriptPath: string,
): AsyncGenerator<TranscriptScanLine, void, undefined> {
  const stream = createReadStream(transcriptPath, { encoding: "utf8" });
  let pending = "";
  let lineStartByte = 0;
  let eventOffset = 0;

  for await (const chunk of stream) {
    pending += chunk;
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = pending.slice(0, newlineIndex);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const lineByteOffset = lineStartByte;
      const lineByteLength = Buffer.byteLength(rawLine, "utf8") + 1;
      lineStartByte += lineByteLength;
      pending = pending.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        const parsed = parseTranscriptSearchJsonLine(
          line,
          eventOffset,
          lineByteOffset,
          lineByteLength,
        );
        yield parsed === undefined
          ? {
              searchable: false,
              eventOffset,
              byteOffset: lineByteOffset,
              byteLength: lineByteLength,
            }
          : { ...parsed, searchable: true };
        eventOffset += 1;
      }
      newlineIndex = pending.indexOf("\n");
    }
  }

  if (pending.trim().length > 0) {
    const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
    const lineByteLength = Buffer.byteLength(pending, "utf8");
    const parsed = parseTranscriptSearchJsonLine(
      line,
      eventOffset,
      lineStartByte,
      lineByteLength,
    );
    yield parsed === undefined
      ? {
          searchable: false,
          eventOffset,
          byteOffset: lineStartByte,
          byteLength: lineByteLength,
        }
      : { ...parsed, searchable: true };
  }
}

/**
 * Stream searchable transcript lines without loading the full file.
 */
export async function* streamTranscriptSearchLines(
  transcriptPath: string,
): AsyncGenerator<TranscriptSearchLine, void, undefined> {
  for await (const line of streamTranscriptScanLines(transcriptPath)) {
    if (line.searchable) {
      const { searchable: _searchable, ...searchLine } = line;
      yield searchLine;
    }
  }
}
