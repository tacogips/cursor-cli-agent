import { createHash } from "node:crypto";

import type { AgentEvent, UsageStats } from "../types/agent-event";
import type { UsageEventRecord, UsageEventSource } from "../types/usage-event";

export interface UsageEventContext {
  readonly sessionId: string;
  readonly recordId?: string;
  readonly cursorChatId?: string;
  readonly workspacePath?: string;
  readonly workspaceSlug?: string;
  readonly model?: string;
  readonly observedAt: string;
}

export interface UsageEventExtractor {
  fromAgentEvent(
    event: AgentEvent,
    context: UsageEventContext,
  ): UsageEventRecord | null;
}

function clampNonNegative(n: number): number {
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function tokenTotals(usage: UsageStats): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly hasPositive: boolean;
} {
  const inputTokens = clampNonNegative(usage.inputTokens ?? 0);
  const outputTokens = clampNonNegative(usage.outputTokens ?? 0);
  const cacheReadTokens = clampNonNegative(usage.cacheReadTokens ?? 0);
  const cacheWriteTokens = clampNonNegative(usage.cacheWriteTokens ?? 0);
  const summed =
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const explicit = usage.totalTokens;
  let totalTokens: number;
  if (
    typeof explicit === "number" &&
    Number.isFinite(explicit) &&
    explicit >= 0
  ) {
    totalTokens = clampNonNegative(explicit);
  } else {
    totalTokens = summed;
  }
  const hasPositive = totalTokens > 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    hasPositive,
  };
}

function stableEventId(parts: {
  readonly sessionId: string;
  readonly source: UsageEventSource;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly model: string;
  readonly resultFingerprint: string;
}): string {
  const payload = JSON.stringify(parts);
  return createHash("sha256").update(payload).digest("hex");
}

export function createUsageEventExtractor(): UsageEventExtractor {
  return {
    fromAgentEvent(
      event: AgentEvent,
      context: UsageEventContext,
    ): UsageEventRecord | null {
      if (event.type !== "session.completed") {
        return null;
      }
      const usage = event.usage;
      if (usage === undefined) {
        return null;
      }
      const totals = tokenTotals(usage);
      if (!totals.hasPositive) {
        return null;
      }
      const model =
        context.model !== undefined && context.model.trim().length > 0
          ? context.model.trim()
          : "unknown";
      const resultFingerprint = createHash("sha256")
        .update(event.result)
        .digest("hex");
      const {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
      } = totals;
      const source: UsageEventSource = "stream_result";
      const eventId = stableEventId({
        sessionId: context.sessionId,
        source,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        model,
        resultFingerprint,
      });
      return {
        eventId,
        sessionId: context.sessionId,
        ...(context.recordId !== undefined
          ? { recordId: context.recordId }
          : {}),
        ...(context.cursorChatId !== undefined
          ? { cursorChatId: context.cursorChatId }
          : {}),
        ...(context.workspacePath !== undefined
          ? { workspacePath: context.workspacePath }
          : {}),
        ...(context.workspaceSlug !== undefined
          ? { workspaceSlug: context.workspaceSlug }
          : {}),
        model,
        observedAt: context.observedAt,
        source,
        provenance: "repository_usage_events",
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
      };
    },
  };
}
