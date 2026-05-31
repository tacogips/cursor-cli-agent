import type { DaemonMetadata, DaemonStopOptions, DaemonStopResult } from "../types/daemon";
export interface DaemonProcessInspector {
    isAlive(pid: number): Promise<boolean>;
    matchesOwner(metadata: DaemonMetadata): Promise<boolean>;
    terminate(metadata: DaemonMetadata, options?: DaemonStopOptions): Promise<DaemonStopResult>;
}
declare function sleep(ms: number): Promise<void>;
declare function signalProcess(pid: number, signal: NodeJS.Signals | 0): boolean;
type SignalProcess = typeof signalProcess;
declare function readProcField(pid: number, field: "cmdline" | "environ"): Promise<string | undefined>;
type ReadProcField = typeof readProcField;
type Sleep = typeof sleep;
export interface NodeProcessInspectorDeps {
    readonly signalProcess?: SignalProcess;
    readonly readProcField?: ReadProcField;
    readonly sleep?: Sleep;
}
export declare function createNodeProcessInspector(deps?: NodeProcessInspectorDeps): DaemonProcessInspector;
export {};
//# sourceMappingURL=process.d.ts.map