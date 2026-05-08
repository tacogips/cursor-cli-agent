# Token and Bearer Auth Implementation Plan

**Status**: Completed
**Created**: 2026-05-06
**Last Updated**: 2026-05-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-token-auth.md`

### Summary

Implement backlog slice `P4-AUTH`: local token create/list/revoke/rotate
commands, repository-owned token persistence, bearer-token verification, and
route-level permission enforcement for the Phase 4 HTTP server.

### Scope

**Included**: auth token types, token config store, token manager, CLI token
commands, bearer verification, request auth context, route permission mapping,
and focused lifecycle/server authorization tests.

**Excluded**: daemon lifecycle, public SDK exports, GraphQL compatibility,
remote token-management routes, and any write to Cursor-owned paths such as
`~/.cursor/projects`, `~/.cursor/ai-tracking`, or `~/.cursor/skills-cursor`.

### Codex Reference Mapping

Primary accepted design references:

- `design-docs/specs/design-token-auth.md`
- `design-docs/specs/command.md#token-commands`
- `design-docs/specs/design-codex-agent-parity-gap.md#phase-4-server-auth-daemon-and-public-sdk`
- `design-docs/specs/design-http-server-core.md`

Usable Codex auth references from design review:

- `/g/gits/tacogips/codex-agent/src/auth/types.ts`
- `/g/gits/tacogips/codex-agent/src/auth/token-manager.ts`
- `/g/gits/tacogips/codex-agent/src/auth/token-manager.test.ts`
- `/g/gits/tacogips/codex-agent/src/cli/index.ts`
- `/g/gits/tacogips/codex-agent/src/server/auth.ts`

Delegated input references that were unavailable in this checkout:

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/index.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/session/sqlite.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/types/session.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/design-docs/specs/design-codex-session-management.md`

Intentional divergences:

- Use `getConfigDir()` with `CURORT_CLI_AGENT_CONFIG_DIR` and legacy
  `CURSOR_CLI_AGENT_CONFIG_DIR`, not the Codex config path.
- Include `files:*` and `server:admin` permissions from this repository's
  Phase 4 route model.
- Enforce permissions against normalized server route metadata, not raw Cursor
  CLI payload shapes.
- Keep GraphQL token commands out of this backlog slice.

---

## Modules

### 1. Auth Types and Permission Helpers

#### `src/types/auth-token.ts`
#### `src/auth/index.ts`

**Status**: COMPLETE

```typescript
export type AuthPermission =
  | "session:create"
  | "session:read"
  | "session:cancel"
  | "group:*"
  | "queue:*"
  | "bookmark:*"
  | "files:*"
  | "server:read"
  | "server:admin";

