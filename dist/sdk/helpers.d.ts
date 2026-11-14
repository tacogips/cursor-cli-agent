import { type ActivityManager } from "../activity/manager";
import { SessionIndexRepository } from "../persistence/session-index";
import { type UsageEventStore } from "../persistence/usage-event-store";
import type { ModelAvailabilityOptions, ModelAvailabilityReport } from "../types/model-availability";
import type { ToolVersionCommandRunner, ToolVersionOptions, ToolVersionReport } from "../types/tool-versions";
import type { UsageStatsOptions, UsageStatsReport } from "../types/usage-stats";
import type { ToolRegistrySdk } from "../types/tool-registry";
import { type ToolRegistry } from "./tool-registry";
export interface ToolHelperSdk {
    readonly registry: ToolRegistrySdk;
    versions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
    checkModel(options: ModelAvailabilityOptions): Promise<ModelAvailabilityReport>;
    usageStats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
}
export interface ToolHelperSdkOptions {
    readonly stateRoot?: string;
    readonly cursorHome?: string;
    readonly cursorBinary?: string;
    readonly now?: () => Date;
    readonly registry?: ToolRegistry;
    readonly sessionRepository?: SessionIndexRepository;
    readonly activityManager?: ActivityManager;
    readonly usageEventStore?: UsageEventStore;
    readonly commandRunner?: ToolVersionCommandRunner;
    readonly cursorApiKey?: string;
    readonly cursorAuthToken?: string;
    readonly cursorAgentEnv?: Readonly<Record<string, string | undefined>>;
}
export declare function createToolHelperSdk(options?: ToolHelperSdkOptions): ToolHelperSdk;
//# sourceMappingURL=helpers.d.ts.map