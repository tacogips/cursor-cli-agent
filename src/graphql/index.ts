import {
  CompatCommandError,
  type CompatCommandDispatcher,
  type CompatExecutionContext,
} from "../compat/dispatcher";
import type { CompatOperationKind } from "../compat/commands";

export interface GraphQLErrorLike {
  readonly message: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ExecutionResult {
  readonly data?: Readonly<Record<string, unknown>> | null;
  readonly errors?: readonly GraphQLErrorLike[];
}

export interface GraphQLSchema {
  readonly description: string;
  readonly queryType: "Query";
  readonly mutationType: "Mutation";
  readonly subscriptionType: "Subscription";
}

export interface GraphqlExecutionRequest {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly context?: CompatExecutionContext | undefined;
  readonly dispatcher: CompatCommandDispatcher;
}

export type GraphqlOperationResult =
  | ExecutionResult
  | AsyncIterable<ExecutionResult>;

interface ParsedOperation {
  readonly kind: CompatOperationKind;
  readonly field: "ping" | "command";
  readonly commandName?: string;
  readonly params?: unknown;
}

const SCHEMA: GraphQLSchema = {
  description:
    "Compatibility GraphQL schema with JSON, ping, and command fields.",
  queryType: "Query",
  mutationType: "Mutation",
  subscriptionType: "Subscription",
};

function errorResult(error: GraphQLErrorLike): ExecutionResult {
  return { data: null, errors: [error] };
}

function operationKindFor(document: string): CompatOperationKind {
  const trimmed = document.trimStart();
  if (trimmed.startsWith("mutation")) {
    return "mutation";
  }
  if (trimmed.startsWith("subscription")) {
    return "subscription";
  }
  return "query";
}

function parseCommandName(document: string): string | undefined {
  return /command\s*\(\s*name\s*:\s*"([^"]+)"/.exec(document)?.[1];
}

function parseInlineJsonParams(document: string): unknown {
  const match = /params\s*:\s*(\{[\s\S]*\})\s*\)/.exec(document);
  if (match?.[1] === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

function parseOperation(
  document: string,
  variables: Readonly<Record<string, unknown>> | undefined,
): ParsedOperation {
  const trimmed = document.trim();
  if (trimmed.length === 0) {
    throw new Error("GraphQL document is empty");
  }
  const kind = operationKindFor(trimmed);
  if (/\bping\b/.test(trimmed)) {
    return { kind, field: "ping" };
  }
  if (!/\bcommand\s*\(/.test(trimmed)) {
    throw new Error("GraphQL document must select ping or command");
  }
  const commandName = parseCommandName(trimmed);
  if (commandName === undefined) {
    throw new Error("command field requires a string name argument");
  }
  const params = trimmed.includes("params: $param")
    ? variables?.["param"]
    : trimmed.includes("params:")
      ? parseInlineJsonParams(trimmed)
      : undefined;
  return { kind, field: "command", commandName, params };
}

function toGraphqlError(error: unknown): GraphQLErrorLike {
  if (error instanceof CompatCommandError) {
    return {
      message: error.message,
      extensions: {
        code: "COMPAT_COMMAND_ERROR",
        httpStatus: error.statusCode,
        ...error.details,
      },
    };
  }
  return {
    message:
      error instanceof Error ? error.message : "GraphQL execution failed",
    extensions: { code: "GRAPHQL_EXECUTION_ERROR" },
  };
}

async function* streamExecutionResults(
  values: AsyncIterable<unknown>,
): AsyncGenerator<ExecutionResult, void, void> {
  try {
    for await (const value of values) {
      yield { data: { command: value } };
    }
  } catch (error) {
    yield errorResult(toGraphqlError(error));
  }
}

export function getGraphqlSchema(): GraphQLSchema {
  return SCHEMA;
}

export async function executeGraphqlOperation(
  request: GraphqlExecutionRequest,
): Promise<GraphqlOperationResult> {
  let operation: ParsedOperation;
  try {
    operation = parseOperation(request.document, request.variables);
  } catch (error) {
    return errorResult({
      message: error instanceof Error ? error.message : "GraphQL parse failed",
      extensions: { code: "GRAPHQL_PARSE_ERROR" },
    });
  }

  if (operation.field === "ping") {
    return { data: { ping: true } };
  }
  if (operation.commandName === undefined) {
    return errorResult({
      message: "command field requires name",
      extensions: { code: "GRAPHQL_VALIDATION_ERROR" },
    });
  }

  try {
    const result = await request.dispatcher.execute({
      kind: operation.kind,
      name: operation.commandName,
      params: operation.params,
      context: request.context ?? {},
    });
    if (result.kind === "stream") {
      return streamExecutionResults(result.values);
    }
    return { data: { command: result.value } };
  } catch (error) {
    return errorResult(toGraphqlError(error));
  }
}

export function isGraphqlAsyncResult(
  result: GraphqlOperationResult,
): result is AsyncIterable<ExecutionResult> {
  return Symbol.asyncIterator in result;
}
