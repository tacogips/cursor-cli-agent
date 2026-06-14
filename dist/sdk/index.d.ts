import type { CursorAgentSdk, CursorAgentSdkOptions } from "./types";
export type * from "./types";
export { ToolRegistry, ToolRegistryError, createToolRegistry, tool, } from "./tool-registry";
export { CursorAuthKeepAlive, type CursorAuthKeepAliveOptions, type CursorAuthKeepAliveStatus, } from "../cursor/auth-keepalive";
export { resolveCursorAuthEnv, type CursorAuthEnvInput, type CursorAuthEnvResult, } from "../cursor/auth-env";
export declare function createCursorAgentSdk(options?: CursorAgentSdkOptions): CursorAgentSdk;
//# sourceMappingURL=index.d.ts.map