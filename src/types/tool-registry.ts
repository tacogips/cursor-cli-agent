export interface ToolContext {
  readonly sessionId?: string;
  readonly workspace?: string;
}

export interface ToolConfig<TInput, TOutput> {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  run(input: TInput, context?: ToolContext): Promise<TOutput> | TOutput;
}

export interface ToolSummary {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface RegisteredTool<TInput, TOutput> extends ToolSummary {
  run(input: TInput, context?: ToolContext): Promise<TOutput>;
}

export interface ToolRegistrySdk {
  list(): readonly ToolSummary[];
  get(name: string): RegisteredTool<unknown, unknown> | null;
  run<TInput, TOutput>(
    name: string,
    input: TInput,
    context?: ToolContext,
  ): Promise<TOutput>;
}
