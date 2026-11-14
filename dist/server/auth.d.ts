import { type AuthPermission } from "../auth";
import type { HttpServerConfig, ServerAuthContext } from "./types";
export declare function authenticateRequest(request: Request, config: HttpServerConfig): Promise<ServerAuthContext>;
export declare function requireAuthPermission(context: ServerAuthContext, permission: AuthPermission): void;
//# sourceMappingURL=auth.d.ts.map