import type { EventStreamService } from "../event-streams";
export interface EventRouteDependencies {
    readonly streams: EventStreamService;
    readonly sessionExists?: (id: string) => Promise<boolean>;
    readonly groupExists?: (name: string) => Promise<boolean>;
    readonly queueExists?: (name: string) => Promise<boolean>;
}
export declare function isEventRoutePath(pathname: string): boolean;
export declare function handleEventRoute(request: Request, dependencies: EventRouteDependencies): Promise<Response | undefined>;
//# sourceMappingURL=events.d.ts.map