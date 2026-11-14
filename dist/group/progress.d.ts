import type { SessionActivity } from "../types/activity";
import type { GroupProgressSnapshot, GroupRecord } from "../types/group";
export interface GroupProgressDependencies {
    readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
    readonly now: () => string;
}
export declare function deriveGroupProgressSnapshot(group: GroupRecord, deps: GroupProgressDependencies): Promise<GroupProgressSnapshot>;
//# sourceMappingURL=progress.d.ts.map