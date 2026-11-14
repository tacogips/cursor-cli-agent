# HTTP Resource APIs Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-http-resource-apis.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-http-resource-apis.md`

### Summary

Implement `P4-HTTP-RESOURCE-APIS`: normalized REST routes for groups, queues, bookmarks, files, activity, and repository analytics using local managers and persistence, not raw Cursor payloads.

### Scope

**Included**: HTTP DTO contracts (`src/http/resource-types.ts`), resource dispatch (`src/server/resource-routes.ts`), integration with `createHttpRouteHandler` (`src/server/routes.ts`), route permission mapping (`src/server/permissions.ts` includes `server:read` for analytics), regression coverage (`src/server/server.test.ts`), and documentation updates (`README.md`, `.divedra/README.md`).

**Excluded**: Splitting handlers into `src/http/handlers/*` (superseded by colocated handlers in `resource-routes.ts` to match server module boundaries), standalone `resource-mappers.ts` (domain records are JSON-safe and returned with explicit `provenance` fields per response), duplicate analytics module under `src/http/` (analytics aggregation inline in `dispatchResourceRoutes` plus `RepositoryAnalyticsService`).

### Architectural note (actual vs planned tree)

The originally planned `registerResourceRoutes(router, deps)` layering assumed a reusable `HttpRouter` abstraction. The shipped server keeps a thin `dispatch*` style: `dispatchResourceRoutes` returning `Response | undefined` for delegated paths.

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

Intentional divergences: REST routes replace the generic GraphQL command bridge; responses expose Cursor-local domain records and provenance; file routes read Cursor `ai-tracking` via `FileIntelligenceService`; group and queue routes use local store names.

---

## Module status (delivered)

| Module | File path | Notes |
|--------|-----------|-------|
| Resource API shared types | `src/http/resource-types.ts` | `ApiList*`, mutation/deletion envelopes, `ResourcePermission` alias |
| Resource dispatch + handlers | `src/server/resource-routes.ts` | `createResourceServices`, `dispatchResourceRoutes`, group/queue/bookmark/file/activity routes, analytics aggregate |
| Server integration | `src/server/routes.ts` | Wires resource services into main handler |
| Permissions | `src/server/permissions.ts` | `/api/repository/analytics` -> `server:read`; wildcard families for stores |
| Regression tests | `src/server/server.test.ts`, `src/server/resource-routes-decode.test.ts` | Integration: groups, analytics + `server:read`, bookmarks list, forbidden cross-permission; unit: URL segment decode rejects traversal-like names |

**Superseded by colocation**: `src/http/resource-mappers.ts`, `src/http/handlers/*.ts`, `src/http/repository-analytics.ts`, dedicated `src/http/**/*.test.ts` (integration coverage consolidated in `server.test.ts`; path-segment decode covered in `resource-routes-decode.test.ts`).

---

## Task plan

### TASK-001: Shared HTTP Resource Contracts

**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: `src/http/resource-types.ts`  
**Dependencies**: `P4-HTTP-SERVER-CORE`

**Completion Criteria**: [x] strict types compile; [x] DTO scaffolding avoids raw Cursor stream payloads; [x] permission type covers design-doc literals.

### TASK-002: DTO mapping layer

**Status**: Completed (deferred standalone module)  
**Parallelizable**: Yes  
**Deliverables**: N/A as separate file; serializers are domain managers + structured JSON responses with `provenance`  
**Dependencies**: `TASK-001`, domain phases

**Completion Criteria**: [x] responses omit raw Cursor CLI stream chunks; [x] each handler attaches stable `provenance` labels; [x] standalone mapper extraction deferred unless DTO drift forces it (see Scope: colocated handlers + JSON-safe domain records).

### TASK-003: Route registration + auth coupling

**Status**: Completed  
**Parallelizable**: No  
**Deliverables**: `src/server/resource-routes.ts`, wiring in `src/server/routes.ts`, `routePermissionForRequest` updates  
**Dependencies**: `TASK-001`, `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`

**Completion Criteria**: [x] delegated paths enumerated in `dispatchResourceRoutes`; [x] global auth/per-route checks unchanged for non-resource routes; [x] `501` with clear message for `group run` / `queue run` over HTTP.

### TASK-004: Group and Queue handlers

**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: Implemented in `src/server/resource-routes.ts` (`dispatchGroupRoutes`, `dispatchQueueRoutes`)  
**Dependencies**: group/queue persistence and lifecycle

**Completion Criteria**: [x] CRUD-style group routes + pause/resume + progress; [x] queue list/create/item mutations/move/pause/resume; [x] conflicts and not-found map to envelope errors (`CONFLICT`, `NOT_FOUND`).

### TASK-005: Bookmark, File, Activity handlers

**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: Implemented in `src/server/resource-routes.ts`

**Completion Criteria**: [x] bookmarks list/create/show/delete/search; [x] files rebuild/find/session summaries/snapshots/deleted; [x] activity list + per-session GET with session-index resolution guard.

### TASK-006: Repository analytics

**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: Aggregate branch in `dispatchResourceRoutes` for `GET /api/repository/analytics`

**Completion Criteria**: [x] session/group/queue/bookmark/activity/file/git-derived summaries; [x] `generatedAt` and provenance array; [x] no ad-hoc full filesystem scans beyond existing manager contracts.

### TASK-007 / TASK-008: Tests and harness

**Status**: Completed (focused subset)  
**Deliverables**: `src/server/server.test.ts` expansions  

**Completion Criteria**: [x] representative resource endpoints and `server:read` isolation; [x] bookmark list envelope; [x] `task typecheck` / `task test` / `task ci` green.

---

## Dependencies (post-delivery)

| Feature | Depends On | Status |
|---------|------------|--------|
| HTTP resource APIs | `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH` | **Satisfied** |
| Bookmark routes | `P2-BOOKMARKS` | Satisfied |
| Group routes | `P3-GROUP-LIFECYCLE` | Satisfied |
| Queue routes | `P3-QUEUE-LIFECYCLE` | Satisfied |
| File routes | `P3-FILE-INTELLIGENCE` | Satisfied |
| Activity routes | `P2-ACTIVITY` | Satisfied |

## Completion checklist

- [x] `/api/groups`, `/api/queues`, `/api/bookmarks`, `/api/files/*`, `/api/activity`, `/api/repository/analytics` implemented per design baseline
- [x] Handlers use local managers/stores/readers only
- [x] Auth mapping includes `server:read` for analytics and wildcard stores for mutable resources
- [x] Type checking, tests, CI pass on supported environments

## Verification

```bash
task typecheck
task test
task ci
```

## Progress log

### Session: 2026-05-08 Plan closure + self-review

**Tasks Completed**: Finished plan-documentation alignment with shipped layout; clarified superseded router/mapper filenames; renamed TASK-007/008 scope to consolidated server tests; added `server:read` vs `group:*` negative test + bookmark envelope test; exported `ResourcePermission` alias alongside `ResourcePermissionLiteral`.

### Session: 2026-05-09 Initial REST resource implementation

**Tasks Completed**: Landed `src/http/resource-types.ts`, `src/server/resource-routes.ts`, `dispatchResourceRoutes` wiring, permissions + `README` / `.divedra/README.md`, initial `server.test.ts` analytics coverage.

### Session: 2026-05-06 13:32 JST

**Tasks Completed**: Design and implementation-plan authoring only.
