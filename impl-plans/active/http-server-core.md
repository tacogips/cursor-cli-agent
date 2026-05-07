# HTTP Server Core Implementation Plan

**Status**: In Progress
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

**Excluded**: daemon lifecycle, persistent token management, scoped permissions, SSE/watch routes, group/queue/bookmark/file/activity routes, GraphQL compatibility, app-server transport, and SDK export stabilization.

### Codex Reference Mapping

- `/g/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: server config/start pattern and CLI integration reference.
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`: session management concepts and server/control-plane boundaries.
- `/g/gits/tacogips/codex-agent/src/session/index.ts`: session service behavior reference for domain-level access patterns.
- `/g/gits/tacogips/codex-agent/src/session/sqlite.ts`: SQLite repository behavior reference for storage-backed lookup boundaries.
- `/g/gits/tacogips/codex-agent/src/types/session.ts`: session identity and response-shaping reference.
- `/g/gits/tacogips/codex-agent/src/graphql/index.ts`: validation and domain-command dispatch reference only; this Cursor slice uses REST routes, not GraphQL.

Intentional divergence: REST routes expose `CursorSessionRecord`, `SessionSearchResult`, and `TranscriptSearchResult` from local Cursor adapters and persistence instead of Codex rollout/thread types.

## Modules

### 1. Server Types and Config

#### `src/server/types.ts`

**Status**: Completed

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

- [x] Define runtime config, handle, result, and route response types.
- [x] Add config resolver using existing `src/config/paths.ts` helpers.
- [x] Reject non-loopback host without a token.
- [x] Keep config tests independent of real Cursor state.

### 2. Error and Request Helpers

#### `src/server/http-errors.ts`
#### `src/server/request.ts`

**Status**: Completed

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

- [x] Add shared envelope renderer with HTTP status mapping.
- [x] Add query parsers for positive integers, offsets, roles, and optional strings.
- [x] Add static bearer-token verification when config includes a token.
- [x] Ensure stack traces and raw filesystem details are not serialized.

### 3. Route Handlers

#### `src/server/routes.ts`

**Status**: Completed

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

- [x] Implement `GET /api/health` and `GET /api/version`.
- [x] Implement `GET /api/sessions` with import refresh, filters, `limit`, and `offset`.
- [x] Implement `GET /api/sessions/:id` resolving record ID, local session ID, or Cursor chat ID.
- [x] Implement `GET /api/sessions/:id/messages` through transcript reader normalization.
- [x] Implement `GET /api/search/sessions?q=...` through `SessionIndexRepository.searchSessions()`.
- [x] Implement `GET /api/search/transcripts?q=...` through `createTranscriptSearchService()`.

### 4. Server Runtime

#### `src/server/server.ts`
#### `src/server/index.ts`

**Status**: Completed

```typescript
export function startHttpServer(
  config: HttpServerConfig,
): Promise<HttpServerHandle>;
```

**Checklist**:

- [x] Start Bun server with the route handler.
- [x] Return resolved host, port, URL, and async `stop()`.
- [x] Open and close `SessionIndexRepository` with server lifecycle.
- [x] Export only stable server helpers from `src/server/index.ts`.

### 5. CLI Integration

#### `src/cli/cli.ts`

**Status**: Completed

```typescript
export interface ServerStartArgs {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly json?: boolean;
}
```

**Checklist**:

- [x] Replace the phase-1 `server` stub with `server start`.
- [x] Parse `--host`, `--port`, `--token`, and `--json`.
- [x] Validate port as an integer in the TCP port range, with `0` accepted.
- [x] Render human and JSON startup output.
- [x] Keep the process alive until SIGINT or SIGTERM and stop the server cleanly.

### 6. Tests and Verification

#### `src/server/*.test.ts`
#### `src/cli/cli.test.ts`

**Status**: In Progress

```typescript
describe("http server core", () => {
  // config, route, error, auth, and CLI parser/start tests
});
```

**Checklist**:

- [x] Test config defaults and non-loopback token validation.
- [x] Test health/version responses.
- [x] Test session list/detail/messages against temporary local state.
- [x] Test session and transcript search routes reuse existing result contracts.
- [x] Test error envelope codes for validation, auth, not found, and methods.
- [x] Test `server start` argument validation and startup rendering.

## Work Breakdown

### TASK-001: Server Types and Config

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/server/types.ts`, config tests
**Dependencies**: phase1-core-foundation:TASK-004

**Completion Criteria**:

- [x] Strict TypeScript contracts compile.
- [x] Defaults resolve through existing config helpers.
- [x] Non-loopback unauthenticated startup is rejected.

### TASK-002: Error and Request Utilities

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/server/http-errors.ts`, `src/server/request.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Error envelope is stable across routes.
- [x] Query parsing covers all route inputs.
- [x] Bearer auth helper is tested.

### TASK-003: Route Handlers

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/routes.ts`, route tests
**Dependencies**: TASK-001, TASK-002, session-search:TASK-001, transcript-search:TASK-003

**Completion Criteria**:

- [x] Health, version, session, and search routes return normalized JSON.
- [x] Session routes use repository and adapter boundaries only.
- [x] Missing Cursor state returns empty or not-found responses as designed.

### TASK-004: Server Runtime

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/server.ts`, `src/server/index.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [x] Bun server starts on configured host/port.
- [x] Resolved port is returned when port `0` is used.
- [x] Repository lifecycle closes on stop.

