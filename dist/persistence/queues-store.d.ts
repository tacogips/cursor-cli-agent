import type { QueueItemMode, QueueItemRecord, QueueItemStatus, QueueLifecycleState, QueueRecord, QueueRunRecord } from "../types/queue";
import type { PromptAttachmentProvenance } from "../types/prompt-attachment";
export type { QueueRecord } from "../types/queue";
export interface AddQueueItemOptions {
    readonly path?: string;
    readonly attachments?: readonly PromptAttachmentProvenance[];
}
export interface QueueItemPatch {
    readonly prompt?: string;
    readonly status?: QueueItemStatus;
    readonly mode?: QueueItemMode;
}
export interface QueueStoreUpdate {
    readonly lifecycleState?: QueueLifecycleState;
    readonly stopRequestedAt?: string | undefined;
    readonly lastRun?: QueueRunRecord;
    readonly items?: readonly QueueItemRecord[];
}
export declare function listQueues(path?: string): Promise<readonly QueueRecord[]>;
export declare function getQueue(name: string, path?: string): Promise<QueueRecord | undefined>;
export declare function createQueue(name: string, workspace: string, path?: string): Promise<QueueRecord>;
export declare function addQueueItem(name: string, prompt: string, options?: string | AddQueueItemOptions): Promise<QueueRecord>;
export declare function removeQueueItem(name: string, itemId: string, path?: string): Promise<QueueRecord>;
export declare function deleteQueue(name: string, path?: string): Promise<QueueRecord | undefined>;
export declare function pauseQueue(name: string, path?: string): Promise<QueueRecord | undefined>;
export declare function resumeQueue(name: string, path?: string): Promise<QueueRecord | undefined>;
export declare function requestQueueStop(name: string, path?: string): Promise<QueueRecord | undefined>;
export declare function updateQueueItem(name: string, itemId: string, patch: QueueItemPatch, path?: string): Promise<QueueRecord | undefined>;
export declare function moveQueueItem(name: string, from: number, to: number, path?: string): Promise<QueueRecord | undefined>;
export declare function updateQueueRun(name: string, update: QueueStoreUpdate, path?: string): Promise<QueueRecord | undefined>;
//# sourceMappingURL=queues-store.d.ts.map