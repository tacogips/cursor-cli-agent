import { createCursorAgentSdk } from "../sdk";
import {
  createCompatCommandDispatcher,
  type CompatCommandDispatcher,
} from "../compat/dispatcher";
import { authenticateRequest } from "./auth";
import type { EventStreamService } from "./event-streams";
import { jsonResponse } from "./http-errors";
import type { HttpServerConfig } from "./types";

export interface AppServerCompatMetadata {
  readonly mode: "compat-local";
  readonly capabilities: readonly string[];
  readonly limitations: readonly string[];
}

export interface AppServerCompatRouteContext {
  readonly config: HttpServerConfig;
  readonly streams: EventStreamService;
}

export function createAppServerCompatMetadata(
  dispatcher: CompatCommandDispatcher,
): AppServerCompatMetadata {
  const limitationCodes = new Set<string>();
  for (const capability of dispatcher.capabilities) {
    for (const limitation of capability.limitations) {
      limitationCodes.add(limitation.code);
    }
  }
  return {
    mode: "compat-local",
    capabilities: dispatcher.capabilities.map((capability) => capability.name),
    limitations: [...limitationCodes].sort(),
  };
}

export async function handleAppServerCompatRoute(
  request: Request,
  context: AppServerCompatRouteContext,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/compat/app-server") {
    return undefined;
  }
  if (context.config.compatGraphql !== true) {
    return undefined;
  }
  if (request.method !== "GET") {
    return jsonResponse(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "method not allowed",
        },
      },
      405,
    );
  }

  const auth = await authenticateRequest(request, context.config);
  const dispatcher = createCompatCommandDispatcher({
    sdk: createCursorAgentSdk({
      stateRoot: context.config.dataDir,
      cursorHome: context.config.cursorHome,
    }),
    streams: context.streams,
    auth: {
      mode: auth.mode,
      ...(auth.token !== undefined
        ? { tokenPermissions: auth.token.permissions }
        : {}),
    },
  });
  return jsonResponse(createAppServerCompatMetadata(dispatcher));
}
