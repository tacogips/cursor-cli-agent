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
