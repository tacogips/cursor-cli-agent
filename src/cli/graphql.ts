import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { preferredCompatOperationKind } from "../compat/commands";
import { createDefaultCompatCommandDispatcher } from "../compat/dispatcher";
import {
  executeGraphqlOperation,
  isGraphqlAsyncResult,
  type ExecutionResult,
} from "../graphql";

export interface GraphqlCliArgs {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
}

export interface GraphqlCliOptions {
  readonly workspace?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly configDir?: string | undefined;
  readonly cursorHome?: string | undefined;
}

function parseFlags(argv: readonly string[]): {
  readonly rest: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
} {
  const rest: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { rest, flags };
}

function isDocument(input: string): boolean {
  const trimmed = input.trimStart();
  return (
    trimmed.startsWith("query") ||
    trimmed.startsWith("mutation") ||
    trimmed.startsWith("subscription") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("#")
  );
}

function documentForShorthand(command: string): string | undefined {
  const kind = preferredCompatOperationKind(command);
  if (kind === undefined) {
    return undefined;
  }
  const operation = kind === "query" ? "query" : kind;
  return `${operation} ($param: JSON) { command(name: "${command}", params: $param) }`;
}

async function readJsonValue(value: string): Promise<unknown> {
  const path =
    value.startsWith("@") && value.length > 1
      ? resolve(value.slice(1))
      : existsSync(resolve(value))
        ? resolve(value)
        : undefined;
  const raw = path === undefined ? value : await readFile(path, "utf8");
  return JSON.parse(raw) as unknown;
}

function asVariables(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--variables must resolve to a JSON object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function printResult(result: ExecutionResult, pretty: boolean): void {
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}

export async function runGraphqlCli(
  args: readonly string[],
  options: GraphqlCliOptions = {},
): Promise<number> {
  const { rest, flags } = parseFlags(args);
  const input = rest[0];
  if (input === undefined || input.trim().length === 0) {
    console.error("graphql: missing document or command");
    return 2;
  }
  if (rest.length > 1) {
    console.error("graphql: unexpected positional arguments");
    return 2;
  }

  const paramFlag = flags["param"];
  const variablesFlag = flags["variables"];
  if (paramFlag !== undefined && typeof paramFlag !== "string") {
    console.error("graphql: --param requires JSON or @path");
    return 2;
  }
  if (variablesFlag !== undefined && typeof variablesFlag !== "string") {
    console.error("graphql: --variables requires JSON or @path");
    return 2;
  }

  let variables: Readonly<Record<string, unknown>> | undefined;
  try {
    if (variablesFlag !== undefined) {
      variables = asVariables(await readJsonValue(variablesFlag));
    }
    if (paramFlag !== undefined) {
      variables = {
        ...(variables ?? {}),
        param: await readJsonValue(paramFlag),
      };
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? `graphql: ${error.message}`
        : "graphql: failed to parse JSON",
    );
    return 2;
  }

  const document = isDocument(input) ? input : documentForShorthand(input);
  if (document === undefined) {
    console.error(`graphql: unknown shorthand command: ${input}`);
    return 2;
  }

  const dispatcher = createDefaultCompatCommandDispatcher({
    workspace: options.workspace,
    dataDir: options.dataDir,
    configDir: options.configDir,
    cursorHome: options.cursorHome,
    auth: { mode: "disabled" },
  });
  const result = await executeGraphqlOperation({
    document,
    ...(variables !== undefined ? { variables } : {}),
    context: {
      workspace: options.workspace,
      dataDir: options.dataDir,
      configDir: options.configDir,
      cursorHome: options.cursorHome,
      auth: { mode: "disabled" },
    },
    dispatcher,
  });

  if (isGraphqlAsyncResult(result)) {
    for await (const item of result) {
      console.log(JSON.stringify(item));
    }
    return 0;
  }
  printResult(result, flags["json"] === true);
  return result.errors === undefined || result.errors.length === 0 ? 0 : 1;
}
