export declare const AUTH_PERMISSIONS: readonly ["session:create", "session:read", "session:cancel", "group:*", "queue:*", "bookmark:*", "files:*", "server:read", "server:admin"];
export type AuthPermission = (typeof AUTH_PERMISSIONS)[number];
export declare const DEFAULT_AUTH_PERMISSIONS: readonly ["session:read"];
export interface ApiTokenMetadata {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly AuthPermission[];
    readonly createdAt: string;
    readonly expiresAt?: string;
    readonly revokedAt?: string;
}
export interface TokenRecord extends ApiTokenMetadata {
    readonly tokenHash: string;
}
export interface VerifyTokenResult {
    readonly ok: boolean;
    readonly metadata?: ApiTokenMetadata;
}
export declare function isAuthPermission(value: string): value is AuthPermission;
export declare function normalizeAuthPermissions(values: readonly string[]): readonly AuthPermission[];
export declare function parseAuthPermissionList(input: string): readonly AuthPermission[];
export declare function invalidAuthPermissions(input: readonly string[]): string[];
export declare function hasAuthPermission(granted: readonly AuthPermission[], required: AuthPermission): boolean;
//# sourceMappingURL=auth-token.d.ts.map