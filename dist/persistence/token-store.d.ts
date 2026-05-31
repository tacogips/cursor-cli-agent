import type { TokenRecord } from "../types/auth-token";
export interface TokenConfig {
    readonly tokens: readonly TokenRecord[];
}
export interface TokenStore {
    load(): Promise<TokenConfig>;
    save(config: TokenConfig): Promise<void>;
}
export interface FileTokenStoreOptions {
    readonly configDir?: string;
}
export declare function createFileTokenStore(options?: FileTokenStoreOptions): TokenStore;
//# sourceMappingURL=token-store.d.ts.map