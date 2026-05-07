# Compatibility Bridge Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-compat-bridge.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

## Design Document Reference

**Source**: `design-docs/specs/design-compat-bridge.md`

### Summary

Implement `P5-COMPAT-BRIDGE-REFRESH`: an optional GraphQL and app-server-like compatibility bridge that dispatches Codex-agent-derived command names through normalized Cursor-local services, public SDK facades, server auth gates, and SSE stream sources.

### Scope

**Included**: compatibility command registry, capability matrix, structured limitation errors, dispatcher, GraphQL executor, GraphQL CLI, optional server route hook, app-server-like `compat-local` metadata, auth permission adapter, and focused tests.

**Excluded**: runtime implementation in this planning branch, raw Cursor app-server proxying, remote token-management compatibility, `session.fork`, Codex patch-history compatibility, direct Cursor-managed file writes, and replacement of native REST/SSE/SDK contracts.

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/graphql/index.ts`: JSON scalar schema, command resolver, operation execution, subscription flow, validation helpers.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/graphql/index.test.ts`: query, mutation, validation, and `session.watch` subscription coverage.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/graphql.ts`: shorthand command-to-document inference and JSON variable loading.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/graphql.test.ts`: CLI shorthand and variable parsing tests.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: server/app-server transport reference; this repository intentionally exposes only `compat-local`.

Intentional divergences:

- Dispatch through `P4-PUBLIC-SDK` facades or domain managers, not Codex modules or CLI stdout.
- Use Cursor limitation metadata for degraded/unsupported capabilities.
- Keep token lifecycle commands local-only unless a later server-admin design explicitly adds remote token management.

## Related Plans

- **Depends On**: `impl-plans/active/http-server-core.md` (`P4-HTTP-SERVER-CORE`)
- **Depends On**: `impl-plans/active/token-auth.md` (`P4-TOKEN-AUTH`)
- **Depends On**: `impl-plans/active/http-resource-apis.md` (`P4-HTTP-RESOURCE-APIS`)
- **Depends On**: `impl-plans/active/server-event-streaming.md` (`P4-SSE`)
- **Depends On**: `impl-plans/active/public-sdk.md` (`P4-PUBLIC-SDK`)
- **Related Design**: `design-docs/specs/design-codex-agent-parity-gap.md#phase-5-compatibility-layer-and-optional-extensions`

## Modules

### 1. Compatibility Command Contracts

#### `src/compat/commands.ts`

**Status**: NOT_STARTED

```typescript
export type CompatOperationKind = "query" | "mutation" | "subscription";
export type CompatCommandStatus = "supported" | "degraded" | "unsupported";

export interface CompatLimitation {
  readonly code: string;
  readonly message: string;
  readonly cursorSpecific: boolean;
}

export interface CompatCommandCapability {
  readonly name: string;
  readonly kinds: readonly CompatOperationKind[];
  readonly status: CompatCommandStatus;
  readonly permission?: CompatPermissionIntent;
  readonly limitations: readonly CompatLimitation[];
}

export type CompatPermissionIntent =
  | "none"
  | "server:read"
  | "session:read"
  | "session:create"
  | "session:cancel"
  | "group:read"
  | "group:write"
  | "group:run"
  | "queue:read"
  | "queue:write"
  | "queue:run"
  | "bookmark:read"
  | "bookmark:write"
  | "files:read"
  | "files:write";
```

**Checklist**: [ ] encode matrix; [ ] classify `session.fork`, `files.patches`, and token commands as unsupported; [ ] include degraded limitation records; [ ] test supported/degraded/unsupported/kind mismatch cases.

### 2. Permission Adapter

#### `src/compat/permissions.ts`

**Status**: NOT_STARTED

```typescript
import type { CompatCommandCapability } from "./commands";

export interface CompatAuthContext {
  readonly mode: "disabled" | "optional" | "required";
  readonly tokenPermissions?: readonly string[] | undefined;
}

export interface CompatPermissionDecision {
  readonly ok: boolean;
  readonly status?: 401 | 403 | undefined;
  readonly required?: string | undefined;
  readonly reason?: string | undefined;
}

export declare function authorizeCompatCommand(
  capability: CompatCommandCapability,
  context: CompatAuthContext,
): CompatPermissionDecision;
```

**Checklist**: [ ] map intents to final `P4-TOKEN-AUTH` literals; [ ] keep local CLI auth-disabled but kind-validated; [ ] return `401` for missing credentials; [ ] return `403` for insufficient permissions.

### 3. Compatibility Dispatcher

