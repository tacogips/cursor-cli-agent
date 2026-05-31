import { runHeadlessStreaming } from "../cursor/process-runner";
import { startHttpServer, type ServerStartResult } from "../server";
import { type DaemonManager } from "../daemon/manager";
import type { DaemonStartOptions, DaemonStartResult } from "../types/daemon";
type HeadlessStreamingRunner = typeof runHeadlessStreaming;
type HttpServerStarter = typeof startHttpServer;
export declare function setCliTestOverrides(overrides: {
    readonly runHeadlessStreaming?: HeadlessStreamingRunner;
    readonly startHttpServer?: HttpServerStarter;
    readonly daemonManager?: DaemonManager;
}): () => void;
export interface ServerStartArgs {
    readonly host?: string;
    readonly port?: number;
    readonly token?: string;
    readonly compatGraphql?: boolean;
    readonly json?: boolean;
}
interface DaemonStartArgs extends DaemonStartOptions {
    readonly json?: boolean;
}
export interface ToolCommandArgs {
    readonly json: boolean;
    readonly timeoutMs?: number;
    readonly includeGit?: boolean;
    readonly includeBun?: boolean;
}
export interface ModelCheckCommandArgs {
    readonly model: string;
    readonly probe: boolean;
    readonly json: boolean;
    readonly timeoutMs?: number;
}
export declare function parseServerStartArgs(argv: readonly string[]): {
    args: ServerStartArgs;
} | {
    error: string;
};
export declare function parseDaemonStartArgs(argv: readonly string[]): {
    args: DaemonStartArgs;
} | {
    error: string;
};
export declare function renderServerStartResult(result: ServerStartResult, json: boolean): void;
export declare function renderDaemonStartResult(result: DaemonStartResult, json: boolean): void;
export declare function runCli(argv: string[]): Promise<number>;
export {};
//# sourceMappingURL=cli.d.ts.map