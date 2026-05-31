import type { GroupLifecycleState, GroupRecord, GroupRunRecord } from "../types/group";
export type { GroupRecord } from "../types/group";
export interface GroupStoreUpdate {
    readonly lifecycleState?: GroupLifecycleState;
    readonly lastRun?: GroupRunRecord;
}
export declare function listGroups(path?: string): Promise<readonly GroupRecord[]>;
export declare function getGroup(name: string, path?: string): Promise<GroupRecord | undefined>;
export declare function createGroup(name: string, path?: string): Promise<GroupRecord>;
export declare function addWorkspaceToGroup(name: string, workspace: string, path?: string): Promise<GroupRecord>;
export declare function removeWorkspaceFromGroup(name: string, workspace: string, path?: string): Promise<GroupRecord>;
export declare function deleteGroup(name: string, path?: string): Promise<GroupRecord | undefined>;
export declare function pauseGroup(name: string, path?: string): Promise<GroupRecord | undefined>;
export declare function resumeGroup(name: string, path?: string): Promise<GroupRecord | undefined>;
export declare function updateGroupRun(name: string, update: GroupStoreUpdate, path?: string): Promise<GroupRecord | undefined>;
//# sourceMappingURL=groups-store.d.ts.map