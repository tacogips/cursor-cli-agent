import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_AUTH_PERMISSIONS,
  hasAuthPermission,
  parseAuthPermissionList,
} from "./index";
import {
  createTokenManager,
  TokenInputError,
  TokenNotFoundError,
} from "./token-manager";

let configDir: string;

describe("auth permission helpers", () => {
  test("normalizes defaults and wildcard family permissions", () => {
    expect(DEFAULT_AUTH_PERMISSIONS).toEqual(["session:read"]);
    expect(parseAuthPermissionList("session:read, group:*, nope")).toEqual([
      "session:read",
      "group:*",
    ]);
    expect(hasAuthPermission(["group:*"], "group:*")).toBe(true);
    expect(hasAuthPermission(["files:*"], "files:*")).toBe(true);
    expect(hasAuthPermission(["session:read"], "session:create")).toBe(false);
  });
});

describe("token manager", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "curort-token-manager-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  test("creates and verifies a default session-read token", async () => {
    const manager = createTokenManager({ configDir });
    const created = await manager.createToken({ name: "default token" });

    expect(created.token).toContain(`${created.metadata.id}.`);
    expect(created.metadata.permissions).toEqual(["session:read"]);

    const verified = await manager.verifyToken(created.token);
    expect(verified.ok).toBe(true);
    expect(verified.metadata?.id).toBe(created.metadata.id);
  });

  test("lists metadata newest first without hashes or raw secrets", async () => {
    const manager = createTokenManager({ configDir });
    await manager.createToken({ name: "older", permissions: ["group:*"] });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newer = await manager.createToken({
      name: "newer",
      permissions: ["queue:*"],
    });

    const tokens = await manager.listTokens();
    expect(tokens.map((token) => token.name)).toEqual(["newer", "older"]);
    expect(JSON.stringify(tokens)).not.toContain("tokenHash");
    expect(JSON.stringify(tokens)).not.toContain(newer.token);

    const rawConfig = await readFile(join(configDir, "tokens.json"), "utf8");
    expect(rawConfig).toContain("tokenHash");
    expect(rawConfig).not.toContain(newer.token);
  });

  test("rejects invalid create input", async () => {
    const manager = createTokenManager({ configDir });
    await expect(manager.createToken({ name: " " })).rejects.toBeInstanceOf(
      TokenInputError,
    );
    await expect(
      manager.createToken({ name: "bad", permissions: ["session:read", "no"] }),
    ).rejects.toBeInstanceOf(TokenInputError);
    await expect(
      manager.createToken({ name: "bad", expiresAt: "not-a-date" }),
    ).rejects.toBeInstanceOf(TokenInputError);
  });

  test("revokes tokens idempotently and blocks verification", async () => {
    const manager = createTokenManager({ configDir });
    const created = await manager.createToken({
      name: "revokable",
      permissions: ["queue:*"],
    });

    const revoked = await manager.revokeToken(created.metadata.id);
    expect(revoked.revokedAt).toBeDefined();
    const revokedAgain = await manager.revokeToken(created.metadata.id);
    if (revoked.revokedAt === undefined) {
      throw new Error("revokedAt was not set");
    }
    expect(revokedAgain.revokedAt).toBe(revoked.revokedAt);
    expect((await manager.verifyToken(created.token)).ok).toBe(false);
  });

  test("rotates tokens, clears revocation, and invalidates previous secrets", async () => {
    const manager = createTokenManager({ configDir });
    const created = await manager.createToken({ name: "rotatable" });
    await manager.revokeToken(created.metadata.id);

    const rotated = await manager.rotateToken(created.metadata.id);
    expect(rotated.metadata.revokedAt).toBeUndefined();
    expect(rotated.token).not.toBe(created.token);
    expect((await manager.verifyToken(created.token)).ok).toBe(false);
    expect((await manager.verifyToken(rotated.token)).ok).toBe(true);
  });

  test("rejects malformed, unknown, expired, and mismatched tokens", async () => {
    const manager = createTokenManager({ configDir });
    const expired = await manager.createToken({
      name: "expired",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const active = await manager.createToken({ name: "active" });

    expect((await manager.verifyToken("not-a-token")).ok).toBe(false);
    expect((await manager.verifyToken(`missing.${active.token}`)).ok).toBe(
      false,
    );
    expect((await manager.verifyToken(expired.token)).ok).toBe(false);
    expect(
      (await manager.verifyToken(`${active.metadata.id}.wrong-secret`)).ok,
    ).toBe(false);
  });

  test("reports missing revoke and rotate ids", async () => {
    const manager = createTokenManager({ configDir });
    await expect(manager.revokeToken("missing")).rejects.toBeInstanceOf(
      TokenNotFoundError,
    );
    await expect(manager.rotateToken("missing")).rejects.toBeInstanceOf(
      TokenNotFoundError,
    );
  });
});