#### `src/compat/dispatcher.ts`

**Status**: NOT_STARTED

```typescript
import type {
  CompatCommandCapability,
  CompatOperationKind,
} from "./commands";

export interface CompatExecutionContext {
  readonly workspace?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly configDir?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface CompatCommandRequest {
  readonly kind: CompatOperationKind;
  readonly name: string;
  readonly params?: unknown;
  readonly context: CompatExecutionContext;
}

export type CompatCommandResult =
  | { readonly kind: "single"; readonly value: unknown }
  | { readonly kind: "stream"; readonly values: AsyncIterable<unknown> };

export interface CompatCommandDispatcher {
  readonly capabilities: readonly CompatCommandCapability[];
  execute(request: CompatCommandRequest): Promise<CompatCommandResult>;
}
```

**Checklist**: [ ] route queries to SDK/domain reads; [ ] route mutations to managers after kind validation; [ ] route subscriptions to `P4-SSE`; [ ] return structured limitation errors.

### 4. GraphQL Execution Surface

#### `src/graphql/index.ts`

**Status**: NOT_STARTED

```typescript
import type { ExecutionResult, GraphQLSchema } from "graphql";
import type { CompatCommandDispatcher, CompatExecutionContext } from "../compat/dispatcher";

export interface GraphqlExecutionRequest {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly context?: CompatExecutionContext | undefined;
  readonly dispatcher: CompatCommandDispatcher;
}

export type GraphqlOperationResult =
  | ExecutionResult
  | AsyncIterable<ExecutionResult>;

export declare function getGraphqlSchema(): GraphQLSchema;
export declare function executeGraphqlOperation(
  request: GraphqlExecutionRequest,
): Promise<GraphqlOperationResult>;
```

**Checklist**: [ ] add JSON scalar, `ping`, and command fields; [ ] convert streams to subscription results; [ ] preserve parse/validate errors; [ ] add limitation extensions.

### 5. GraphQL CLI

#### `src/cli/graphql.ts`
#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
export interface GraphqlCliArgs {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
}

export interface GraphqlCliOptions {
  readonly workspace?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly configDir?: string | undefined;
}

export declare function runGraphqlCli(
  args: readonly string[],
  options?: GraphqlCliOptions,
): Promise<number>;
```

**Checklist**: [ ] route `curort-cli-agent graphql`; [ ] infer shorthand kind from registry; [ ] load JSON params/variables from literals or files; [ ] print single JSON or NDJSON streams.

### 6. Server And App-Server Hooks

#### `src/server/graphql-route.ts`
#### `src/server/app-server-compat.ts`

**Status**: BLOCKED

```typescript
import type { CompatCommandDispatcher } from "../compat/dispatcher";

export interface GraphqlRouteConfig {
  readonly enabled: boolean;
  readonly dispatcher: CompatCommandDispatcher;
}

export interface AppServerCompatMetadata {
  readonly mode: "compat-local";
  readonly capabilities: readonly string[];
  readonly limitations: readonly string[];
}
```

**Checklist**: [ ] wait for `P4-HTTP-SERVER-CORE`; [ ] gate execution through `P4-TOKEN-AUTH`; [ ] expose `compat-local` metadata; [ ] use `P4-SSE` streams.

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Command contracts | `src/compat/commands.ts` | NOT_STARTED | `src/compat/commands.test.ts` |
| Permission adapter | `src/compat/permissions.ts` | NOT_STARTED | `src/compat/permissions.test.ts` |
| Dispatcher | `src/compat/dispatcher.ts` | NOT_STARTED | `src/compat/dispatcher.test.ts` |
| GraphQL executor | `src/graphql/index.ts` | NOT_STARTED | `src/graphql/index.test.ts` |
| GraphQL CLI | `src/cli/graphql.ts`, `src/cli/cli.ts` | NOT_STARTED | `src/cli/graphql.test.ts`, `src/cli/cli.test.ts` |
| Server/app-server hooks | `src/server/graphql-route.ts`, `src/server/app-server-compat.ts` | BLOCKED | `src/server/graphql-route.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| Command registry | design matrix | READY |
| Permission adapter | `P4-TOKEN-AUTH` permission literals | READY WITH FINAL-LITERAL ADAPTER |
| Dispatcher | `P4-PUBLIC-SDK`, domain service contracts | BLOCKED |
| GraphQL executor | Command registry and dispatcher | BLOCKED |
| GraphQL CLI | GraphQL executor and dispatcher factory | BLOCKED |
| Server route | `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH` | BLOCKED |
| Subscription compatibility | `P4-SSE` | BLOCKED |
| App-server `compat-local` metadata | `P4-HTTP-SERVER-CORE`, dispatcher | BLOCKED |

