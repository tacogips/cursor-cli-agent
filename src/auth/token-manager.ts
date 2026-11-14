import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  DEFAULT_AUTH_PERMISSIONS,
  invalidAuthPermissions,
  normalizeAuthPermissions,
  type ApiTokenMetadata,
  type AuthPermission,
  type TokenRecord,
  type VerifyTokenResult,
} from "../types/auth-token";
import {
  createFileTokenStore,
  type TokenConfig,
  type TokenStore,
} from "../persistence/token-store";

export interface CreateTokenInput {
  readonly name: string;
  readonly permissions?: readonly string[];
  readonly expiresAt?: string;
}

export interface CreatedToken {
  readonly token: string;
  readonly metadata: ApiTokenMetadata;
}

export interface TokenManager {
  createToken(input: CreateTokenInput): Promise<CreatedToken>;
  listTokens(): Promise<readonly ApiTokenMetadata[]>;
  revokeToken(id: string): Promise<ApiTokenMetadata>;
  rotateToken(id: string): Promise<CreatedToken>;
  verifyToken(rawToken: string): Promise<VerifyTokenResult>;
}

export interface TokenManagerOptions {
  readonly configDir?: string;
  readonly store?: TokenStore;
}

export class TokenInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenInputError";
  }
}

export class TokenNotFoundError extends Error {
  constructor(id: string) {
    super(`token not found: ${id}`);
    this.name = "TokenNotFoundError";
  }
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function parseStoredToken(
  rawToken: string,
): { readonly id: string; readonly secret: string } | null {
  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const id = parts[0];
  const secret = parts[1];
  if (
    id === undefined ||
    secret === undefined ||
    id.length === 0 ||
    secret.length === 0
  ) {
    return null;
  }
  return { id, secret };
}

function toMetadata(record: TokenRecord): ApiTokenMetadata {
  return {
    id: record.id,
    name: record.name,
    permissions: [...record.permissions],
    createdAt: record.createdAt,
    ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
    ...(record.revokedAt !== undefined ? { revokedAt: record.revokedAt } : {}),
  };
}

function isExpired(expiresAt: string | undefined): boolean {
  if (expiresAt === undefined) {
    return false;
  }
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= Date.now();
}

function validatePermissions(
  permissions: readonly string[] | undefined,
): readonly AuthPermission[] {
  if (permissions === undefined) {
    return [...DEFAULT_AUTH_PERMISSIONS];
  }
  const invalid = invalidAuthPermissions(permissions);
  if (invalid.length > 0) {
    throw new TokenInputError(`invalid permissions: ${invalid.join(",")}`);
  }
  const normalized = normalizeAuthPermissions(permissions);
  if (normalized.length === 0) {
    throw new TokenInputError("at least one permission is required");
  }
  return normalized;
}

function validateExpiresAt(expiresAt: string | undefined): string | undefined {
  if (expiresAt === undefined) {
    return undefined;
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new TokenInputError("expiresAt must be a valid ISO 8601 timestamp");
  }
  return new Date(expiresAt).toISOString();
}

function createRawToken(id: string): {
  readonly token: string;
  readonly secret: string;
} {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${id}.${secret}`, secret };
}

function replaceToken(
  config: TokenConfig,
  replacement: TokenRecord,
): TokenConfig {
  return {
    tokens: config.tokens.map((token) =>
      token.id === replacement.id ? replacement : token,
    ),
  };
}

function activateRecord(record: TokenRecord): TokenRecord {
  return {
    id: record.id,
    name: record.name,
    permissions: record.permissions,
    createdAt: record.createdAt,
    ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
    tokenHash: record.tokenHash,
  };
}

export function createTokenManager(
  options: TokenManagerOptions = {},
): TokenManager {
  const store =
    options.store ??
    createFileTokenStore(
      options.configDir === undefined ? {} : { configDir: options.configDir },
    );
  return {
    async createToken(input: CreateTokenInput): Promise<CreatedToken> {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new TokenInputError("name is required");
      }
      const permissions = validatePermissions(input.permissions);
      const expiresAt = validateExpiresAt(input.expiresAt);
      const id = randomUUID();
      const raw = createRawToken(id);
      const createdAt = new Date().toISOString();
      const record: TokenRecord = {
        id,
        name,
        permissions,
        createdAt,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        tokenHash: hashSecret(raw.secret),
      };
      const config = await store.load();
      await store.save({ tokens: [...config.tokens, record] });
      return { token: raw.token, metadata: toMetadata(record) };
    },

    async listTokens(): Promise<readonly ApiTokenMetadata[]> {
      const config = await store.load();
      return config.tokens
        .map(toMetadata)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async revokeToken(id: string): Promise<ApiTokenMetadata> {
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === id);
      if (record === undefined) {
        throw new TokenNotFoundError(id);
      }
      if (record.revokedAt !== undefined) {
        return toMetadata(record);
      }
      const replacement: TokenRecord = {
        ...record,
        revokedAt: new Date().toISOString(),
      };
      await store.save(replaceToken(config, replacement));
      return toMetadata(replacement);
    },

    async rotateToken(id: string): Promise<CreatedToken> {
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === id);
      if (record === undefined) {
        throw new TokenNotFoundError(id);
      }
      const raw = createRawToken(id);
      const replacement: TokenRecord = {
        ...activateRecord(record),
        tokenHash: hashSecret(raw.secret),
      };
      await store.save(replaceToken(config, replacement));
      return { token: raw.token, metadata: toMetadata(replacement) };
    },

    async verifyToken(rawToken: string): Promise<VerifyTokenResult> {
      const parsed = parseStoredToken(rawToken);
      if (parsed === null) {
        return { ok: false };
      }
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === parsed.id);
      if (
        record === undefined ||
        record.revokedAt !== undefined ||
        isExpired(record.expiresAt)
      ) {
        return { ok: false };
      }
      const encoder = new TextEncoder();
      const submitted = encoder.encode(hashSecret(parsed.secret));
      const expected = encoder.encode(record.tokenHash);
      if (submitted.length !== expected.length) {
        return { ok: false };
      }
      if (!timingSafeEqual(submitted, expected)) {
        return { ok: false };
      }
      return { ok: true, metadata: toMetadata(record) };
    },
  };
}
