import { type CompatCommandDispatcher } from "../compat/dispatcher";
import type { EventStreamService } from "./event-streams";
import type { HttpServerConfig } from "./types";
export interface AppServerCompatMetadata {
    readonly mode: "compat-local";
    readonly capabilities: readonly string[];
    readonly limitations: readonly string[];
}
export interface AppServerCompatRouteContext {
    readonly config: HttpServerConfig;
    readonly streams: EventStreamService;
}
export declare function createAppServerCompatMetadata(dispatcher: CompatCommandDispatcher): AppServerCompatMetadata;
export declare function handleAppServerCompatRoute(request: Request, context: AppServerCompatRouteContext): Promise<Response | undefined>;
//# sourceMappingURL=app-server-compat.d.ts.map