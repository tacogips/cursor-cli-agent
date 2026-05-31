import type { DaemonMetadataStore } from "../persistence/daemon-metadata-store";
import type { DaemonStartOptions, DaemonStartResult, DaemonStatusOptions, DaemonStatusResult, DaemonStopOptions, DaemonStopResult } from "../types/daemon";
import { type DaemonProcessInspector } from "./process";
import { type DaemonReadinessProbe } from "./readiness";
export interface DaemonManager {
    start(options?: DaemonStartOptions): Promise<DaemonStartResult>;
    stop(options?: DaemonStopOptions): Promise<DaemonStopResult>;
    status(options?: DaemonStatusOptions): Promise<DaemonStatusResult>;
}
export interface DaemonManagerDeps {
    readonly store?: DaemonMetadataStore;
    readonly processInspector?: DaemonProcessInspector;
    readonly readinessProbe?: DaemonReadinessProbe;
    readonly spawnServer?: SpawnServer;
    readonly lifecycleLogPath?: string;
    readonly now?: () => Date;
}
export interface SpawnedDaemonServer {
    readonly pid: number;
    readonly commandPath: string;
    readonly host: string;
    readonly port: number;
    readonly baseUrl: string;
    terminate(): Promise<void>;
}
export type SpawnServer = (options: SpawnServerOptions) => Promise<SpawnedDaemonServer>;
export interface SpawnServerOptions {
    readonly host: string;
    readonly port: number;
    readonly token?: string;
    readonly marker: string;
    readonly cliEntrypoint?: string;
}
export declare function buildCliServerArgs(options: SpawnServerOptions): string[];
export declare function resolveCliServerEntrypoint(): string;
export declare function spawnCliServer(options: SpawnServerOptions): Promise<SpawnedDaemonServer>;
export declare function createDaemonManager(deps?: DaemonManagerDeps): DaemonManager;
//# sourceMappingURL=manager.d.ts.map