export interface ApiTokenMetadata {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly AuthPermission[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface TokenRecord extends ApiTokenMetadata {
  readonly tokenHash: string;
}

export interface VerifyTokenResult {
  readonly ok: boolean;
  readonly metadata?: ApiTokenMetadata;
}
```

**Checklist**:

- [x] Define permission literals, default permission, and normalization helpers.
- [x] Support wildcard family permission checks.
- [x] Export public auth API through `src/auth/index.ts`.

### 2. Token Store

#### `src/persistence/token-store.ts`

**Status**: COMPLETE

```typescript
export interface TokenConfig {
  readonly tokens: readonly TokenRecord[];
}

export interface TokenStore {
  load(): Promise<TokenConfig>;
  save(config: TokenConfig): Promise<void>;
}
```

**Checklist**:

- [x] Resolve default storage to `tokens.json` under `getConfigDir()`.
- [x] Return empty config for a missing file.
- [x] Atomically rewrite the token file via temporary file and rename.
- [x] Keep raw token secrets out of persisted JSON.

### 3. Token Manager

#### `src/auth/token-manager.ts`

**Status**: COMPLETE

```typescript
export interface CreateTokenInput {
  readonly name: string;
  readonly permissions?: readonly string[];
  readonly expiresAt?: string;
}

export interface CreatedToken {
  readonly token: string;
  readonly metadata: ApiTokenMetadata;
}
```

**Checklist**:

- [x] Create high-entropy token id and secret components.
- [x] Store only secret hashes and compare with constant-time comparison.
- [x] Default permissions to `session:read`.
- [x] List metadata newest first without hashes or raw secrets.
- [x] Revoke idempotently, rotate by replacing the hash and clearing `revokedAt`.
- [x] Reject malformed, unknown, mismatched, revoked, and expired tokens.

### 4. CLI Token Commands

#### `src/cli/cli.ts`

**Status**: COMPLETE

```typescript
type TokenCommand = "create" | "list" | "revoke" | "rotate";
```

**Checklist**:

- [x] Add `token` commands to top-level usage and dispatcher.
- [x] Implement `token create --name <name> [--permissions <csv>] [--expires-at <iso8601>] [--json]`.
- [x] Implement `token list [--json]`.
- [x] Implement `token revoke <id> [--json]`.
- [x] Implement `token rotate <id> [--json]`.
- [x] Preserve stable human/JSON output and non-zero failures.

### 5. Server Auth Integration

#### `src/server/auth.ts`
#### `src/server/types.ts`
#### `src/server/request.ts`

**Status**: COMPLETE

```typescript
export type ServerAuthMode = "disabled" | "optional" | "required";

export interface ServerAuthContext {
  readonly mode: ServerAuthMode;
  readonly token?: ApiTokenMetadata;
}
```

**Checklist**:

- [x] Replace static token equality with token-manager verification.
- [x] Map loopback/no-token startup to disabled auth and non-loopback/token
      startup to required auth.
- [x] Parse `Authorization: Bearer <token>`.
- [x] Preserve `401 Unauthorized` response envelope for missing/invalid bearer credentials.
- [x] Attach verified metadata to request auth context.

### 6. Route Permission Enforcement

#### `src/server/permissions.ts`
#### `src/server/routes.ts`
#### `src/server/http-errors.ts`

**Status**: COMPLETE

```typescript
export interface RoutePermissionRequirement {
  readonly permission: AuthPermission;
}
```

**Checklist**:

- [x] Declare one required permission before protected handlers call managers or stores.
- [x] Map session read/create/cancel routes to session permissions.
- [x] Map group, queue, bookmark, and file routes to wildcard families.
- [x] Reserve admin routes for `server:admin`.
- [x] Add `FORBIDDEN`/`403` response support where missing.
- [x] Return `403 Forbidden` when a verified token lacks the required permission.

---

## Work Breakdown

### TASK-001: Auth Types and Permission Helpers

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/auth-token.ts`, `src/auth/index.ts`, auth helper tests
**Dependencies**: None

**Completion Criteria**:

- [x] Permission constants and normalization compile under strict TypeScript.
- [x] Default permission is `session:read`.
- [x] Wildcard permission checks are unit tested.

### TASK-002: Token Store

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/persistence/token-store.ts`, `src/persistence/token-store.test.ts`
**Dependencies**: TASK-001 types only

**Completion Criteria**:

- [x] Store uses `getConfigDir()` and supports injected config dirs in tests.
- [x] Missing file returns an empty token config.
- [x] Save operation writes valid JSON atomically.

### TASK-003: Token Manager

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/auth/token-manager.ts`, `src/auth/token-manager.test.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Create/list/revoke/rotate/verify match `design-token-auth.md`.
- [x] Raw token secret appears only in create and rotate results.
- [x] Revoked, expired, malformed, and old rotated tokens fail verification.

### TASK-004: CLI Token Commands

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-003

**Completion Criteria**:

- [x] All token subcommands work in human and JSON modes.
- [x] Token list never emits `tokenHash` or raw secrets.
- [x] Usage, invalid permission, invalid expiry, and not-found paths are tested.

### TASK-005: Server Auth Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/auth.ts`, `src/server/types.ts`, `src/server/request.ts`, `src/server/server.test.ts`
**Dependencies**: TASK-003, existing `P4-HTTP-SERVER` files

**Completion Criteria**:

- [x] Static bearer-token check is replaced or adapted to repository token verification.
- [x] Missing/invalid required credentials return `401 Unauthorized`.
- [x] Loopback disabled-auth behavior remains available.
- [x] Non-loopback hosts still cannot run without required auth.

### TASK-006: Route Permission Enforcement

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/permissions.ts`, `src/server/routes.ts`, `src/server/http-errors.ts`, server auth/route tests
**Dependencies**: TASK-005

**Completion Criteria**:

- [x] Protected routes declare required permissions before handler execution.
- [x] `src/server/http-errors.ts` supports `FORBIDDEN`/`403` consistently.
- [x] Valid token with insufficient permission returns `403 Forbidden`.
- [x] Permission checks use normalized route metadata only.

### TASK-007: End-to-End Verification and Docs Refresh

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `.agents/skills/divedra-impl-workflow/SKILL.md`, `.divedra/README.md`, final verification results
**Dependencies**: TASK-004, TASK-005, TASK-006

**Completion Criteria**:

- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task build` passes.
- [x] README and user-facing workflow guidance are refreshed for P4-AUTH behavior.
- [x] `.divedra/README.md` is checked and updated when workflow invocation guidance changes.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Auth types/helpers | `src/types/auth-token.ts`, `src/auth/index.ts` | COMPLETE | `src/auth/token-manager.test.ts` |
| Token store | `src/persistence/token-store.ts` | COMPLETE | `src/persistence/token-store.test.ts` |
| Token manager | `src/auth/token-manager.ts` | COMPLETE | `src/auth/token-manager.test.ts` |
| CLI token commands | `src/cli/cli.ts` | COMPLETE | `src/cli/cli.test.ts` |
| Server auth | `src/server/auth.ts`, `src/server/request.ts`, `src/server/types.ts` | COMPLETE | `src/server/server.test.ts` |
| Route permissions | `src/server/permissions.ts`, `src/server/routes.ts`, `src/server/http-errors.ts` | COMPLETE | `src/server/server.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Token CLI and storage | Auth types and token store | COMPLETE |
| Server bearer verification | Existing `P4-HTTP-SERVER` request/route contracts | COMPLETE |
| Route permission enforcement | Server bearer verification | COMPLETE |

## Parallelization

- TASK-001 and TASK-002 may proceed together if TASK-002 only imports stable
  token record types after TASK-001 starts.
- TASK-003 through TASK-007 are sequential because they share CLI/server auth
  surfaces and build directly on the token manager.

## Verification

- `task typecheck`
- `task test`
- `task build`
- Targeted token manager tests for create/list/revoke/rotate/verify.
- Targeted CLI tests for token human/JSON output and errors.
- Targeted server tests for `401 Unauthorized`, `403 Forbidden`, auth modes,
  and route permission mapping.
- `git diff --check -- impl-plans/completed/token-auth.md`

## Completion Criteria

- [x] Token lifecycle commands are implemented and tested.
- [x] Token storage never writes Cursor-managed files.
- [x] Token list output never exposes hashes or raw secrets.
- [x] Bearer verification rejects malformed, revoked, expired, mismatched, and old rotated tokens.
- [x] Route permission guard returns `401` and `403` consistently.
- [x] Route auth decisions occur before handlers read or mutate local state.
- [x] `task typecheck`, `task test`, and `task build` pass.

## Risks

1. Existing server core has a static token field; replacing it must preserve
   non-loopback startup safety.
2. Route permission coverage can drift as later Phase 4/5 routes are added.
3. Token-file permission hardening may vary by runtime and platform.

## Progress Log

### Session: 2026-05-07

**Tasks Completed**: Implementation plan refreshed after Step 3 accepted
`design-docs/specs/design-token-auth.md`.
**Tasks In Progress**: None.
**Blockers**: None for planning; route permission enforcement waits on TASK-005.
**Notes**: Updated stale `P4-TOKEN-AUTH` and blocked server-auth language to
`P4-AUTH` with existing `P4-HTTP-SERVER` treated as ready.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-006; TASK-007 typecheck item.
**Tasks In Progress**: None (`TASK-007` README/workflow-doc refresh concluded in Progress Log Session 2026-05-09).
**Blockers**: None for Step 6 implementation.
**Notes**: Added managed token lifecycle implementation, local `tokens.json`
store, CLI `token` commands, bearer verification, route permission mapping,
`403 FORBIDDEN` support, and focused auth/store/CLI/server tests. Targeted
commands passed: `bun test src/auth/token-manager.test.ts
src/persistence/token-store.test.ts`, `bun test src/server/server.test.ts`,
`bun test src/cli/cli.test.ts`, `task typecheck`, `task test`, `task build`,
and `git diff --check -- impl-plans/completed/token-auth.md`.

### Session: 2026-05-09

**Tasks Completed**: TASK-007 documentation refresh; added `server:read` permission for `/api/repository/analytics`; updated `README.md`, `.divedra/README.md`, and plan type snippets to match `src/types/auth-token.ts`.

**Verification**: `task ci` after HTTP resource integration.

**Notes**: Permission mapping for new REST resources lives in `src/server/permissions.ts` alongside existing session/bookmark/file rules.
