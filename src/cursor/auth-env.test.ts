import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveCursorAuthEnv } from "./auth-env";

describe("resolveCursorAuthEnv", () => {
  const previousApiKey = process.env["CURSOR_API_KEY"];
  const previousAuthToken = process.env["CURSOR_AUTH_TOKEN"];

  beforeEach(() => {
    delete process.env["CURSOR_API_KEY"];
    delete process.env["CURSOR_AUTH_TOKEN"];
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env["CURSOR_API_KEY"];
    } else {
      process.env["CURSOR_API_KEY"] = previousApiKey;
    }
    if (previousAuthToken === undefined) {
      delete process.env["CURSOR_AUTH_TOKEN"];
    } else {
      process.env["CURSOR_AUTH_TOKEN"] = previousAuthToken;
    }
  });

  test("returns empty result when no explicit option or ambient env is set", () => {
    expect(resolveCursorAuthEnv()).toEqual({});
  });

  test("prefers explicit options over ambient env", () => {
    process.env["CURSOR_API_KEY"] = "ambient-key";
    process.env["CURSOR_AUTH_TOKEN"] = "ambient-token";
    expect(
      resolveCursorAuthEnv({
        cursorApiKey: "explicit-key",
        cursorAuthToken: "explicit-token",
      }),
    ).toEqual({
      cursorApiKey: "explicit-key",
      cursorAuthToken: "explicit-token",
    });
  });

  test("falls back to ambient env when options are not provided", () => {
    process.env["CURSOR_API_KEY"] = "ambient-key";
    process.env["CURSOR_AUTH_TOKEN"] = "ambient-token";
    expect(resolveCursorAuthEnv()).toEqual({
      cursorApiKey: "ambient-key",
      cursorAuthToken: "ambient-token",
    });
  });

  test("ignores empty-string values from options and env", () => {
    process.env["CURSOR_API_KEY"] = "";
    expect(
      resolveCursorAuthEnv({ cursorApiKey: "", cursorAuthToken: "" }),
    ).toEqual({});
  });
});
