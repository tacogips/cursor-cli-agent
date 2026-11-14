import { usageEventsJsonPath } from "../config/paths";
import type { UsageEventRecord } from "../types/usage-event";
export interface UsageEventListOptions {
    readonly sessionId?: string;
    readonly workspacePath?: string;
    readonly workspaceSlug?: string;
    readonly since?: string;
    readonly until?: string;
}
export interface UsageEventStore {
    listEvents(options?: UsageEventListOptions): Promise<readonly UsageEventRecord[]>;
    upsertEvent(event: UsageEventRecord): Promise<void>;
    upsertEvents(events: readonly UsageEventRecord[]): Promise<void>;
}
export { usageEventsJsonPath };
export declare function createUsageEventStore(path?: string): UsageEventStore;
//# sourceMappingURL=usage-event-store.d.ts.map