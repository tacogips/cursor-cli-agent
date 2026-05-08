import type {
  AgentEvent,
  NormalizedMessage,
  UsageStats,
} from "../types/agent-event";
import { joinTextParts, normalizeTextBlock } from "./normalize-message";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readString(
  r: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}

function parseUsage(raw: unknown): UsageStats | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const inputTokens = raw["inputTokens"];
  const outputTokens = raw["outputTokens"];
  const cacheReadTokens = raw["cacheReadTokens"];
  const cacheWriteTokens = raw["cacheWriteTokens"];
  const totalCamel = raw["totalTokens"];
  const totalSnake = raw["total_tokens"];
  const rawTotal =
    typeof totalCamel === "number"
      ? totalCamel
      : typeof totalSnake === "number"
        ? totalSnake
        : undefined;
  const totalTokens =
    rawTotal !== undefined && Number.isFinite(rawTotal) && rawTotal >= 0
      ? rawTotal
      : undefined;
  const u: UsageStats = {
    ...(typeof inputTokens === "number" ? { inputTokens } : {}),
    ...(typeof outputTokens === "number" ? { outputTokens } : {}),
    ...(typeof cacheReadTokens === "number" ? { cacheReadTokens } : {}),
    ...(typeof cacheWriteTokens === "number" ? { cacheWriteTokens } : {}),
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
  };
  if (
    u.inputTokens === undefined &&
    u.outputTokens === undefined &&
    u.cacheReadTokens === undefined &&
    u.cacheWriteTokens === undefined &&
    u.totalTokens === undefined
  ) {
    return undefined;
  }
  return u;
}

function messageFromStreamUserContent(
  role: "user" | "assistant",
  msg: unknown,
): NormalizedMessage | undefined {
  if (!isRecord(msg)) {
    return undefined;
  }
  const content = msg["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }
  const rawText = joinTextParts(content as { type?: string; text?: string }[]);
  return normalizeTextBlock(role, rawText);
}

export class StreamNormalizerState {
  private readonly lastAssistantBySession = new Map<string, string>();

  /**
   * Convert one `stream-json` line into normalized events.
   */
  processLine(line: string): readonly AgentEvent[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [
        {
          type: "session.error",
          message: "Invalid JSON in stream-json line",
        },
      ];
    }
    if (!isRecord(parsed)) {
      return [];
    }
    const t = readString(parsed, "type");
    const sessionId = readString(parsed, "session_id");

    if (t === "system" && readString(parsed, "subtype") === "init") {
      const cwd = readString(parsed, "cwd");
      const model = readString(parsed, "model");
      if (sessionId !== undefined && cwd !== undefined) {
        const ev: AgentEvent =
          model !== undefined
            ? { type: "session.started", sessionId, cwd, model }
            : { type: "session.started", sessionId, cwd };
        return [ev];
      }
      return [];
    }

    if (t === "user" && sessionId !== undefined) {
      const msg = parsed["message"];
      const nm = messageFromStreamUserContent("user", msg);
      if (nm !== undefined) {
        return [{ type: "session.user_message", sessionId, message: nm }];
      }
      return [];
    }

    if (t === "assistant" && sessionId !== undefined) {
      const msg = parsed["message"];
      const nm = messageFromStreamUserContent("assistant", msg);
      if (nm === undefined) {
        return [];
      }
      const prev = this.lastAssistantBySession.get(sessionId);
      if (prev === nm.rawText) {
        return [];
      }
      this.lastAssistantBySession.set(sessionId, nm.rawText);
      return [{ type: "session.assistant_message", sessionId, message: nm }];
    }

    if (t === "thinking" && sessionId !== undefined) {
      const st = readString(parsed, "subtype");
      if (st === "delta") {
        return [{ type: "session.thinking", sessionId, state: "delta" }];
      }
      if (st === "completed") {
        return [{ type: "session.thinking", sessionId, state: "completed" }];
      }
      return [];
    }

    if (t === "result" && sessionId !== undefined) {
      const resultText = readString(parsed, "result") ?? "";
      const isError = parsed["is_error"] === true;
      const usage = parseUsage(parsed["usage"]);
      this.lastAssistantBySession.delete(sessionId);
      if (isError) {
        return [
          {
            type: "session.error",
            sessionId,
            message: resultText.length > 0 ? resultText : "Result error",
          },
        ];
      }
      const out: AgentEvent = {
        type: "session.completed",
        sessionId,
        result: resultText,
      };
      if (usage !== undefined) {
        return [{ ...out, usage }];
      }
      return [out];
    }

    return [];
  }
}
