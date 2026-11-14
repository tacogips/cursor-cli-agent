export const AUTH_PERMISSIONS = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*",
  "files:*",
  "server:read",
  "server:admin",
] as const;

export type AuthPermission = (typeof AUTH_PERMISSIONS)[number];

export const DEFAULT_AUTH_PERMISSIONS = [
  "session:read",
] as const satisfies readonly AuthPermission[];

const AUTH_PERMISSION_SET: ReadonlySet<string> = new Set(AUTH_PERMISSIONS);

export interface ApiTokenMetadata {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly AuthPermission[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface TokenRecord extends ApiTokenMetadata {
  readonly tokenHash: string;
}

export interface VerifyTokenResult {
  readonly ok: boolean;
  readonly metadata?: ApiTokenMetadata;
}

export function isAuthPermission(value: string): value is AuthPermission {
  return AUTH_PERMISSION_SET.has(value);
}

export function normalizeAuthPermissions(
  values: readonly string[],
): readonly AuthPermission[] {
  const unique = new Set<AuthPermission>();
  for (const value of values) {
    const trimmed = value.trim();
    if (isAuthPermission(trimmed)) {
      unique.add(trimmed);
    }
  }
  return [...unique];
}

export function parseAuthPermissionList(
  input: string,
): readonly AuthPermission[] {
  return normalizeAuthPermissions(input.split(","));
}

export function invalidAuthPermissions(input: readonly string[]): string[] {
  const invalid: string[] = [];
  for (const value of input) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || !isAuthPermission(trimmed)) {
      invalid.push(value);
    }
  }
  return invalid;
}

export function hasAuthPermission(
  granted: readonly AuthPermission[],
  required: AuthPermission,
): boolean {
  if (granted.includes(required)) {
    return true;
  }
  if (required.startsWith("group:") && granted.includes("group:*")) {
    return true;
  }
  if (required.startsWith("queue:") && granted.includes("queue:*")) {
    return true;
  }
  if (required.startsWith("bookmark:") && granted.includes("bookmark:*")) {
    return true;
  }
  if (required.startsWith("files:") && granted.includes("files:*")) {
    return true;
  }
  if (
    required === "server:read" &&
    (granted.includes("server:read") || granted.includes("server:admin"))
  ) {
    return true;
  }
  return false;
}
