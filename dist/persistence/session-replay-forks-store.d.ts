import type { ReplayForkProvenance } from "../types/session-replay-fork";
export interface ReplayForkStore {
    record(provenance: ReplayForkProvenance): Promise<void>;
    findByReplayForkId(id: string): Promise<ReplayForkProvenance | undefined>;
    listForSource(sourceRecordId: string): Promise<readonly ReplayForkProvenance[]>;
}
export declare function createReplayForkStore(path?: string): ReplayForkStore;
//# sourceMappingURL=session-replay-forks-store.d.ts.map