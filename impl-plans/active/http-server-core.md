# HTTP Server Core Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-http-server-core.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-http-server-core.md`

### Summary

Implement `P4-HTTP-SERVER-CORE`: a local Bun REST server that exposes normalized Cursor health, version, session list/detail/messages, metadata search, and transcript search APIs, plus `curort-cli-agent server start`.

### Scope

**Included**: server runtime/config types, route dispatcher, error envelope, optional static bearer auth, health/version routes, session list/detail/messages routes, session and transcript search routes, CLI parser/start wiring, focused tests, and progress updates.

**Excluded**: daemon lifecycle, persistent token management, scoped permissions, SSE/watch routes, group/queue/bookmark/file/activity routes, GraphQL compatibility, app-server transport, SDK export stabilization, and runtime code in this design-plan branch.

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: server config/start pattern and CLI integration reference.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/design-docs/specs/design-codex-session-management.md`: session management concepts and server/control-plane boundaries.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/graphql/index.ts`: validation and domain-command dispatch reference only; this Cursor slice uses REST routes, not GraphQL.

Intentional divergence: REST routes expose `CursorSessionRecord`, `SessionSearchResult`, and `TranscriptSearchResult` from local Cursor adapters and persistence instead of Codex rollout/thread types.

## Modules

### 1. Server Types and Config

#### `src/server/types.ts`

**Status**: Not Started

```typescript
export interface HttpServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly configDir: string;
  readonly cursorHome: string;
  readonly token?: string;
  readonly packageVersion: string;
}

export interface HttpServerHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

export interface ServerStartResult {
  readonly status: "running";
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly auth: "none" | "bearer";
}
```

**Checklist**:

- [ ] Define runtime config, handle, result, and route response types.
- [ ] Add config resolver using existing `src/config/paths.ts` helpers.
- [ ] Reject non-loopback host without a token.
- [ ] Keep config tests independent of real Cursor state.

### 2. Error and Request Helpers

#### `src/server/http-errors.ts`
#### `src/server/request.ts`

**Status**: Not Started

```typescript
export type HttpErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId: string;
  };
}
```

**Checklist**:

- [ ] Add shared envelope renderer with HTTP status mapping.
- [ ] Add query parsers for positive integers, offsets, roles, and optional strings.
- [ ] Add static bearer-token verification when config includes a token.
- [ ] Ensure stack traces and raw filesystem details are not serialized.

### 3. Route Handlers

#### `src/server/routes.ts`

**Status**: Not Started

```typescript
export interface RouteContext {
  readonly config: HttpServerConfig;
  readonly startedAt: Date;
  readonly sessions: SessionIndexRepository;
}

export function createHttpRouteHandler(
  context: RouteContext,
): (request: Request) => Promise<Response>;
```

**Checklist**:

- [ ] Implement `GET /api/health` and `GET /api/version`.
- [ ] Implement `GET /api/sessions` with import refresh, filters, `limit`, and `offset`.
- [ ] Implement `GET /api/sessions/:id` resolving record ID, local session ID, or Cursor chat ID.
- [ ] Implement `GET /api/sessions/:id/messages` through transcript reader normalization.
- [ ] Implement `GET /api/search/sessions?q=...` through `SessionIndexRepository.searchSessions()`.
- [ ] Implement `GET /api/search/transcripts?q=...` through `createTranscriptSearchService()`.

### 4. Server Runtime

#### `src/server/server.ts`
#### `src/server/index.ts`

**Status**: Not Started

```typescript
export function startHttpServer(
  config: HttpServerConfig,
): Promise<HttpServerHandle>;
```

**Checklist**:

- [ ] Start Bun server with the route handler.
- [ ] Return resolved host, port, URL, and async `stop()`.
- [ ] Open and close `SessionIndexRepository` with server lifecycle.
- [ ] Export only stable server helpers from `src/server/index.ts`.

### 5. CLI Integration

#### `src/cli/cli.ts`

**Status**: Not Started

```typescript
export interface ServerStartArgs {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly json?: boolean;
}
```

**Checklist**:

- [ ] Replace the phase-1 `server` stub with `server start`.
- [ ] Parse `--host`, `--port`, `--token`, and `--json`.
- [ ] Validate port as an integer in the TCP port range, with `0` accepted.
- [ ] Render human and JSON startup output.
- [ ] Keep the process alive until SIGINT or SIGTERM and stop the server cleanly.

### 6. Tests and Verification

