import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createFileTokenStore } from "./token-store";

let configDir: string;

describe("file token store", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "cursor-token-store-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  test("returns an empty token config for a missing file", async () => {
    const store = createFileTokenStore({ configDir });
    await expect(store.load()).resolves.toEqual({ tokens: [] });
  });

  test("atomically saves readable JSON without raw token secrets", async () => {
    const store = createFileTokenStore({ configDir });
    await store.save({
      tokens: [
        {
          id: "id-1",
          name: "stored",
          permissions: ["session:read"],
          createdAt: "2026-05-07T00:00:00.000Z",
          tokenHash: "hashed-secret",
        },
      ],
    });

    const raw = await readFile(join(configDir, "tokens.json"), "utf8");
    expect(raw).toContain("hashed-secret");
    expect(raw).not.toContain("raw-secret");
    await expect(store.load()).resolves.toEqual({
      tokens: [
        {
          id: "id-1",
          name: "stored",
          permissions: ["session:read"],
          createdAt: "2026-05-07T00:00:00.000Z",
          tokenHash: "hashed-secret",
        },
      ],
    });
  });
});
