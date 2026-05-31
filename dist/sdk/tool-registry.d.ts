import type { RegisteredTool, ToolConfig, ToolContext, ToolRegistrySdk, ToolSummary } from "../types/tool-registry";
export declare class ToolRegistryError extends Error {
    readonly code: "invalid_name" | "duplicate_tool" | "not_found";
    constructor(message: string, code: "invalid_name" | "duplicate_tool" | "not_found");
}
export declare function tool<TInput, TOutput>(config: ToolConfig<TInput, TOutput>): RegisteredTool<TInput, TOutput>;
export declare class ToolRegistry implements ToolRegistrySdk {
    private readonly tools;
    register<TInput, TOutput>(registeredTool: RegisteredTool<TInput, TOutput>): void;
    get(name: string): RegisteredTool<unknown, unknown> | null;
    list(): readonly ToolSummary[];
    run<TInput, TOutput>(name: string, input: TInput, context?: ToolContext): Promise<TOutput>;
}
export declare function createToolRegistry(tools?: readonly RegisteredTool<unknown, unknown>[]): ToolRegistry;
//# sourceMappingURL=tool-registry.d.ts.map