export type CompatOperationKind = "query" | "mutation" | "subscription";
export type CompatCommandStatus = "supported" | "degraded" | "unsupported";
export type CompatPermissionIntent = "none" | "server:read" | "session:read" | "session:create" | "session:cancel" | "group:read" | "group:write" | "group:run" | "queue:read" | "queue:write" | "queue:run" | "bookmark:read" | "bookmark:write" | "files:read" | "files:write";
export interface CompatLimitation {
    readonly code: string;
    readonly message: string;
    readonly cursorSpecific: boolean;
}
export interface CompatCommandCapability {
    readonly name: string;
    readonly kinds: readonly CompatOperationKind[];
    readonly status: CompatCommandStatus;
    readonly permission?: CompatPermissionIntent;
    readonly limitations: readonly CompatLimitation[];
}
export interface CompatCommandDecision {
    readonly ok: boolean;
    readonly capability?: CompatCommandCapability;
    readonly reason?: string;
}
export declare const COMPAT_COMMAND_CAPABILITIES: readonly CompatCommandCapability[];
export declare function getCompatCommandCapability(name: string): CompatCommandCapability | undefined;
export declare function decideCompatCommand(name: string, kind: CompatOperationKind): CompatCommandDecision;
export declare function preferredCompatOperationKind(name: string): CompatOperationKind | undefined;
//# sourceMappingURL=commands.d.ts.map