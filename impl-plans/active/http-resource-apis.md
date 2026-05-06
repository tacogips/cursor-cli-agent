# HTTP Resource APIs Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-http-resource-apis.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-http-resource-apis.md`

### Summary

Implement `P4-HTTP-RESOURCE-APIS`: normalized REST routes for groups, queues, bookmarks, files, activity, and repository analytics using local managers and persistence, not raw Cursor payloads.

### Scope

**Included**: HTTP DTO contracts, route registration, handlers, domain-to-DTO mappers, auth permission metadata, repository analytics, and mocked handler tests.

**Excluded**: runtime implementation in this planning branch, HTTP server core internals, token storage internals, GraphQL compatibility, SSE, daemon supervision, public SDK clients, and mutation of Cursor-owned files or databases.

### Dependencies

| Dependency ID | Required Before Implementation |
|---------------|--------------------------------|
| `P4-HTTP-SERVER-CORE` | Router, request/response abstractions, JSON body/query parsing, error helpers. |
| `P4-TOKEN-AUTH` | Optional bearer auth middleware and permission checks. |
| `P2-BOOKMARKS` | `BookmarkManager` and `BookmarkRecord` contracts. |
| `P3-GROUP-LIFECYCLE` | `GroupRecord`, lifecycle service/store, and progress snapshots. |
| `P3-QUEUE-LIFECYCLE` | Queue lifecycle service/store and item mutation contracts. |
| `P3-FILE-INTELLIGENCE` | File intelligence service, file index stats, and provenance-aware results. |
| `P2-ACTIVITY` | `ActivityManager` and `SessionActivity` contracts. |

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.ts`: command coverage for group, queue, bookmark, token, file, and version operations.
- `/Users/taco/gits/tacogips/codex-agent/src/group/index.ts`: group export boundary.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/index.ts`: queue export boundary and item operations.
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/index.ts`: bookmark export boundary.
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/index.ts`: file summary, path lookup, and rebuild export boundary.

Intentional divergences: REST routes replace the generic GraphQL command bridge; DTOs expose Cursor-local domain records and provenance; file routes use Cursor `ai-tracking`; group and queue routes use local names and Cursor workspace/session identity.

---

## Modules

### 1. Resource API Types

#### `src/http/resource-types.ts`

**Status**: NOT_STARTED

```typescript
export interface ApiListQuery {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ApiListResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ApiMutationResult<T> {
  readonly data: T;
}

export interface ApiDeletionResult<T> {
  readonly deleted: true;
  readonly data: T;
}

export type ResourcePermission =
  | "server:read"
  | "group:read"
  | "group:write"
  | "group:run"
  | "queue:read"
  | "queue:write"
  | "queue:run"
  | "bookmark:read"
  | "bookmark:write"
  | "files:read"
  | "files:write"
  | "session:read";
```

**Checklist**:

- [ ] Define shared response, request, and permission shapes.
- [ ] Keep DTOs free of raw Cursor payload fields.

### 2. Route Registration

#### `src/http/resource-routes.ts`

**Status**: NOT_STARTED

```typescript
export interface ResourceApiDependencies {
  readonly groups: GroupResourceService;
  readonly queues: QueueResourceService;
  readonly bookmarks: BookmarkManager;
  readonly files: FileIntelligenceService;
  readonly activity: ActivityManager;
  readonly analytics: RepositoryAnalyticsService;
  readonly requirePermission?: (permission: ResourcePermission) => HttpMiddleware;
}

export function registerResourceRoutes(
  router: HttpRouter,
  dependencies: ResourceApiDependencies,
): void;
```

**Checklist**:

- [ ] Register all `/api` routes from the design document.
- [ ] Attach optional permission middleware without coupling to token storage.
- [ ] Keep route ownership in `src/http/`.

### 3. Resource DTO Mappers

#### `src/http/resource-mappers.ts`

**Status**: NOT_STARTED

```typescript
export function toGroupDto(group: GroupRecord): GroupDto;
export function toQueueDto(queue: QueueRecord): QueueDto;
export function toBookmarkDto(bookmark: BookmarkRecord): BookmarkDto;
export function toActivityDto(activity: SessionActivity): ActivityDto;
export function toFileDto(result: FileIntelligenceResult): FileDto;
```

**Checklist**:

- [ ] Convert domain records to JSON-safe DTOs.
- [ ] Preserve ISO timestamps, identity fields, and provenance.
- [ ] Exclude raw Cursor transcript events, SQL rows, and stream chunks.

### 4. Group and Queue Handlers

#### `src/http/handlers/groups.ts`
#### `src/http/handlers/queues.ts`

**Status**: NOT_STARTED

