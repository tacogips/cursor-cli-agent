import { type AuthPermission } from "../auth";
import type { CompatCommandCapability } from "./commands";
export interface CompatAuthContext {
    readonly mode: "disabled" | "optional" | "required";
    readonly tokenPermissions?: readonly AuthPermission[] | undefined;
}
export interface CompatPermissionDecision {
    readonly ok: boolean;
    readonly status?: 401 | 403 | undefined;
    readonly required?: AuthPermission | undefined;
    readonly reason?: string | undefined;
}
export declare function compatAuthPermissionForCapability(capability: CompatCommandCapability): AuthPermission | undefined;
export declare function authorizeCompatCommand(capability: CompatCommandCapability, context: CompatAuthContext): CompatPermissionDecision;
//# sourceMappingURL=permissions.d.ts.map