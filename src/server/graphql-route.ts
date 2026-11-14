import { createCursorAgentSdk } from "../sdk";
import type { AuthPermission } from "../auth";
import {
  createCompatCommandDispatcher,
  type CompatCommandDispatcher,
} from "../compat/dispatcher";
import {
  executeGraphqlOperation,
  isGraphqlAsyncResult,
  type ExecutionResult,
} from "../graphql";
import { authenticateRequest } from "./auth";
import type { EventStreamService } from "./event-streams";
import { errorResponse, jsonResponse, toHttpError } from "./http-errors";
import type { HttpServerConfig } from "./types";

export interface GraphqlRouteConfig {
  readonly enabled: boolean;
  readonly dispatcher: CompatCommandDispatcher;
}

export interface GraphqlRouteContext {
  readonly config: HttpServerConfig;
  readonly streams: EventStreamService;
}

function responseStatus(result: ExecutionResult): number {
  const first = result.errors?.[0];
  const status = first?.extensions?.["httpStatus"];
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : 200;
}

function createRouteAbortSignal(request: Request): {
  readonly signal: AbortSignal;
  readonly abort: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, abort };
}

function createGraphqlStreamResponse(
  results: AsyncIterable<ExecutionResult>,
  abort: () => void,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const result of results) {
            if (closed) {
              break;
            }
            controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n`));
          }
        } finally {
          closed = true;
          abort();
          try {
            controller.close();
          } catch {
            // The response body may already be cancelled by the client.
          }
        }
      },
      cancel() {
        closed = true;
        abort();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    },
  );
}

async function readGraphqlBody(request: Request): Promise<{
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}> {
  const body = (await request.json()) as unknown;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("GraphQL request body must be an object");
  }
  const record = body as Readonly<Record<string, unknown>>;
  const query = record["query"] ?? record["document"];
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("GraphQL request body requires query or document");
  }
  const variables = record["variables"];
  if (variables === undefined) {
    return { document: query };
  }
  if (
    variables === null ||
    typeof variables !== "object" ||
    Array.isArray(variables)
  ) {
    throw new Error("GraphQL variables must be an object");
  }
  return {
    document: query,
    variables: variables as Readonly<Record<string, unknown>>,
  };
}

function dispatcherFor(
  context: GraphqlRouteContext,
  tokenPermissions: readonly AuthPermission[] | undefined,
): CompatCommandDispatcher {
  return createCompatCommandDispatcher({
    sdk: createCursorAgentSdk({
      stateRoot: context.config.dataDir,
      cursorHome: context.config.cursorHome,
    }),
    streams: context.streams,
    auth: {
      mode: context.config.authMode,
      ...(tokenPermissions !== undefined ? { tokenPermissions } : {}),
    },
  });
}

export async function handleGraphqlRoute(
  request: Request,
  context: GraphqlRouteContext,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/graphql") {
    return undefined;
  }
  if (context.config.compatGraphql !== true) {
    return undefined;
  }
  if (request.method !== "POST") {
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

  const routeSignal = createRouteAbortSignal(request);
  try {
    const auth = await authenticateRequest(request, context.config);
    const body = await readGraphqlBody(request);
    const result = await executeGraphqlOperation({
      document: body.document,
      ...(body.variables !== undefined ? { variables: body.variables } : {}),
      context: {
        dataDir: context.config.dataDir,
        configDir: context.config.configDir,
        cursorHome: context.config.cursorHome,
        auth: {
          mode: auth.mode,
          ...(auth.token !== undefined
            ? { tokenPermissions: auth.token.permissions }
            : {}),
        },
        abortSignal: routeSignal.signal,
      },
      dispatcher: dispatcherFor(context, auth.token?.permissions),
    });
    if (isGraphqlAsyncResult(result)) {
      return createGraphqlStreamResponse(result, routeSignal.abort);
    }
    return jsonResponse(result, responseStatus(result));
  } catch (error) {
    routeSignal.abort();
    const httpError = toHttpError(error);
    if (httpError.code === "UNAUTHORIZED" || httpError.code === "FORBIDDEN") {
      return errorResponse(httpError);
    }
    return jsonResponse(
      {
        errors: [
          {
            message:
              error instanceof Error ? error.message : "GraphQL route failed",
            extensions: { code: "GRAPHQL_ROUTE_ERROR" },
          },
        ],
        data: null,
      },
      400,
    );
  }
}