```typescript
export interface GroupResourceService {
  list(query?: ApiListQuery): Promise<ApiListResponse<GroupRecord>>;
  create(input: CreateGroupRequest): Promise<GroupRecord>;
  show(name: string): Promise<GroupRecord | null>;
  update(name: string, input: UpdateGroupRequest): Promise<GroupRecord>;
  delete(name: string, options?: DeleteResourceOptions): Promise<GroupRecord>;
  pause(name: string): Promise<GroupRecord>;
  resume(name: string): Promise<GroupRecord>;
  run(name: string, input: RunGroupRequest): Promise<GroupRunRecord>;
  progress(name: string): Promise<GroupProgressSnapshot | null>;
}

export interface QueueResourceService {
  list(query?: ApiListQuery): Promise<ApiListResponse<QueueRecord>>;
  create(input: CreateQueueRequest): Promise<QueueRecord>;
  show(name: string): Promise<QueueRecord | null>;
  addItem(name: string, input: CreateQueueItemRequest): Promise<QueueRecord>;
  updateItem(name: string, itemId: string, input: UpdateQueueItemRequest): Promise<QueueRecord>;
  removeItem(name: string, itemId: string): Promise<QueueRecord>;
  moveItem(name: string, itemId: string, input: MoveQueueItemRequest): Promise<QueueRecord>;
  pause(name: string): Promise<QueueRecord>;
  resume(name: string): Promise<QueueRecord>;
  run(name: string, input: RunQueueRequest): Promise<QueueRunRecord>;
}
```

**Checklist**:

- [ ] Implement group list/create/show/update/delete/pause/resume/run/progress routes.
- [ ] Implement queue list/create/show/delete/item/pause/resume/run routes.
- [ ] Map not-found, invalid input, conflict, and run-state errors to HTTP errors.

### 5. Bookmark, File, and Activity Handlers

#### `src/http/handlers/bookmarks.ts`
#### `src/http/handlers/files.ts`
#### `src/http/handlers/activity.ts`

**Status**: NOT_STARTED

```typescript
export interface BookmarkRouteQuery {
  readonly sessionId?: string;
  readonly type?: BookmarkType;
  readonly tag?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface FileRouteQuery {
  readonly includeContent?: boolean;
  readonly path?: string;
}

export interface ActivityRouteQuery {
  readonly status?: ActivityStatus;
  readonly limit?: number;
}
```

**Checklist**:

- [ ] Implement bookmark list/create/show/delete/search routes through `BookmarkManager`.
- [ ] Implement file list/snapshots/deleted/find/rebuild routes through `FileIntelligenceService`.
- [ ] Implement activity list/show routes through `ActivityManager`.
- [ ] Preserve degraded file provenance in HTTP responses.

### 6. Repository Analytics

#### `src/http/repository-analytics.ts`

**Status**: NOT_STARTED

```typescript
export interface RepositoryAnalyticsService {
  summarize(): Promise<RepositoryAnalytics>;
}

export interface RepositoryAnalytics {
  readonly sessions: SessionAnalyticsSummary;
  readonly groups: ResourceCountSummary;
  readonly queues: ResourceCountSummary;
  readonly bookmarks: BookmarkAnalyticsSummary;
  readonly activity: ActivityAnalyticsSummary;
  readonly files?: FileIndexAnalyticsSummary;
  readonly updatedAt: string;
  readonly provenance: "repository-owned-state";
}
```

**Checklist**:

- [ ] Aggregate via session index, stores, managers, and file index stats.
- [ ] Count sessions, groups, queues, bookmarks, activity, and file-index freshness.
- [ ] Avoid raw Cursor filesystem or SQLite scans in HTTP handlers.

### 7. Tests

#### `src/http/resource-routes.test.ts`
#### `src/http/handlers/*.test.ts`
#### `src/http/repository-analytics.test.ts`

**Status**: NOT_STARTED

```typescript
export interface HttpResourceApiTestMatrix {
  readonly authEnabled: boolean;
  readonly degradedFileProvenance: boolean;
  readonly missingResource: boolean;
}
```

**Checklist**:

- [ ] Cover route registration and permission metadata.
- [ ] Cover success and representative error responses for each group.
- [ ] Cover no raw Cursor payload leakage in representative DTOs.
- [ ] Cover repository analytics with mocked repositories/managers.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Resource API types | `src/http/resource-types.ts` | NOT_STARTED | planned |
| Route registration | `src/http/resource-routes.ts` | NOT_STARTED | planned |
| DTO mappers | `src/http/resource-mappers.ts` | NOT_STARTED | planned |
| Group handlers | `src/http/handlers/groups.ts` | NOT_STARTED | planned |
| Queue handlers | `src/http/handlers/queues.ts` | NOT_STARTED | planned |
| Bookmark handlers | `src/http/handlers/bookmarks.ts` | NOT_STARTED | planned |
| File handlers | `src/http/handlers/files.ts` | NOT_STARTED | planned |
| Activity handlers | `src/http/handlers/activity.ts` | NOT_STARTED | planned |
| Repository analytics | `src/http/repository-analytics.ts` | NOT_STARTED | planned |
| Tests | `src/http/**/*.test.ts` | NOT_STARTED | planned |

