import { describe, expect, test } from "bun:test";

import { HttpError } from "./http-errors";
import { decodeResourceUrlSegment } from "./resource-routes";

describe("decodeResourceUrlSegment", () => {
  test("decodes a safe segment", () => {
    expect(decodeResourceUrlSegment("hello%20world")).toBe("hello world");
    expect(decodeResourceUrlSegment("g-1")).toBe("g-1");
  });

  test("rejects empty, slashes, dot segments, and nul", () => {
    for (const raw of [
      "",
      "a/b",
      "%2Fa",
      ".",
      "..",
      "%2E",
      "%2e",
      "%2E%2E",
      "%00",
      "x%00y",
    ]) {
      expect(() => decodeResourceUrlSegment(raw)).toThrow(HttpError);
    }
  });

  test("maps decode failures to invalid path segment", () => {
    expect(() => decodeResourceUrlSegment("%")).toThrow(HttpError);
  });
});
