# Compatibility Bridge Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-compat-bridge.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

## Design Document Reference

**Source**: `design-docs/specs/design-compat-bridge.md`

### Summary

Implement `P5-COMPAT-BRIDGE`: an optional GraphQL and app-server-like compatibility bridge that dispatches Codex-agent-derived command names through normalized Cursor-local services, public SDK facades, server auth gates, and SSE stream sources.

### Scope

**Included**: compatibility command registry, capability matrix, structured limitation errors, dispatcher, GraphQL executor, GraphQL CLI, optional server route hook, app-server-like `compat-local` metadata, auth permission adapter, and focused tests.

**Excluded From Bridge Scope**: raw Cursor app-server proxying, remote token-management compatibility, `session.fork`, Codex patch-history compatibility, direct Cursor-managed file writes, and replacement of native REST/SSE/SDK contracts. Runtime implementation is in scope for the later issue-resolution implementation step.

### Codex Reference Mapping

- `/g/gits/tacogips/codex-agent/src/graphql/index.ts`: JSON scalar schema, command resolver, operation execution, subscription flow, validation helpers.
- `/g/gits/tacogips/codex-agent/src/graphql/index.test.ts`: query, mutation, validation, and `session.watch` subscription coverage.
- `/g/gits/tacogips/codex-agent/src/cli/graphql.ts`: shorthand command-to-document inference and JSON variable loading.
- `/g/gits/tacogips/codex-agent/src/cli/graphql.test.ts`: CLI shorthand and variable parsing tests.
- `/g/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`: server/app-server transport reference; this repository intentionally exposes only `compat-local`.

Workflow-provided references under `/g/gits/tacogips/cursor-cli-agent/codex-agent` are missing because that supplied root is empty. Use the sibling `/g/gits/tacogips/codex-agent` files above as accepted behavioral references.

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

**Status**: COMPLETED

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

**Checklist**: [x] encode matrix; [x] classify `session.fork`, `files.patches`, and token commands as unsupported; [x] include degraded limitation records; [x] test supported/degraded/unsupported/kind mismatch cases.

### 2. Permission Adapter

#### `src/compat/permissions.ts`

**Status**: COMPLETED

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

**Checklist**: [x] map intents to final `P4-TOKEN-AUTH` literals; [x] keep local CLI auth-disabled but kind-validated; [x] return `401` for missing credentials; [x] return `403` for insufficient permissions.

### 3. Compatibility Dispatcher

#### `src/compat/dispatcher.ts`

**Status**: COMPLETED

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

**Checklist**: [x] route queries to SDK/domain reads; [x] route mutations to managers after kind validation; [x] route subscriptions to `P4-SSE`; [x] return structured limitation errors.

### 4. GraphQL Execution Surface

#### `src/graphql/index.ts`

**Status**: COMPLETED

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

**Checklist**: [x] add JSON scalar, `ping`, and command fields; [x] convert streams to subscription results; [x] preserve parse/validate errors; [x] add limitation extensions.

### 5. GraphQL CLI

#### `src/cli/graphql.ts`
#### `src/cli/cli.ts`

**Status**: COMPLETED

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

**Checklist**: [x] route `curort-cli-agent graphql`; [x] infer shorthand kind from registry; [x] load JSON params/variables from literals or files; [x] print single JSON or NDJSON streams.

### 6. Server And App-Server Hooks

#### `src/server/graphql-route.ts`
#### `src/server/app-server-compat.ts`

**Status**: COMPLETED

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

**Checklist**: [x] register opt-in route with `P4-HTTP-SERVER-CORE`; [x] gate execution through `P4-TOKEN-AUTH`; [x] expose `compat-local` metadata; [x] use `P4-SSE` streams.

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Command contracts | `src/compat/commands.ts` | COMPLETED | `src/compat/commands.test.ts` |
| Permission adapter | `src/compat/permissions.ts` | COMPLETED | `src/compat/permissions.test.ts` |
| Dispatcher | `src/compat/dispatcher.ts` | COMPLETED | `src/compat/dispatcher.test.ts` |
| GraphQL executor | `src/graphql/index.ts` | COMPLETED | `src/graphql/index.test.ts` |
| GraphQL CLI | `src/cli/graphql.ts`, `src/cli/cli.ts` | COMPLETED | `src/cli/graphql.test.ts`, `src/cli/cli.test.ts` |
| Server/app-server hooks | `src/server/graphql-route.ts`, `src/server/app-server-compat.ts` | COMPLETED | `src/server/graphql-route.test.ts`, `src/server/app-server-compat.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| Command registry | design matrix | READY |
| Permission adapter | `P4-TOKEN-AUTH` permission literals | READY WITH FINAL-LITERAL ADAPTER |
| Dispatcher | `P4-PUBLIC-SDK`, domain service contracts | READY |
| GraphQL executor | Command registry and dispatcher | READY AFTER TASK-003 |
| GraphQL CLI | GraphQL executor and dispatcher factory | READY AFTER TASK-004 |
| Server route | `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH` | READY |
| Subscription compatibility | `P4-SSE` | READY |
| App-server `compat-local` metadata | `P4-HTTP-SERVER-CORE`, dispatcher | READY AFTER TASK-003 |

## Work Breakdown

### TASK-001: Command Registry And Capability Matrix

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/compat/commands.ts`, `src/compat/commands.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Matrix covers every command listed in the design.
- [x] Unsupported decisions for `session.fork`, `files.patches`, and token commands are explicit.
- [x] Degraded capability records include Cursor limitation codes.

### TASK-002: Auth Permission Adapter

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/compat/permissions.ts`, `src/compat/permissions.test.ts`
**Dependencies**: TASK-001, `P4-TOKEN-AUTH`

