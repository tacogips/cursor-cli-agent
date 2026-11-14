import { type CompatCommandDispatcher, type CompatExecutionContext } from "../compat/dispatcher";
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
export type GraphqlOperationResult = ExecutionResult | AsyncIterable<ExecutionResult>;
export declare function getGraphqlSchema(): GraphQLSchema;
export declare function executeGraphqlOperation(request: GraphqlExecutionRequest): Promise<GraphqlOperationResult>;
export declare function isGraphqlAsyncResult(result: GraphqlOperationResult): result is AsyncIterable<ExecutionResult>;
//# sourceMappingURL=index.d.ts.map