## Work Breakdown

### TASK-001: Command Registry And Capability Matrix

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/compat/commands.ts`, `src/compat/commands.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Matrix covers every command listed in the design.
- [ ] Unsupported decisions for `session.fork`, `files.patches`, and token commands are explicit.
- [ ] Degraded capability records include Cursor limitation codes.

### TASK-002: Auth Permission Adapter

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/compat/permissions.ts`, `src/compat/permissions.test.ts`
**Dependencies**: TASK-001, `P4-TOKEN-AUTH`

**Completion Criteria**:

- [ ] Permission intents map to final token-auth literals.
- [ ] Required auth returns `401` for missing credentials.
- [ ] Insufficient token permissions return `403`.

### TASK-003: Normalized Dispatcher

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/compat/dispatcher.ts`, `src/compat/dispatcher.test.ts`
**Dependencies**: TASK-001, `P4-PUBLIC-SDK`, resource/SSE service contracts

**Completion Criteria**:

- [ ] Queries, mutations, and subscriptions dispatch through normalized services.
- [ ] Operation-kind mismatches fail before state changes.
- [ ] Structured errors include capability and limitation metadata.

### TASK-004: GraphQL Executor

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/graphql/index.ts`, `src/graphql/index.test.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [ ] Schema exposes JSON, `ping`, and command fields.
- [ ] Query/mutation commands return normalized JSON.
- [ ] Subscription commands stream execution results.
- [ ] Unsupported/degraded commands surface GraphQL error extensions.

### TASK-005: GraphQL CLI

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/cli/graphql.ts`, `src/cli/cli.ts`, `src/cli/graphql.test.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [ ] CLI shorthand uses registry operation metadata.
- [ ] JSON params and variables load from literals and files.
- [ ] Stream output is newline-delimited JSON.

### TASK-006: Server And App-Server Compatibility Hooks

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/server/graphql-route.ts`, `src/server/app-server-compat.ts`, server tests
**Dependencies**: `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`, `P4-SSE`, TASK-002, TASK-004

**Completion Criteria**:

- [ ] `/api/graphql` is opt-in.
- [ ] Server command execution is auth-gated.
- [ ] App-server metadata reports `mode: "compat-local"` and Cursor limitations.
- [ ] Tests cover disabled, unauthorized, forbidden, successful, and disconnect cases.

## Completion Criteria

- [ ] All planned modules implemented.
- [ ] Capability matrix is exported and tested.
- [ ] Unsupported/degraded Cursor limitations are visible in errors or metadata.
- [ ] Server transports are opt-in and token/auth gated.
- [ ] Native REST/SSE/SDK behavior remains unchanged.
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/main.ts graphql 'query { ping }'
bun run src/main.ts graphql session.list --param '{"limit":1}'
bun run src/main.ts graphql 'mutation ($param: JSON) { command(name: "group.create", params: $param) }' --variables '{"param":{"name":"demo","workspaces":[]}}'
bun run src/main.ts graphql session.watch --param '{"id":"<session-id>","startOffset":0}'
```

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: `P4-HTTP-SERVER-CORE` and `P4-PUBLIC-SDK` are not available in this repository yet.
**Notes**: Planned optional GraphQL/app-server compatibility over normalized local command dispatch. No runtime code implemented in this branch.

### Session: 2026-05-06 Readiness Refresh

**Tasks Completed**: Refreshed design and implementation plan from Planning to Ready; added command capability matrix, dependency ordering, auth gating, unsupported command decisions, and Cursor limitation reporting.
**Tasks In Progress**: None.
**Blockers**: Dispatcher/server tasks still depend on phase-4 server, token-auth, resource API, SSE, and public SDK contracts.
**Notes**: No runtime code implemented in this branch.

## Open Questions

- Should `/api/graphql` use `--compat-graphql` or a broader `--compat` server flag?
- Should capability metadata list unsupported Codex-only commands by default, or only when requested with an include flag?

## Risks

- Final token-auth permission literals may differ from read/write/run intents; the permission adapter must absorb that mismatch.
- GraphQL dependency introduction may require package and lockfile updates during implementation.
- Phase-4 server, SSE, and SDK contracts may revise file paths before this slice starts.
- Cursor-local evidence is weaker than Codex rollout/app-server events, so degraded subscription/file responses must stay explicit.
