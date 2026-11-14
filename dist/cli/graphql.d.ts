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
export declare function runGraphqlCli(args: readonly string[], options?: GraphqlCliOptions): Promise<number>;
//# sourceMappingURL=graphql.d.ts.map