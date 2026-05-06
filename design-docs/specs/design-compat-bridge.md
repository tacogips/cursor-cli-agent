# Compatibility Bridge Readiness Refresh

This document defines feature `P5-COMPAT-BRIDGE-REFRESH` for making the optional GraphQL and app-server compatibility bridge implementation-ready.

## Overview

The compatibility bridge gives external callers a Codex-agent-like command dispatch surface while preserving this repository's Cursor-local product boundary. GraphQL and app-server compatibility are transports over normalized local services; they must not expose raw Cursor transcript JSONL, `worker.log`, `ai-tracking` rows, or Cursor-managed skill state.

Included:

- GraphQL schema with `Query.command`, `Mutation.command`, `Subscription.command`, and `Query.ping`
- CLI shorthand for GraphQL documents and normalized command names
- command capability matrix with supported, degraded, and unsupported decisions
- dependency ordering across phase-4 server, resource, SSE, token auth, and public SDK slices
- token/auth gating for server transports
- app-server-like `compat-local` transport metadata with explicit Cursor limitation reporting

Excluded:

- runtime implementation in this design-plan branch
- raw Cursor app-server protocol proxying
- direct writes to Cursor-managed directories or databases
- Codex-only commands without a proven Cursor-local equivalent
- replacing native REST, SSE, or public SDK contracts

## Compatibility Shape

The bridge follows the useful codex-agent GraphQL shape: a deliberately small schema with a generic command field and JSON params.

```graphql
scalar JSON

type Query {
  ping: Boolean!
  command(name: String!, params: JSON): JSON!
}

type Mutation {
  command(name: String!, params: JSON): JSON!
}

type Subscription {
  command(name: String!, params: JSON): JSON!
}
```

Resolvers call a compatibility dispatcher shared by the GraphQL CLI, the optional `/api/graphql` route, and the app-server-like transport. The dispatcher calls public SDK or domain service boundaries, not CLI stdout parsers.

## Command Capability Matrix

| Command | Kind | Status | Local Mapping | Auth Gate |
|---|---|---|---|---|
| `version.get` | query | supported | package/tool version helper | none or `server:read` when remote |
| `session.list`, `session.show`, `session.search`, `session.searchTranscript` | query | supported | session index, transcript reader/search services | `session:read` |
| `session.run`, `session.resume`, `session.create` | mutation | supported | Cursor process runner and session managers | `session:create` |
| `session.cancel` | mutation | degraded | only supported after daemon/process supervision exposes cancellation | `session:cancel` |
| `session.watch` | subscription | degraded | `P4-SSE` session stream or transcript tailer | `session:read` |
| `group.list`, `group.show` | query | supported | group store/progress service | `group:read` or final group read equivalent |
| `group.create`, `group.add`, `group.remove`, `group.pause`, `group.resume`, `group.delete` | mutation | supported | group lifecycle manager | `group:write` or final group write equivalent |
| `group.run` | mutation | supported | group runner through Cursor process boundaries | `group:run` or final group run equivalent |
| `group.watch` | subscription | degraded | `P4-SSE` group progress stream | `group:read` or final group read equivalent |
| `queue.list`, `queue.show` | query | supported | queue store/lifecycle service | `queue:read` or final queue read equivalent |
| `queue.create`, `queue.add`, `queue.update`, `queue.remove`, `queue.move`, `queue.mode`, `queue.pause`, `queue.resume`, `queue.delete` | mutation | supported | queue lifecycle manager | `queue:write` or final queue write equivalent |
| `queue.run` | mutation | supported | queue runner through Cursor process boundaries | `queue:run` or final queue run equivalent |
| `queue.watch` | subscription | degraded | `P4-SSE` queue progress stream | `queue:read` or final queue read equivalent |
| `bookmark.list`, `bookmark.get`, `bookmark.search` | query | supported | bookmark manager/store | `bookmark:read` or final bookmark read equivalent |
| `bookmark.add`, `bookmark.delete` | mutation | supported | bookmark manager with transcript target validation | `bookmark:write` or final bookmark write equivalent |
| `files.list`, `files.find`, `files.snapshots`, `files.deleted` | query | degraded | Cursor `ai-tracking`-derived file intelligence | `files:read` or final files read equivalent |
| `files.patches` | query | unsupported | Codex patch history has no Cursor-equivalent source | `files:read` |
| `files.rebuild` | mutation | supported | repository-owned file intelligence rebuild | `files:write` or final files write equivalent |
| `activity.list`, `activity.show` | query | supported | derived activity manager | `session:read` |
| `activity.watch` | subscription | degraded | `P4-SSE` activity stream | `session:read` |
| `skill.list` | query | degraded | Cursor skill catalog discovery only | `server:read` |
| `token.create`, `token.list`, `token.revoke`, `token.rotate` | query/mutation | unsupported in compat bridge | local operator CLI only; remote token management is out of scope | `server:admin` if later enabled |
| `session.fork` | mutation | unsupported | Cursor-local replay/fork behavior is not proven | `session:create` |

