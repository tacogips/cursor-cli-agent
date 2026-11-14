import { describe, expect, it } from "bun:test";

import { StreamNormalizerState } from "./stream-normalizer";

describe("StreamNormalizerState", () => {
  it("emits session.started from system init", () => {
    const n = new StreamNormalizerState();
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: "/tmp/w",
      session_id: "s1",
      model: "M",
    });
    const evs = n.processLine(line);
    expect(evs[0]?.type).toBe("session.started");
  });

  it("deduplicates identical assistant payloads", () => {
    const n = new StreamNormalizerState();
    const base = {
      type: "assistant",
      session_id: "s1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "same" }],
      },
    };
    const a = n.processLine(JSON.stringify(base));
    const b = n.processLine(JSON.stringify(base));
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);
  });

  function assistantPartialLine(
    sessionId: string,
    text: string,
    timestampMs: number,
  ): string {
    return JSON.stringify({
      type: "assistant",
      session_id: sessionId,
      timestamp_ms: timestampMs,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    });
  }

  it("emits tail-only final assistant when partials are a prefix of full reply", () => {
    const n = new StreamNormalizerState();
    const sid = "s-partial";

    const d0 = n.processLine(assistantPartialLine(sid, "I", 100));
    const d1 = n.processLine(assistantPartialLine(sid, " will", 101));

    expect(d0).toHaveLength(1);
    expect(d1).toHaveLength(1);

    expect(d0[0]?.type).toBe("session.assistant_message");
    expect(d1[0]?.type).toBe("session.assistant_message");
    if (
      d0[0]?.type === "session.assistant_message" &&
      d1[0]?.type === "session.assistant_message"
    ) {
      expect(d0[0].message.rawText).toBe("I");
      expect(d1[0].message.rawText).toBe(" will");
    }

    const finalFull = n.processLine(
      JSON.stringify({
        type: "assistant",
        session_id: sid,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will reply OK." }],
        },
      }),
    );
    expect(finalFull).toHaveLength(1);
    expect(finalFull[0]?.type).toBe("session.assistant_message");
    if (finalFull[0]?.type === "session.assistant_message") {
      expect(finalFull[0].message.rawText).toBe(" reply OK.");
    }

    const done = n.processLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: sid,
        is_error: false,
        result: "I will reply OK.",
        usage: { inputTokens: 3, outputTokens: 4 },
      }),
    );

    expect(done[0]?.type).toBe("session.completed");
    if (done[0]?.type === "session.completed") {
      expect(done[0].result).toBe("I will reply OK.");
      expect(done[0].usage?.inputTokens).toBe(3);
      expect(done[0].usage?.outputTokens).toBe(4);
    }
  });

  it("drops exact full-text final assistant after partial stream already assembled it", () => {
    const n = new StreamNormalizerState();
    const sid = "s-exact-final";
    n.processLine(assistantPartialLine(sid, "I", 1));
    n.processLine(assistantPartialLine(sid, " am", 2));
    n.processLine(assistantPartialLine(sid, " done.", 3));
    const redundant = n.processLine(
      JSON.stringify({
        type: "assistant",
        session_id: sid,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I am done." }],
        },
      }),
    );
    expect(redundant).toHaveLength(0);
  });

  it("treats timestamp_ms 0 as a regular assistant payload, not partial streaming", () => {
    const n = new StreamNormalizerState();
    const line = JSON.stringify({
      type: "assistant",
      session_id: "s-ts0",
      timestamp_ms: 0,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "full" }],
      },
    });
    const first = n.processLine(line);
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("session.assistant_message");
    expect(n.processLine(line)).toHaveLength(0);
  });

  it("keeps partial assistant streams independent per session id", () => {
    const n = new StreamNormalizerState();
    const evA = n.processLine(assistantPartialLine("sa", "A", 1));
    const evB = n.processLine(assistantPartialLine("sb", "B", 1));
    const evA2 = n.processLine(assistantPartialLine("sa", "A2", 2));
    expect(evA).toHaveLength(1);
    expect(evB).toHaveLength(1);
    expect(evA2).toHaveLength(1);
    if (
      evA[0]?.type === "session.assistant_message" &&
      evB[0]?.type === "session.assistant_message" &&
      evA2[0]?.type === "session.assistant_message"
    ) {
      expect(evA[0].sessionId).toBe("sa");
      expect(evA[0].message.rawText).toBe("A");
      expect(evB[0].sessionId).toBe("sb");
      expect(evB[0].message.rawText).toBe("B");
      expect(evA2[0].sessionId).toBe("sa");
      expect(evA2[0].message.rawText).toBe("2");
    }
  });

  it("fallback when final assistant does not extend partial resets and dedupes identical full replies", () => {
    const n = new StreamNormalizerState();
    const sid = "s-fallback";
    n.processLine(assistantPartialLine(sid, "partial", 1));
    const fullPayload = JSON.stringify({
      type: "assistant",
      session_id: sid,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "UNRELATED" }],
      },
    });
    const once = n.processLine(fullPayload);
    expect(once).toHaveLength(1);
    if (once[0]?.type === "session.assistant_message") {
      expect(once[0].message.rawText).toBe("UNRELATED");
    }
    expect(n.processLine(fullPayload)).toHaveLength(0);
  });

  it("dedupes repeated cumulative snapshots from timestamp_ms lines via empty delta", () => {
    const n = new StreamNormalizerState();
    const sid = "s-cumulative";
    const a = n.processLine(assistantPartialLine(sid, "Hello", 1));
    expect(a).toHaveLength(1);
    const dup = n.processLine(assistantPartialLine(sid, "Hello", 2));
    expect(dup).toHaveLength(0);
    const ext = n.processLine(assistantPartialLine(sid, "Hello!", 3));
    expect(ext).toHaveLength(1);
    if (ext[0]?.type === "session.assistant_message") {
      expect(ext[0].message.rawText).toBe("!");
    }
  });

  it("emits session.completed with usage", () => {
    const n = new StreamNormalizerState();
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "s1",
      is_error: false,
      result: "\nOK",
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    const evs = n.processLine(line);
    expect(evs[0]?.type).toBe("session.completed");
    if (evs[0]?.type === "session.completed") {
      expect(evs[0].usage?.inputTokens).toBe(1);
    }
  });

  it("emits session.completed when usage carries only explicit total_tokens", () => {
    const n = new StreamNormalizerState();
    const line = JSON.stringify({
      type: "result",
      session_id: "s1",
      is_error: false,
      result: "",
      usage: { total_tokens: 42 },
    });
    const evs = n.processLine(line);
    expect(evs[0]?.type).toBe("session.completed");
    if (evs[0]?.type === "session.completed") {
      expect(evs[0].usage?.totalTokens).toBe(42);
    }
  });

  it("drops negative explicit totals and keeps component usage", () => {
    const n = new StreamNormalizerState();
    const line = JSON.stringify({
      type: "result",
      session_id: "s1",
      is_error: false,
      result: "",
      usage: { total_tokens: -1, inputTokens: 2 },
    });
    const evs = n.processLine(line);
    expect(evs[0]?.type).toBe("session.completed");
    if (evs[0]?.type === "session.completed") {
      expect(evs[0].usage?.inputTokens).toBe(2);
      expect(evs[0].usage?.totalTokens).toBeUndefined();
    }
  });
});
