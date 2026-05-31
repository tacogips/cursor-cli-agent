import type { ActivityManager } from "../activity/manager";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { UsageEventStore } from "../persistence/usage-event-store";
import type { UsageStatsOptions, UsageStatsReport } from "../types/usage-stats";
export interface UsageStatsManagerOptions {
    readonly sessions: SessionIndexRepository;
    readonly activity?: ActivityManager;
    readonly usageEvents?: UsageEventStore;
}
export declare function createUsageStatsManager(managerOptions: UsageStatsManagerOptions): {
    stats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
};
//# sourceMappingURL=manager.d.ts.map