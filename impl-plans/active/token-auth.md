# Token and Bearer Auth Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-token-auth.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-token-auth.md`

### Summary

Implement backlog slice `P4-TOKEN-AUTH`: local token create/list/revoke/rotate
commands, repository-owned token persistence, bearer-token verification, and
scoped permission enforcement hooks for the Phase 4 HTTP server.

### Scope

**Included**: auth token types, token config store, token manager, CLI token
commands, bearer verification middleware contracts, route permission guard
contracts, and focused tests for token lifecycle and server authorization.

**Excluded**: HTTP server core implementation, daemon lifecycle, public SDK
exports, GraphQL compatibility bridge, remote token-management routes, and any
mutation of Cursor-owned files or databases.

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/auth/types.ts`: permissions, metadata,
  normalization, and wildcard checks.
- `/Users/taco/gits/tacogips/codex-agent/src/auth/token-manager.ts`: file-backed
  token lifecycle with hashed secrets.
- `/Users/taco/gits/tacogips/codex-agent/src/auth/token-manager.test.ts`: lifecycle
  and permission parsing tests.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: token command behavior.

Intentional divergences:

- Use `getConfigDir()` and this repository's `CURORT_CLI_AGENT_CONFIG_DIR`
  override instead of the reference `~/.config/codex-agent` path.
- Add `files:*` and `server:admin` permission families from this repository's
  Phase 4 route model.
- Enforce permissions against normalized server route metadata, not raw Cursor
  CLI payload shapes.
- Keep GraphQL token commands out of scope until the compatibility bridge phase.

---

## Modules

### 1. Auth Types

#### `src/types/auth-token.ts`

**Status**: NOT_STARTED

```typescript
export type AuthPermission =
  | "session:create"
  | "session:read"
  | "session:cancel"
  | "group:*"
  | "queue:*"
  | "bookmark:*"
  | "files:*"
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

export interface TokenConfig {
  readonly tokens: readonly TokenRecord[];
}

export interface VerifiedToken {
  readonly ok: true;
  readonly metadata: ApiTokenMetadata;
}

export interface RejectedToken {
  readonly ok: false;
}

export type VerifyTokenResult = VerifiedToken | RejectedToken;
```

**Checklist**:

- [ ] Define permission literals and exported default permission list.
- [ ] Define public metadata and private persisted record shapes.
- [ ] Define `VerifyTokenResult` as a strict discriminated union.

### 2. Token Store

#### `src/persistence/token-store.ts`

**Status**: NOT_STARTED

```typescript
export interface TokenStore {
  load(): Promise<TokenConfig>;
  save(config: TokenConfig): Promise<void>;
}

export interface TokenStoreOptions {
  readonly configDir?: string;
  readonly tokensFileName?: string;
}
```

**Checklist**:

- [ ] Resolve storage through `getConfigDir()` unless tests inject `configDir`.
- [ ] Store `tokens.json` outside Cursor-managed directories.
- [ ] Return an empty config for missing files.
- [ ] Rewrite atomically via temporary file and rename.

### 3. Token Manager

#### `src/auth/token-manager.ts`
#### `src/auth/index.ts`

**Status**: NOT_STARTED

```typescript
export interface CreateTokenInput {
  readonly name: string;
  readonly permissions: readonly AuthPermission[];
  readonly expiresAt?: string;
}

export interface TokenManager {
  createToken(input: CreateTokenInput): Promise<string>;
  listTokens(): Promise<readonly ApiTokenMetadata[]>;
  revokeToken(id: string): Promise<boolean>;
  rotateToken(id: string): Promise<string>;
  verifyToken(rawToken: string): Promise<VerifyTokenResult>;
}
```

**Checklist**:

- [ ] Generate token id and high-entropy secret components.
- [ ] Persist only secret hashes.
- [ ] Validate non-empty names and non-empty normalized permissions.
- [ ] Sort listed metadata newest first.
- [ ] Reject revoked, expired, malformed, unknown, and mismatched tokens.

### 4. CLI Token Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
type TokenCommand =
  | "create"
  | "list"
  | "revoke"
  | "rotate";

interface TokenCreateArgs {
  readonly name: string;
  readonly permissions?: readonly AuthPermission[];
  readonly expiresAt?: string;
  readonly json: boolean;
}
```

**Checklist**:

- [ ] Add token command usage to top-level help.
- [ ] Implement `token create --name <name> [--permissions <csv>] [--expires-at <iso8601>] [--json]`.
- [ ] Implement `token list [--json]`.
- [ ] Implement `token revoke <id> [--json]`.
- [ ] Implement `token rotate <id> [--json]`.
- [ ] Return stable non-zero usage or not-found errors.

### 5. Server Auth Contracts

#### `src/server/auth.ts`
#### `src/server/types.ts`

