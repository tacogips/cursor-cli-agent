import type { DaemonMetadata } from "../types/daemon";
export type DaemonMetadataReadResult = {
    readonly status: "missing";
} | {
    readonly status: "valid";
    readonly metadata: DaemonMetadata;
} | {
    readonly status: "malformed";
    readonly diagnostic: string;
};
export interface DaemonMetadataStore {
    read(): Promise<DaemonMetadataReadResult>;
    write(metadata: DaemonMetadata): Promise<void>;
    remove(): Promise<void>;
}
export interface FileDaemonMetadataStoreOptions {
    readonly path?: string;
}
export declare function createFileDaemonMetadataStore(options?: FileDaemonMetadataStoreOptions): DaemonMetadataStore;
//# sourceMappingURL=daemon-metadata-store.d.ts.map