#### `src/server/*.test.ts`
#### `src/cli/cli.test.ts`

**Status**: Not Started

```typescript
describe("http server core", () => {
  // config, route, error, auth, and CLI parser/start tests
});
```

**Checklist**:

- [ ] Test config defaults and non-loopback token validation.
- [ ] Test health/version responses.
- [ ] Test session list/detail/messages against temporary local state.
- [ ] Test session and transcript search routes reuse existing result contracts.
- [ ] Test error envelope codes for validation, auth, not found, and methods.
- [ ] Test `server start` argument validation and startup rendering.

## Work Breakdown

### TASK-001: Server Types and Config

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/server/types.ts`, config tests
**Dependencies**: phase1-core-foundation:TASK-004

**Completion Criteria**:

- [ ] Strict TypeScript contracts compile.
- [ ] Defaults resolve through existing config helpers.
- [ ] Non-loopback unauthenticated startup is rejected.

### TASK-002: Error and Request Utilities

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/server/http-errors.ts`, `src/server/request.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Error envelope is stable across routes.
- [ ] Query parsing covers all route inputs.
- [ ] Bearer auth helper is tested.

### TASK-003: Route Handlers

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/server/routes.ts`, route tests
**Dependencies**: TASK-001, TASK-002, session-search:TASK-001, transcript-search:TASK-003

**Completion Criteria**:

- [ ] Health, version, session, and search routes return normalized JSON.
- [ ] Session routes use repository and adapter boundaries only.
- [ ] Missing Cursor state returns empty or not-found responses as designed.

### TASK-004: Server Runtime

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/server/server.ts`, `src/server/index.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [ ] Bun server starts on configured host/port.
- [ ] Resolved port is returned when port `0` is used.
- [ ] Repository lifecycle closes on stop.

### TASK-005: CLI `server start`

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [ ] `server start` replaces the current server stub.
- [ ] Startup output supports human and JSON modes.
- [ ] SIGINT/SIGTERM stop the server cleanly.

### TASK-006: Final Verification and Plan Progress

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `impl-plans/active/http-server-core.md`, progress metadata if workflow ownership permits
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes or blockers are documented.
- [ ] Progress log records implementation and verification results.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Server types/config | `src/server/types.ts` | Not Started | planned |
| Error/request helpers | `src/server/http-errors.ts`, `src/server/request.ts` | Not Started | planned |
| Route handlers | `src/server/routes.ts` | Not Started | planned |
| Server runtime | `src/server/server.ts`, `src/server/index.ts` | Not Started | planned |
| CLI integration | `src/cli/cli.ts` | Not Started | planned |
| Test coverage | `src/server/*.test.ts`, `src/cli/cli.test.ts` | Not Started | planned |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P4-HTTP-SERVER-CORE | `P1-CORE-FOUNDATION` / `impl-plans/active/phase1-core-foundation.md` | Available |
| P4-HTTP-SERVER-CORE | `P2-SESSION-SEARCH` / `impl-plans/active/session-search.md` | Completed |
| P4-HTTP-SERVER-CORE | `P2-TRANSCRIPT-SEARCH` / `impl-plans/active/transcript-search.md` | Completed |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts server start --host 127.0.0.1 --port 0 --json`
- Manual smoke: `curl http://127.0.0.1:<port>/api/health`
- Manual smoke: `curl http://127.0.0.1:<port>/api/search/sessions?q=<query>`

## Completion Criteria

- [ ] Server config and lifecycle are implemented.
- [ ] Health and version routes are deterministic.
- [ ] Session list/detail/messages routes expose normalized Cursor entities.
- [ ] Session metadata and transcript search routes reuse existing services.
- [ ] Error responses use the shared envelope.
- [ ] Optional bearer auth works when configured.
- [ ] `server start` works in foreground mode.
- [ ] Tests and CI pass or documented blockers exist.

## Progress Log

### Session: 2026-05-06 Step 3 Feature Design Plan

**Tasks Completed**: Created design document and implementation plan for `P4-HTTP-SERVER-CORE`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan is document-only. It maps Codex phase-4 server references to this repository's Cursor adapters, local `state.db`, metadata search, transcript search, and CLI boundaries. No runtime code was implemented in this branch.

## Related Plans

- **Depends On**: `impl-plans/active/phase1-core-foundation.md`
- **Depends On**: `impl-plans/active/session-search.md`
- **Depends On**: `impl-plans/active/transcript-search.md`
