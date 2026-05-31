import { type ApiTokenMetadata, type VerifyTokenResult } from "../types/auth-token";
import { type TokenStore } from "../persistence/token-store";
export interface CreateTokenInput {
    readonly name: string;
    readonly permissions?: readonly string[];
    readonly expiresAt?: string;
}
export interface CreatedToken {
    readonly token: string;
    readonly metadata: ApiTokenMetadata;
}
export interface TokenManager {
    createToken(input: CreateTokenInput): Promise<CreatedToken>;
    listTokens(): Promise<readonly ApiTokenMetadata[]>;
    revokeToken(id: string): Promise<ApiTokenMetadata>;
    rotateToken(id: string): Promise<CreatedToken>;
    verifyToken(rawToken: string): Promise<VerifyTokenResult>;
}
export interface TokenManagerOptions {
    readonly configDir?: string;
    readonly store?: TokenStore;
}
export declare class TokenInputError extends Error {
    constructor(message: string);
}
export declare class TokenNotFoundError extends Error {
    constructor(id: string);
}
export declare function createTokenManager(options?: TokenManagerOptions): TokenManager;
//# sourceMappingURL=token-manager.d.ts.map