**Completion Criteria**:

- [x] Permission intents map to final token-auth literals.
- [x] Required auth returns `401` for missing credentials.
- [x] Insufficient token permissions return `403`.

### TASK-003: Normalized Dispatcher

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/compat/dispatcher.ts`, `src/compat/dispatcher.test.ts`
**Dependencies**: TASK-001, `P4-PUBLIC-SDK`, resource/SSE service contracts. Upstream workflow reports P4 dependencies ready; do not invent alternate service APIs.

**Completion Criteria**:

- [x] Queries, mutations, and subscriptions dispatch through normalized services.
- [x] Operation-kind mismatches fail before state changes.
- [x] Structured errors include capability and limitation metadata.

### TASK-004: GraphQL Executor

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/graphql/index.ts`, `src/graphql/index.test.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [x] Schema exposes JSON, `ping`, and command fields.
- [x] Query/mutation commands return normalized JSON.
- [x] Subscription commands stream execution results.
- [x] Unsupported/degraded commands surface GraphQL error extensions.

### TASK-005: GraphQL CLI

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/cli/graphql.ts`, `src/cli/cli.ts`, `src/cli/graphql.test.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [x] CLI shorthand uses registry operation metadata.
- [x] JSON params and variables load from literals and files.
- [x] Stream output is newline-delimited JSON.

### TASK-006: Server And App-Server Compatibility Hooks

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/graphql-route.ts`, `src/server/app-server-compat.ts`, server tests
**Dependencies**: `P4-HTTP-SERVER-CORE`, `P4-TOKEN-AUTH`, `P4-SSE`, TASK-002, TASK-004. Upstream workflow reports these dependencies ready.

**Completion Criteria**:

- [x] `/api/graphql` is opt-in.
- [x] Server command execution is auth-gated.
- [x] App-server metadata reports `mode: "compat-local"` and Cursor limitations.
- [x] Tests cover disabled, unauthorized, forbidden, successful, and disconnect cases.

### TASK-007: README And User-Facing Skill Refresh
**Status**: Completed
**Parallelizable**: Yes, after TASK-005 and TASK-006 because write scope is documentation only
**Deliverables**: `README.md` if created, `impl-plans/README.md`, affected `.agents/skills/*/SKILL.md`
**Dependencies**: TASK-005, TASK-006
**Completion Criteria**:
- [x] Public CLI/server compatibility usage is documented or explicitly marked as internal-only.
- [x] User-facing skill guidance is refreshed when implementation changes workflow-visible commands.
- [x] Documentation verification is recorded in this progress log.

## Completion Criteria

