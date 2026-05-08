import { describe, expect, test } from "bun:test";

import { createUsageEventExtractor } from "./usage-events";

describe("usage event extractor", () => {
  const extractor = createUsageEventExtractor();

  test("returns null for events without positive token evidence", () => {
    expect(
      extractor.fromAgentEvent(
        {
          type: "session.completed",
          sessionId: "s1",
          result: "ok",
          usage: {},
        },
        {
          sessionId: "s1",
          observedAt: "2026-05-08T01:00:00.000Z",
        },
      ),
    ).toBeNull();

    expect(
      extractor.fromAgentEvent(
        {
          type: "session.completed",
          sessionId: "s1",
          result: "ok",
          usage: {
            totalTokens: 0,
          },
        },
        {
          sessionId: "s1",
          observedAt: "2026-05-08T01:00:00.000Z",
        },
      ),
    ).toBeNull();
  });

  test("stable ids ignore capture time so duplicate stream deliveries dedupe", () => {
    const ev = {
      type: "session.completed" as const,
      sessionId: "local-a",
      result: "done",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
    };
    const first = extractor.fromAgentEvent(ev, {
      sessionId: "local-a",
      observedAt: "2026-05-08T02:00:00.000Z",
    });
    const second = extractor.fromAgentEvent(ev, {
      sessionId: "local-a",
      observedAt: "2026-05-08T02:00:01.500Z",
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.eventId).toBe(second!.eventId);
    expect(first!.observedAt).toBe("2026-05-08T02:00:00.000Z");
    expect(second!.observedAt).toBe("2026-05-08T02:00:01.500Z");
  });

  test("builds normalized usage rows with stable ids for identical payloads", () => {
    const ctx = {
      sessionId: "local-a",
      recordId: "rec-a",
      cursorChatId: "chat-a",
      workspacePath: "/tmp/ws",
      workspaceSlug: "tmp-ws",
      model: "gpt-test",
      observedAt: "2026-05-08T02:00:00.000Z",
    };
    const ev = {
      type: "session.completed" as const,
      sessionId: "local-a",
      result: "done",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
    };
    const first = extractor.fromAgentEvent(ev, ctx);
    const second = extractor.fromAgentEvent(ev, ctx);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.eventId).toBe(second!.eventId);
    expect(first!.totalTokens).toBe(10);
    expect(first!.provenance).toBe("repository_usage_events");
    expect(first!.source).toBe("stream_result");
  });

  test("prefers explicit totalTokens over summed component totals", () => {
    const row = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-sum",
        result: "x",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 99,
        },
      },
      {
        sessionId: "local-sum",
        observedAt: "2026-05-08T06:00:00.000Z",
      },
    );
    expect(row?.inputTokens).toBe(1);
    expect(row?.outputTokens).toBe(2);
    expect(row?.totalTokens).toBe(99);
  });

  test("persists total-only usage when breakdown fields are omitted", () => {
    const row = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-tonly",
        result: "x",
        usage: { totalTokens: 50 },
      },
      {
        sessionId: "local-tonly",
        observedAt: "2026-05-08T07:00:00.000Z",
      },
    );
    expect(row?.inputTokens).toBe(0);
    expect(row?.outputTokens).toBe(0);
    expect(row?.totalTokens).toBe(50);
  });

  test("falls back to unknown model when missing", () => {
    const row = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-b",
        result: "x",
        usage: { outputTokens: 5 },
      },
      {
        sessionId: "local-b",
        observedAt: "2026-05-08T03:00:00.000Z",
      },
    );
    expect(row?.model).toBe("unknown");
    expect(row?.totalTokens).toBe(5);
  });

  test("treats whitespace-only context model as unknown", () => {
    const row = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-c",
        result: "x",
        usage: { inputTokens: 1 },
      },
      {
        sessionId: "local-c",
        model: "   ",
        observedAt: "2026-05-08T04:00:00.000Z",
      },
    );
    expect(row?.model).toBe("unknown");
  });

  test("distinct completion bodies with identical usage produce distinct event ids", () => {
    const prefix = "a".repeat(5000);
    const ctx = {
      sessionId: "local-d",
      model: "m1",
      observedAt: "2026-05-08T05:00:00.000Z",
    };
    const usage = {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const a = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-d",
        result: `${prefix}-suffix-a`,
        usage,
      },
      ctx,
    );
    const b = extractor.fromAgentEvent(
      {
        type: "session.completed",
        sessionId: "local-d",
        result: `${prefix}-suffix-b`,
        usage,
      },
      ctx,
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.eventId).not.toBe(b!.eventId);
  });
});
