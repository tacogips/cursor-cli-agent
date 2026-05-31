import type { SessionIndexRepository } from "../persistence/session-index";
import { type EventStreamService } from "./event-streams";
import { type ResourceServices } from "./resource-routes";
import type { HttpServerConfig } from "./types";
export interface RouteContext {
    readonly config: HttpServerConfig;
    readonly startedAt: Date;
    readonly sessions: SessionIndexRepository;
    readonly streams?: EventStreamService;
    readonly resources?: ResourceServices;
}
export declare function createHttpRouteHandler(context: RouteContext): (request: Request) => Promise<Response>;
//# sourceMappingURL=routes.d.ts.map