**Status**: BLOCKED

```typescript
export type ServerAuthMode = "disabled" | "optional" | "required";

export interface ServerAuthContext {
  readonly mode: ServerAuthMode;
  readonly token?: ApiTokenMetadata;
}

export interface RoutePermissionRequirement {
  readonly permission: AuthPermission;
}

export interface AuthorizationResult {
  readonly ok: boolean;
  readonly status?: 401 | 403;
  readonly reason?: string;
  readonly token?: ApiTokenMetadata;
}
```

**Checklist**:

- [ ] Align file paths and request context with `P4-HTTP-SERVER-CORE`.
- [ ] Parse `Authorization: Bearer <token>`.
- [ ] Return `401` for missing or invalid tokens when auth is required.
- [ ] Return `403` for valid tokens missing the route permission.

### 6. Route Permission Map

#### `src/server/permissions.ts`

**Status**: BLOCKED

```typescript
export interface RoutePermission {
  readonly method: string;
  readonly pathPattern: string;
  readonly permission: AuthPermission;
}

export interface RoutePermissionRegistry {
  getRequirement(method: string, pathname: string): RoutePermissionRequirement | null;
}
```

**Checklist**:

- [ ] Map session read routes to `session:read`.
- [ ] Map session creation routes to `session:create`.
- [ ] Map session cancellation routes to `session:cancel`.
- [ ] Map group, queue, bookmark, and file routes to their wildcard families.
- [ ] Reserve server administration routes for `server:admin`.

## Work Breakdown

### TASK-001: Auth Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/auth-token.ts`, `src/auth/index.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Permission constants and helpers compile under strict TypeScript.
- [ ] Default permission is `session:read`.
- [ ] Wildcard family checks are covered by tests.

### TASK-002: Token Store

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/persistence/token-store.ts`, `src/persistence/token-store.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [ ] Token config reads and writes use repository-owned config paths.
- [ ] Missing file behavior returns an empty token list.
- [ ] Atomic save behavior is covered by tests where practical.

### TASK-003: Token Manager

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/auth/token-manager.ts`, `src/auth/token-manager.test.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [ ] Create/list/revoke/rotate/verify behavior matches the design.
- [ ] Raw secrets are returned only from create and rotate.
- [ ] Revoked and expired tokens cannot verify.

### TASK-004: CLI Commands

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-003

**Completion Criteria**:

- [ ] Token commands appear in usage text.
- [ ] Human and JSON output are stable.
- [ ] Usage and not-found failures return non-zero exit codes.

### TASK-005: Server Auth Integration

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/server/auth.ts`, `src/server/types.ts`, `src/server/auth.test.ts`
**Dependencies**: TASK-003, `P4-HTTP-SERVER-CORE`

**Completion Criteria**:

- [ ] Bearer token parsing feeds verified metadata into request context.
- [ ] Required auth returns `401` for missing or invalid credentials.
- [ ] Disabled auth mode is limited by server core startup policy.

### TASK-006: Route Permission Enforcement

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/server/permissions.ts`, `src/server/auth.test.ts`
**Dependencies**: TASK-005, `P4-HTTP-SERVER-CORE`

**Completion Criteria**:

- [ ] Every protected route declares exactly one required permission.
- [ ] Valid tokens without the required permission return `403`.
- [ ] Permission decisions use normalized route metadata only.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Auth types | `src/types/auth-token.ts` | NOT_STARTED | - |
| Token store | `src/persistence/token-store.ts` | NOT_STARTED | Planned |
| Token manager | `src/auth/token-manager.ts` | NOT_STARTED | Planned |
| CLI token commands | `src/cli/cli.ts` | NOT_STARTED | Planned |
| Server auth contracts | `src/server/auth.ts` | BLOCKED | Planned |
| Route permission map | `src/server/permissions.ts` | BLOCKED | Planned |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| `P4-TOKEN-AUTH` token CLI and storage | Auth types and token store | READY |
| `P4-TOKEN-AUTH` server verification | `P4-HTTP-SERVER-CORE` request context and middleware | BLOCKED |
| `P4-TOKEN-AUTH` route enforcement | `P4-HTTP-SERVER-CORE` route metadata | BLOCKED |

## Completion Criteria

- [ ] Token lifecycle commands implemented and tested.
- [ ] Token storage never writes Cursor-managed files.
- [ ] Token list output never exposes secrets or hashes.
- [ ] Bearer verification rejects malformed, revoked, expired, and mismatched tokens.
- [ ] Route permission guard returns `401` and `403` consistently.
- [ ] `task typecheck`, `task test`, and `task build` pass.

## Progress Log

### Session: 2026-05-06 00:00

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Server auth integration and route permission enforcement depend on `P4-HTTP-SERVER-CORE`.
**Notes**: No runtime implementation was performed in this planning pass.
