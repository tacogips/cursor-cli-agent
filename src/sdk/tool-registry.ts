import type {
  RegisteredTool,
  ToolConfig,
  ToolContext,
  ToolRegistrySdk,
  ToolSummary,
} from "../types/tool-registry";

export class ToolRegistryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_name" | "duplicate_tool" | "not_found",
  ) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

function normalizeToolName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new ToolRegistryError("tool name is required", "invalid_name");
  }
  return normalized;
}

export function tool<TInput, TOutput>(
  config: ToolConfig<TInput, TOutput>,
): RegisteredTool<TInput, TOutput> {
  const name = normalizeToolName(config.name);
  return {
    name,
    ...(config.description !== undefined
      ? { description: config.description }
      : {}),
    ...(config.inputSchema !== undefined
      ? { inputSchema: config.inputSchema }
      : {}),
    async run(input: TInput, context?: ToolContext): Promise<TOutput> {
      return await config.run(input, context);
    },
  };
}

export class ToolRegistry implements ToolRegistrySdk {
  private readonly tools = new Map<string, RegisteredTool<unknown, unknown>>();

  register<TInput, TOutput>(
    registeredTool: RegisteredTool<TInput, TOutput>,
  ): void {
    const name = normalizeToolName(registeredTool.name);
    if (this.tools.has(name)) {
      throw new ToolRegistryError(
        `tool already registered: ${name}`,
        "duplicate_tool",
      );
    }
    this.tools.set(name, {
      ...registeredTool,
      name,
    } as RegisteredTool<unknown, unknown>);
  }

  get(name: string): RegisteredTool<unknown, unknown> | null {
    const normalized = normalizeToolName(name);
    return this.tools.get(normalized) ?? null;
  }

  list(): readonly ToolSummary[] {
    return [...this.tools.values()]
      .map((registeredTool) => ({
        name: registeredTool.name,
        ...(registeredTool.description !== undefined
          ? { description: registeredTool.description }
          : {}),
        ...(registeredTool.inputSchema !== undefined
          ? { inputSchema: registeredTool.inputSchema }
          : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async run<TInput, TOutput>(
    name: string,
    input: TInput,
    context?: ToolContext,
  ): Promise<TOutput> {
    const registered = this.get(name);
    if (registered === null) {
      throw new ToolRegistryError(`tool not found: ${name}`, "not_found");
    }
    return (await registered.run(input, context)) as TOutput;
  }
}

export function createToolRegistry(
  tools: readonly RegisteredTool<unknown, unknown>[] = [],
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const registeredTool of tools) {
    registry.register(registeredTool);
  }
  return registry;
}
