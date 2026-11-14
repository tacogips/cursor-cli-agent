import { type CompatCommandDispatcher } from "../compat/dispatcher";
import type { EventStreamService } from "./event-streams";
import type { HttpServerConfig } from "./types";
export interface GraphqlRouteConfig {
    readonly enabled: boolean;
    readonly dispatcher: CompatCommandDispatcher;
}
export interface GraphqlRouteContext {
    readonly config: HttpServerConfig;
    readonly streams: EventStreamService;
}
export declare function handleGraphqlRoute(request: Request, context: GraphqlRouteContext): Promise<Response | undefined>;
//# sourceMappingURL=graphql-route.d.ts.map