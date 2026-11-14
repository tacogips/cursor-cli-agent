import type { EventStreamService } from "../server/event-streams";
import { type CursorAgentSdk } from "../sdk";
import type { AuthPermission } from "../auth";
import { type CompatCommandCapability, type CompatOperationKind } from "./commands";
import { type CompatAuthContext } from "./permissions";
export interface CompatExecutionContext {
    readonly workspace?: string | undefined;
    readonly dataDir?: string | undefined;
    readonly configDir?: string | undefined;
    readonly cursorHome?: string | undefined;
    readonly requestId?: string | undefined;
    readonly auth?: CompatAuthContext | undefined;
    readonly abortSignal?: AbortSignal | undefined;
}
export interface CompatCommandRequest {
    readonly kind: CompatOperationKind;
    readonly name: string;
    readonly params?: unknown;
    readonly context: CompatExecutionContext;
}
export type CompatCommandResult = {
    readonly kind: "single";
    readonly value: unknown;
} | {
    readonly kind: "stream";
    readonly values: AsyncIterable<unknown>;
};
export interface CompatCommandDispatcher {
    readonly capabilities: readonly CompatCommandCapability[];
    execute(request: CompatCommandRequest): Promise<CompatCommandResult>;
}
export interface CompatDispatcherOptions {
    readonly sdk?: CursorAgentSdk;
    readonly streams?: EventStreamService;
    readonly auth?: CompatAuthContext;
}
export interface CompatErrorDetails {
    readonly command: string;
    readonly operationKind: CompatOperationKind;
    readonly status?: string;
    readonly reason: string;
    readonly cursorLimitation?: boolean;
    readonly provenance: "compat-bridge";
    readonly limitations?: readonly unknown[];
    readonly requiredPermission?: AuthPermission;
}
export declare class CompatCommandError extends Error {
    readonly details: CompatErrorDetails;
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 501;
    constructor(message: string, details: CompatErrorDetails, statusCode?: 400 | 401 | 403 | 404 | 409 | 501);
}
export declare function createCompatCommandDispatcher(options?: CompatDispatcherOptions): CompatCommandDispatcher;
export declare function createDefaultCompatCommandDispatcher(context?: CompatExecutionContext): CompatCommandDispatcher;
//# sourceMappingURL=dispatcher.d.ts.map