### TASK-005: CLI `server start`

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [x] `server start` replaces the current server stub.
- [x] Startup output supports human and JSON modes.
- [x] SIGINT/SIGTERM stop the server cleanly.

### TASK-006: Final Verification, Documentation, and Plan Progress

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `README.md`, `.divedra/README.md`, `.agents/skills/divedra-impl-workflow/SKILL.md`, `impl-plans/active/http-server-core.md`, progress metadata if workflow ownership permits
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes or blockers are documented.
- [ ] README and user-facing workflow skill docs are refreshed when implementation changes affect user-visible HTTP server behavior or workflow usage.
- [x] Progress log records implementation and verification results.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Server types/config | `src/server/types.ts` | Completed | `src/server/server.test.ts` |
| Error/request helpers | `src/server/http-errors.ts`, `src/server/request.ts` | Completed | `src/server/server.test.ts` |
| Route handlers | `src/server/routes.ts` | Completed | `src/server/server.test.ts` |
| Server runtime | `src/server/server.ts`, `src/server/index.ts` | Completed | CLI lifecycle mock coverage; socket smoke blocked in sandbox |
| CLI integration | `src/cli/cli.ts` | Completed | `src/cli/cli.test.ts` |
| Test coverage | `src/server/*.test.ts`, `src/cli/cli.test.ts` | Completed | `task test` |
| Documentation refresh | `README.md`, `.divedra/README.md`, `.agents/skills/divedra-impl-workflow/SKILL.md` | Not Started | planned |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P4-HTTP-SERVER | `P2-BOOKMARKS` | Ready |
| P4-HTTP-SERVER | `P3-GROUP-LIFECYCLE` | Ready |
| P4-HTTP-SERVER | `P3-QUEUE-LIFECYCLE` | Ready |
| P4-HTTP-SERVER | `P3-FILE-INTELLIGENCE` | Ready |
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
- Documentation check: `rg -n "server start|HTTP server|/api/health|divedra" README.md .divedra/README.md .agents/skills/divedra-impl-workflow/SKILL.md`

## Completion Criteria

- [x] Server config and lifecycle are implemented.
- [x] Health and version routes are deterministic.
- [x] Session list/detail/messages routes expose normalized Cursor entities.
- [x] Session metadata and transcript search routes reuse existing services.
- [x] Error responses use the shared envelope.
- [x] Optional bearer auth works when configured.
- [x] `server start` works in foreground mode.
- [ ] README and user-facing workflow skill docs reflect the implemented server behavior or explicitly need no change.
- [x] Tests and CI pass or documented blockers exist.

## Progress Log

### Session: 2026-05-06 Step 3 Feature Design Plan

**Tasks Completed**: Created design document and implementation plan for `P4-HTTP-SERVER-CORE`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan is document-only. It maps Codex phase-4 server references to this repository's Cursor adapters, local `state.db`, metadata search, transcript search, and CLI boundaries. No runtime code was implemented in this branch.

### Session: 2026-05-07 Step 4 Implementation Plan Alignment

**Tasks Completed**: Aligned this active plan to accepted Step 3 design review for `parity-global-design-plan-implement-loop#P4-HTTP-SERVER`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Updated Codex-agent reference paths to `/g/gits/tacogips/codex-agent`, removed stale document-only runtime exclusion, and recorded delegated backlog dependencies as ready for the later implementation step.

### Session: 2026-05-07 Step 5 Review Feedback Addressed

**Tasks Completed**: Addressed Step 5 mid finding by adding documentation refresh deliverables, module status, verification, and completion criteria to TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Design remains unchanged; the accepted design already covers the P4-HTTP-SERVER REST scope and Codex-reference divergence.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, and TASK-005. Implemented `src/server/types.ts`, `src/server/http-errors.ts`, `src/server/request.ts`, `src/server/routes.ts`, `src/server/server.ts`, `src/server/index.ts`, CLI `server start` wiring in `src/cli/cli.ts`, and focused coverage in `src/server/server.test.ts` and `src/cli/cli.test.ts`.
**Tasks In Progress**: TASK-006 documentation refresh remains for the workflow's post-implementation README and user-facing skill refresh step.
**Blockers**: Socket smoke checks are blocked in this sandbox: `timeout 3s bun run src/main.ts server start --host 127.0.0.1 --port 0 --json` fails with `Failed to listen at 127.0.0.1`, so the follow-up `curl` health/search smoke commands cannot be executed here.
**Notes**: Verification passed for `task typecheck`, `task test`, and `task ci`. Route tests isolate temporary data and Cursor home state.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review

**Tasks Completed**: Addressed Step 7 mid finding in `src/server/routes.ts` by converting malformed percent-encoded session IDs from `decodeURIComponent` failures into `INVALID_REQUEST` envelopes. Added regression coverage in `src/server/server.test.ts` for malformed `/api/sessions/:id` and `/api/sessions/:id/messages` paths.
**Tasks In Progress**: TASK-006 documentation refresh remains for the workflow's post-implementation README and user-facing skill refresh step.
**Blockers**: Socket smoke checks remain blocked in this sandbox: `timeout 3s bun run src/main.ts server start --host 127.0.0.1 --port 0 --json` still fails with `Failed to listen at 127.0.0.1`.
**Notes**: Re-ran `task typecheck`, `task test`, and `task ci` after the revision.

## Related Plans

- **Depends On**: `impl-plans/active/phase1-core-foundation.md`
- **Depends On**: `impl-plans/active/session-search.md`
- **Depends On**: `impl-plans/active/transcript-search.md`
