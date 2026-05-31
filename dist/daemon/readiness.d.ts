import type { DaemonReadinessOptions, DaemonReadinessResult } from "../types/daemon";
export interface DaemonReadinessProbe {
    waitUntilReady(options: DaemonReadinessOptions): Promise<DaemonReadinessResult>;
}
export declare function createHttpDaemonReadinessProbe(): DaemonReadinessProbe;
//# sourceMappingURL=readiness.d.ts.map