## Task Plan

### TASK-001: Shared HTTP Resource Contracts

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/resource-types.ts`, export wiring
**Dependencies**: `P4-HTTP-SERVER-CORE`

**Completion Criteria**: [ ] strict types compile; [ ] DTOs avoid raw Cursor payload fields; [ ] permission constants cover every route group.

### TASK-002: DTO Mappers

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/resource-mappers.ts`
**Dependencies**: `TASK-001`, `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE`, `P2-ACTIVITY`

**Completion Criteria**: [ ] group, queue, bookmark, file, and activity mappers are tested; [ ] optional fields are omitted consistently; [ ] raw Cursor event and SQL row objects cannot pass through.

### TASK-003: Route Registration and Auth Metadata

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/http/resource-routes.ts`
**Dependencies**: `TASK-001`, `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`

**Completion Criteria**: [ ] every design route is registered once; [ ] auth can be enabled or omitted by dependency injection; [ ] handler modules remain independently testable.

### TASK-004: Group and Queue Route Handlers

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/handlers/groups.ts`, `src/http/handlers/queues.ts`
**Dependencies**: `TASK-001`, `TASK-002`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`

**Completion Criteria**: [ ] group list/create/show/update/delete/pause/resume/run/progress routes are handled; [ ] queue list/create/show/delete/item/pause/resume/run routes are handled; [ ] conflicts map to stable HTTP errors.

### TASK-005: Bookmark, File, and Activity Handlers

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/handlers/bookmarks.ts`, `src/http/handlers/files.ts`, `src/http/handlers/activity.ts`
**Dependencies**: `TASK-001`, `TASK-002`, `P2-BOOKMARKS`, `P3-FILE-INTELLIGENCE`, `P2-ACTIVITY`

**Completion Criteria**: [ ] bookmark routes call `BookmarkManager`; [ ] file routes preserve degraded provenance from `FileIntelligenceService`; [ ] activity routes resolve sessions through `ActivityManager`.

### TASK-006: Repository Analytics Service

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/repository-analytics.ts`
**Dependencies**: `TASK-001`, `P2-ACTIVITY`, `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE`

**Completion Criteria**: [ ] session, group, queue, bookmark, activity, and file-index summaries are included; [ ] aggregation uses managers/repositories; [ ] response includes `updatedAt` and provenance.

### TASK-007: HTTP Handler Tests

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/http/**/*.test.ts`
**Dependencies**: `TASK-003`, `TASK-004`, `TASK-005`, `TASK-006`

**Completion Criteria**: [ ] success and representative error cases are covered for each route group; [ ] auth permission behavior is covered; [ ] no raw Cursor payload leakage is asserted.

### TASK-008: Server Smoke Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/http/resource-routes.test.ts`, implementation notes
**Dependencies**: `TASK-003`, `TASK-004`, `TASK-005`, `TASK-006`, `TASK-007`, `P4-HTTP-SERVER-CORE`

**Completion Criteria**: [ ] `GET /api/health` and representative routes succeed in a test harness; [ ] JSON body/query parsing is verified; [ ] `task typecheck`, `task test`, and `task ci` pass.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| HTTP resource route registration | `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH` | BLOCKED until dependencies complete |
| Bookmark routes | `P2-BOOKMARKS` | READY if local bookmark plan remains completed |
| Group routes | `P3-GROUP-LIFECYCLE` | READY if lifecycle contracts remain available |
| Queue routes | `P3-QUEUE-LIFECYCLE` | BLOCKED until queue lifecycle contracts are added |
| File routes | `P3-FILE-INTELLIGENCE` | BLOCKED until file service is implemented |
| Activity routes | `P2-ACTIVITY` | READY if activity manager remains available |

## Completion Criteria

[ ] `/api` route tables are implemented; [ ] handlers use local managers/repositories only; [ ] auth metadata covers protected routes; [ ] analytics avoids raw Cursor scans; [ ] type checking, tests, and `task ci` pass.

## Verification

Implementation verification commands:

```bash
task typecheck
task test
task ci
bun run src/main.ts server start --host 127.0.0.1 --port 0
```

## Progress Log

### Session: 2026-05-06 13:32 JST

**Tasks Completed**: Design and implementation-plan authoring only.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation depends on `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`, `P3-QUEUE-LIFECYCLE`, and `P3-FILE-INTELLIGENCE`.
**Notes**: Created only `design-docs/specs/design-http-resource-apis.md` and `impl-plans/active/http-resource-apis.md`. No runtime code was changed.
