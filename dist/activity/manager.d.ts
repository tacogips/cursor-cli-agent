import { type ActivityStore } from "../persistence/activity-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { ActivitySignal, ActivityStatus, SessionActivity } from "../types/activity";
export interface ActivityListOptions {
    readonly status?: ActivityStatus;
    readonly limit?: number;
}
export interface ActivityManager {
    getSessionActivity(sessionId: string): Promise<SessionActivity | null>;
    listActivity(options?: ActivityListOptions): Promise<readonly SessionActivity[]>;
    recordSignal(sessionId: string, signal: ActivitySignal): Promise<void>;
}
export interface ActivityManagerOptions {
    readonly sessions: SessionIndexRepository;
    readonly store?: ActivityStore;
}
export declare function createActivityManager(options: ActivityManagerOptions): ActivityManager;
//# sourceMappingURL=manager.d.ts.map