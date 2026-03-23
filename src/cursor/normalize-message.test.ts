import { describe, expect, it } from "vitest";

import { joinTextParts, normalizeTextBlock } from "./normalize-message";

describe("normalizeTextBlock", () => {
  it("unwraps user_query wrapper for user role", () => {
    const raw = "<user_query>\nHello\n</user_query>";
    const m = normalizeTextBlock("user", raw);
    expect(m.rawText).toBe(raw);
    expect(m.displayText).toBe("Hello");
    expect(m.structured?.userQueryText).toBe("Hello");
  });

  it("leaves non-wrapped user text unchanged", () => {
    const m = normalizeTextBlock("user", "plain");
    expect(m.displayText).toBe("plain");
    expect(m.structured).toBeUndefined();
  });

  it("does not unwrap assistant role", () => {
    const m = normalizeTextBlock("assistant", "<user_query>x</user_query>");
    expect(m.displayText).toBe("<user_query>x</user_query>");
  });
});

describe("joinTextParts", () => {
  it("joins text blocks", () => {
    expect(
      joinTextParts([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });
});