Unsupported or degraded commands return structured compatibility errors or capability records containing `command`, `operationKind`, `status`, `reason`, `cursorLimitation`, and `provenance`.

## Dependency Ordering

Implementation order:

1. `P4-HTTP-SERVER-CORE` provides request lifecycle, route registration, error envelopes, and server startup policy.
2. `P4-TOKEN-AUTH` provides bearer verification, request auth context, and permission checks.
3. `P4-HTTP-RESOURCE-APIS` provides normalized resource DTOs and route permission vocabulary.
4. `P4-SSE` provides event stream services used by compatibility subscriptions.
5. `P4-PUBLIC-SDK` provides import-safe facades for dispatcher dependencies.
6. `P5-COMPAT-BRIDGE-REFRESH` implements registry, dispatcher, GraphQL executor/CLI, and server/app-server hooks.

The command registry can be implemented first because it is data-only. Dispatcher, GraphQL resolver, and route hooks must wait for the relevant dependency contracts instead of inventing parallel service APIs.

## Auth And Transport Gating

The local GraphQL CLI is a local operator command and does not require bearer auth. It must still validate operation kind before executing any mutation.

Server transports are gated as follows:

- `/api/graphql` is opt-in and disabled by default until server startup exposes an explicit compatibility flag.
- When server auth mode is `required`, every command must pass the permission gate in the capability matrix before dispatch.
- When server auth mode is `optional` or `disabled`, non-loopback startup policy remains owned by `P4-HTTP-SERVER-CORE`; the bridge must not weaken it.
- App-server-like compatibility mode uses `mode: "compat-local"` and the same auth gate as `/api/graphql`.
- Token management commands are not exposed through GraphQL/app-server compatibility in this slice.

If final token-auth literals use wildcard families instead of read/write/run literals, implementation maps the compatibility permission intents to those final literals in one permission adapter.

## CLI Contract

```bash
curort-cli-agent graphql <document|command> [--param <json|path>] [--variables <json|path>] [--json]
```

Behavior:

- explicit `query`, `mutation`, `subscription`, `{`, and `#` inputs are treated as GraphQL documents
- shorthand command names are wrapped as `command(name: "...", params: $param)`
- command registry metadata determines whether shorthand becomes query, mutation, or subscription
- `--param` binds variable `param`; `--variables` supplies the full GraphQL variable object
- file inputs may be passed as `@path` or readable paths
- subscription results print newline-delimited JSON execution results

## Cursor Limitation Reporting

Known limitations:

- Cursor transcripts do not provide all Codex rollout metadata.
- Pending `chat_only` records may lack transcript-backed messages until materialized.
- Cursor has no confirmed local app-server protocol surface for this project to proxy.
- Subscriptions are best-effort local file tails or derived activity streams, not durable server-side event streams.
- In-flight process cancellation requires a later daemon/process-supervisor contract.
- File intelligence depends on `ai-tracking` availability and may be sparse.
- Built-in Cursor skills are discovery-only and must not be mutated.
- Cursor auth/model state has no stable local status API.

Every degraded response must distinguish unavailable evidence from empty results by including provenance or limitation metadata.

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/graphql.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/graphql.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`

Preserved behavior:

- JSON scalar GraphQL schema
- `command(name, params)` for query, mutation, and subscription
- parse, validate, execute, and subscribe flow
- CLI shorthand inference
- explicit errors for invalid params and unsupported commands

Intentional divergences:

- Dispatch targets Cursor-normalized services and public SDK facades.
- `session.fork`, `files.patches`, and token lifecycle commands are unsupported in compatibility mode.
- App-server compatibility is local metadata and command transport, not a Cursor protocol proxy.
- Subscription durability is best-effort and reports Cursor evidence limitations.

## Verification

Planned implementation verification:

```bash
task typecheck
task test
task ci
bun run src/main.ts graphql 'query { ping }'
bun run src/main.ts graphql session.list --param '{"limit":1}'
bun run src/main.ts graphql 'mutation ($param: JSON) { command(name: "group.create", params: $param) }' --variables '{"param":{"name":"demo","workspaces":[]}}'
bun run src/main.ts graphql session.watch --param '{"id":"<session-id>","startOffset":0}'
```

Server smoke checks wait for phase-4 route contracts and should cover disabled route, missing token, forbidden token, successful query, successful mutation, and subscription disconnect cleanup.

## Open Questions

- Should `/api/graphql` use `--compat-graphql` or a broader `--compat` server flag?
- Should capability metadata list unsupported Codex-only commands by default, or only when requested with an include flag?

## References

- `impl-plans/active/compat-bridge.md`
- `design-docs/specs/design-codex-agent-parity-gap.md#phase-5-compatibility-layer-and-optional-extensions`
- `design-docs/specs/design-http-server-core.md`
- `design-docs/specs/design-http-resource-apis.md`
- `design-docs/specs/design-server-event-streaming.md`
- `design-docs/specs/design-token-auth.md`
- `design-docs/specs/design-public-sdk.md`
