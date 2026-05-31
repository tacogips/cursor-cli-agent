import type { ApiTokenMetadata } from "../types/auth-token";
export type ServerAuthMode = "disabled" | "optional" | "required";
export interface ServerAuthContext {
    readonly mode: ServerAuthMode;
    readonly token?: ApiTokenMetadata;
}
export interface HttpServerConfig {
    readonly host: string;
    readonly port: number;
    readonly dataDir: string;
    readonly configDir: string;
    readonly cursorHome: string;
    readonly token?: string;
    readonly authMode: ServerAuthMode;
    readonly compatGraphql?: boolean;
    readonly packageVersion: string;
}
export interface HttpServerHandle {
    readonly host: string;
    readonly port: number;
    readonly url: string;
    stop(): Promise<void>;
}
export interface ServerStartResult {
    readonly status: "running";
    readonly host: string;
    readonly port: number;
    readonly url: string;
    readonly auth: "none" | "bearer";
}
export interface ResolveHttpServerConfigInput {
    readonly host?: string;
    readonly port?: number;
    readonly token?: string;
    readonly compatGraphql?: boolean;
}
export declare function isLoopbackHost(host: string): boolean;
export declare function resolveHttpServerConfig(input?: ResolveHttpServerConfigInput): HttpServerConfig;
//# sourceMappingURL=types.d.ts.map