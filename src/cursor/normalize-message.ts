import type { NormalizedMessage } from "../types/agent-event";

const USER_QUERY_WRAP = /^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/;

/**
 * Build a normalized user/assistant message from a single text block.
 */
export function normalizeTextBlock(
  role: "user" | "assistant",
  rawText: string,
): NormalizedMessage {
  if (role === "user") {
    const m = rawText.match(USER_QUERY_WRAP);
    if (m?.[1] !== undefined) {
      const inner = m[1];
      return {
        role: "user",
        rawText,
        displayText: inner,
        structured: { userQueryText: inner },
      };
    }
  }
  return { role, rawText, displayText: rawText };
}

/**
 * Concatenate text parts from stream-json or transcript content blocks.
 */
export function joinTextParts(
  parts: readonly { type?: string; text?: string }[],
): string {
  let out = "";
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") {
      out += p.text;
    }
  }
  return out;
}
