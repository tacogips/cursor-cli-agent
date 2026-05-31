import type { ActivityManager } from "../activity/manager";
import { type BookmarkManager } from "../bookmarks/manager";
import { type FileIntelligenceService } from "../file-intelligence";
import { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import type { SessionIndexRepository } from "../persistence/session-index";
import { type RepositoryAnalyticsService } from "../repository-analytics";
import type { HttpServerConfig } from "./types";
export interface ResourceServices {
    readonly bookmarks: BookmarkManager;
    readonly activity: ActivityManager;
    readonly files: FileIntelligenceService;
    readonly fileIndex: FileIntelligenceIndex;
    readonly analytics: RepositoryAnalyticsService;
}
export interface ResourceRouteContext {
    readonly config: HttpServerConfig;
    readonly startedAt: Date;
    readonly sessions: SessionIndexRepository;
    readonly resources: ResourceServices;
}
export declare function createResourceServices(config: HttpServerConfig, sessions: SessionIndexRepository): ResourceServices;
/**
 * Decodes a single URL path segment (no unescaped "/"). Rejects dot segments and
 * NUL bytes so resource ids cannot alias traversal-like names after decoding.
 */
export declare function decodeResourceUrlSegment(raw: string): string;
export declare function isDelegatedResourcePath(pathname: string): boolean;
export declare function dispatchResourceRoutes(request: Request, ctx: ResourceRouteContext): Promise<Response | undefined>;
//# sourceMappingURL=resource-routes.d.ts.map