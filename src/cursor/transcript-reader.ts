import { readFile } from "node:fs/promises";

import type { NormalizedMessage } from "../types/agent-event";
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseRole(raw: unknown): "user" | "assistant" | undefined {
  if (raw === "user" || raw === "assistant") {
    return raw;
  }
  return undefined;
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
