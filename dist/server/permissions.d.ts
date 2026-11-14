import type { AuthPermission } from "../auth";
export interface RoutePermissionRequirement {
    readonly permission: AuthPermission;
}
export declare function routePermissionForRequest(request: Request): RoutePermissionRequirement | undefined;
//# sourceMappingURL=permissions.d.ts.map