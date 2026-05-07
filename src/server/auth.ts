import {
  createTokenManager,
  hasAuthPermission,
  type ApiTokenMetadata,
  type AuthPermission,
} from "../auth";
import { HttpError } from "./http-errors";
import type { HttpServerConfig, ServerAuthContext } from "./types";

function parseBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function contextFor(
  config: HttpServerConfig,
  token: ApiTokenMetadata | undefined,
): ServerAuthContext {
  return {
    mode: config.authMode,
    ...(token !== undefined ? { token } : {}),
  };
}

export async function authenticateRequest(
  request: Request,
  config: HttpServerConfig,
): Promise<ServerAuthContext> {
  if (config.authMode === "disabled") {
    return contextFor(config, undefined);
  }

  const bearer = parseBearerToken(request);
  if (bearer === undefined) {
    if (config.authMode === "optional") {
      return contextFor(config, undefined);
    }
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }

  const result = await createTokenManager({
    configDir: config.configDir,
  }).verifyToken(bearer);
  if (!result.ok || result.metadata === undefined) {
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
  return contextFor(config, result.metadata);
}

export function requireAuthPermission(
  context: ServerAuthContext,
  permission: AuthPermission,
): void {
  if (context.mode === "disabled") {
    return;
  }
  if (context.token === undefined) {
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
  if (!hasAuthPermission(context.token.permissions, permission)) {
    throw new HttpError("FORBIDDEN", `missing permission: ${permission}`);
  }
}
