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

/**
 * `stream-json` partial lines may carry either cumulative snapshots or
 * incremental suffix tokens. Merge into a running total and compute the new
 * substring to surface to consumers.
 */
function extendPartialAssistantText(
  accumulated: string,
  chunk: string,
): { readonly next: string; readonly delta: string } {
  if (chunk.length === 0) {
    return { next: accumulated, delta: "" };
  }
  if (accumulated.length > 0 && chunk.startsWith(accumulated)) {
    return { next: chunk, delta: chunk.slice(accumulated.length) };
  }
  return { next: accumulated + chunk, delta: chunk };
}

function isStreamPartialTimestamp(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class StreamNormalizerState {
  private readonly lastAssistantBySession = new Map<string, string>();
  private readonly partialAssistantTextBySession = new Map<string, string>();

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
      const tsMs = parsed["timestamp_ms"];
      if (isStreamPartialTimestamp(tsMs)) {
        const prevAcc = this.partialAssistantTextBySession.get(sessionId) ?? "";
        const { next, delta } = extendPartialAssistantText(prevAcc, nm.rawText);
        this.partialAssistantTextBySession.set(sessionId, next);
        if (delta.length === 0) {
          return [];
        }
        const deltaMsg = normalizeTextBlock("assistant", delta);
        return [
          { type: "session.assistant_message", sessionId, message: deltaMsg },
        ];
      }

      const partialAcc = this.partialAssistantTextBySession.get(sessionId);
      if (partialAcc !== undefined && partialAcc.length > 0) {
        if (nm.rawText === partialAcc) {
          this.partialAssistantTextBySession.delete(sessionId);
          this.lastAssistantBySession.set(sessionId, nm.rawText);
          return [];
        }
        if (nm.rawText.startsWith(partialAcc)) {
          const tail = nm.rawText.slice(partialAcc.length);
          this.partialAssistantTextBySession.delete(sessionId);
          this.lastAssistantBySession.set(sessionId, nm.rawText);
          if (tail.length === 0) {
            return [];
          }
          const tailMsg = normalizeTextBlock("assistant", tail);
          return [
            { type: "session.assistant_message", sessionId, message: tailMsg },
          ];
        }
        this.partialAssistantTextBySession.delete(sessionId);
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
      this.partialAssistantTextBySession.delete(sessionId);
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
