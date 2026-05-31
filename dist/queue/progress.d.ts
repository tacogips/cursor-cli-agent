import type { SessionActivity } from "../types/activity";
import type { QueueProgressSnapshot, QueueRecord } from "../types/queue";
export interface QueueProgressDependencies {
    readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
    readonly now: () => string;
}
export declare function deriveQueueProgressSnapshot(queue: QueueRecord, deps: QueueProgressDependencies): Promise<QueueProgressSnapshot>;
//# sourceMappingURL=progress.d.ts.map