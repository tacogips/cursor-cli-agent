import { hasAuthPermission, type AuthPermission } from "../auth";
import type {
  CompatCommandCapability,
  CompatPermissionIntent,
} from "./commands";

export interface CompatAuthContext {
  readonly mode: "disabled" | "optional" | "required";
  readonly tokenPermissions?: readonly AuthPermission[] | undefined;
}

export interface CompatPermissionDecision {
  readonly ok: boolean;
  readonly status?: 401 | 403 | undefined;
  readonly required?: AuthPermission | undefined;
  readonly reason?: string | undefined;
}

function permissionForIntent(
  intent: CompatPermissionIntent | undefined,
): AuthPermission | undefined {
  switch (intent) {
    case undefined:
    case "none":
      return undefined;
    case "server:read":
      return "server:read";
    case "session:read":
      return "session:read";
    case "session:create":
      return "session:create";
    case "session:cancel":
      return "session:cancel";
    case "group:read":
    case "group:write":
    case "group:run":
      return "group:*";
    case "queue:read":
    case "queue:write":
    case "queue:run":
      return "queue:*";
    case "bookmark:read":
    case "bookmark:write":
      return "bookmark:*";
    case "files:read":
    case "files:write":
      return "files:*";
  }
}

export function compatAuthPermissionForCapability(
  capability: CompatCommandCapability,
): AuthPermission | undefined {
  return permissionForIntent(capability.permission);
}

export function authorizeCompatCommand(
  capability: CompatCommandCapability,
  context: CompatAuthContext,
): CompatPermissionDecision {
  const required = compatAuthPermissionForCapability(capability);
  if (required === undefined || context.mode === "disabled") {
    return { ok: true };
  }
  if (context.tokenPermissions === undefined) {
    if (context.mode === "optional") {
      return { ok: true };
    }
    return {
      ok: false,
      status: 401,
      required,
      reason: "missing bearer token",
    };
  }
  if (!hasAuthPermission(context.tokenPermissions, required)) {
    return {
      ok: false,
      status: 403,
      required,
      reason: `missing permission: ${required}`,
    };
  }
  return { ok: true };
}
