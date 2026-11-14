import { activitySignalsJsonPath } from "../config/paths";
import type { ActivitySignal } from "../types/activity";
export interface ActivityStore {
    getSignals(sessionId: string): Promise<readonly ActivitySignal[]>;
    appendSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
    pruneSignals(before: string): Promise<number>;
}
export { activitySignalsJsonPath };
export declare function createActivityStore(path?: string): ActivityStore;
//# sourceMappingURL=activity-store.d.ts.map