- [x] All planned modules implemented.
- [x] Capability matrix is exported and tested.
- [x] Unsupported/degraded Cursor limitations are visible in errors or metadata.
- [x] Server transports are opt-in and token/auth gated.
- [x] Native REST/SSE/SDK behavior remains unchanged.
- [x] README and user-facing skill refresh work completed or explicitly marked not applicable with file-path rationale.
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/bin.ts graphql 'query { ping }'
bun run src/bin.ts graphql session.list --param '{"limit":1}'
bun run src/bin.ts graphql 'mutation ($param: JSON) { command(name: "group.create", params: $param) }' --variables '{"param":{"name":"demo","workspaces":[]}}'
bun run src/bin.ts graphql session.watch --param '{"id":"<session-id>","startOffset":0}'
bun run src/bin.ts graphql queue.update --param '{"name":"<queue>","item":"<item-id>","prompt":"updated"}'
bun run src/bin.ts graphql queue.mode --param '{"name":"<queue>","item":"<item-id>","mode":"manual"}'
bun run src/bin.ts graphql queue.move --param '{"name":"<queue>","from":0,"to":1}'
rg -n 'watchGroup|watchQueue|watchActivity|/api/compat/app-server' src/compat/dispatcher.ts src/server/graphql-route.test.ts src/server/app-server-compat.ts src/server/app-server-compat.test.ts
rg -n 'graphql|compat-local|compatibility bridge' README.md impl-plans/README.md .agents/skills
```

## Progress Log

### Session: 2026-05-06
**Tasks Completed**: Initial plan plus readiness refresh; matrix, dependency ordering, auth gating, unsupported decisions, and Cursor limitation reporting captured.

### Session: 2026-05-07 Step 4 Implementation-Plan Creation

**Tasks Completed**: Reconciled plan-owned Codex reference paths to `/g/gits/tacogips/codex-agent`; updated stale dependency and server hook blocked labels to ready/not-started status because upstream workflow reports `P4-HTTP-SERVER`, `P4-AUTH`, `P4-HTTP-RESOURCE-APIS`, `P4-SSE`, and `P4-PUBLIC-SDK` dependencies ready.
**Tasks In Progress**: None. **Blockers**: None for plan handoff; implementation still must preserve the task dependency order.
**Notes**: Addressed Step 3 low finding. Later implementation should keep the exact path `impl-plans/active/compat-bridge.md` and update this progress log after each implementation session.

### Session: 2026-05-07 Step 5 Review Retry
**Tasks Completed**: Added TASK-007 and completion/verification coverage for README plus user-facing skill refresh; clarified runtime implementation is in scope for issue resolution.

### Session: 2026-05-07 Step 6 Implementation
**Tasks Completed**: Completed TASK-001 through TASK-007. Added `src/compat/commands.ts`, `src/compat/permissions.ts`, `src/compat/dispatcher.ts`, `src/graphql/index.ts`, `src/cli/graphql.ts`, `src/server/graphql-route.ts`, and `src/server/app-server-compat.ts` with focused tests. Updated `src/cli/cli.ts`, `src/server/routes.ts`, `src/server/types.ts`, `src/server/index.ts`, `src/index.ts`, `README.md`, and `impl-plans/README.md`.
**Verification**: `task typecheck`, focused compatibility `bun test`, `task test`, `task ci`, isolated `bun run src/bin.ts graphql ...` smoke commands, and `rg -n 'graphql|compat-local|compatibility bridge' README.md impl-plans/README.md .agents/skills` passed.
**Notes**: The supplied reference root `/g/gits/tacogips/cursor-cli-agent/codex-agent` remains empty, so implementation used the accepted sibling references under `/g/gits/tacogips/codex-agent`. No `.agents/skills/*/SKILL.md` required a content change because existing user-facing workflow skills describe workflow execution rather than CLI compatibility command usage; README and `impl-plans/README.md` carry the user-facing command refresh. GraphQL CLI smoke uses `src/bin.ts` because `src/main.ts` exports `main` but is not an executable entrypoint.

### Session: 2026-05-07 Step 6 Review Fix
**Tasks Completed**: Addressed Step 7 mid findings by adding dispatcher and SDK facade support for `queue.update`, `queue.move`, and `queue.mode`; added focused dispatcher coverage; changed `/api/graphql` subscription responses to stream newline-delimited GraphQL execution results; added disconnect cleanup coverage for subscription requests; updated `design-docs/specs/design-compat-bridge.md` verification commands to use executable `src/bin.ts`.
**Verification**: Re-ran focused compatibility tests, `task typecheck`, `task test`, `task ci`, isolated CLI smoke commands for ping/session/group/session.watch plus queue.update/queue.move/queue.mode, and README/plan/design rg verification.
**Notes**: Step 7 mid findings for supported queue commands and subscription disconnect coverage are fixed. Step 7 low finding for `src/main.ts` design-doc commands is fixed.

### Session: 2026-05-07 Step 6 Review Fix 2
**Tasks Completed**: Addressed Step 7 mid findings by routing `group.watch`, `queue.watch`, and `activity.watch` through `EventStreamService` when server stream dependencies are provided; added dispatcher and `/api/graphql` live-stream disconnect coverage for these subscription commands; added the opt-in auth-gated `/api/compat/app-server` metadata route and tests.
**Verification**: Re-ran `task typecheck`, focused compatibility tests, and rg checks for stream routing plus app-server route coverage.
**Notes**: Accepted P4-SSE subscription boundary and `compat-local` server hook contract are now covered by implementation and tests.
## Risks

- Compatibility bridge uses a minimal in-repository GraphQL-compatible executor for the approved command shape instead of introducing a `graphql` package; broader GraphQL language support would require a later dependency decision.
- Some command mappings that launch Cursor (`session.run`, `session.resume`, `group.run`, `queue.run`) execute through the public runner facade and can be expensive in live environments.
- Cursor-local evidence is weaker than Codex rollout/app-server events, so degraded subscription/file responses must stay explicit.
