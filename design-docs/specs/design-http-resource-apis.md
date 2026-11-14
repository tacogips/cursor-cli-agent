# HTTP Resource APIs

This document defines the Phase 4 `P4-HTTP-RESOURCE-APIS` design for normalized REST routes over local Cursor resource models.

## Overview

The HTTP resource API exposes the stable local domain model through REST routes under `/api`. It is the resource layer that sits on top of the phase-4 HTTP server core and optional bearer-token auth.

Included:

- normalized routes for groups, queues, bookmarks, files, activity, and repository analytics
- request and response DTOs built from repository-owned domain records
- mapping from codex-agent GraphQL command behavior to REST resources
- explicit permission families for route groups
- Cursor-specific identity and provenance fields where callers need to understand local data quality

Excluded:

- runtime implementation in this design branch
- GraphQL compatibility endpoints
- SSE/live event streaming
- daemon supervision
- direct exposure of raw Cursor transcript JSONL, `worker.log`, or `ai-tracking` SQLite rows
- mutation of Cursor-managed files, databases, or skill directories

## Route Principles

The API must expose repository-owned application entities, not Cursor payloads.

Rules:

- All routes use JSON request and response bodies.
- Route handlers resolve identities through local repositories and managers.
- Session identity accepts `recordId`, `localSessionId`, or `cursorChatId` where the underlying manager already supports that resolution.
- Response records include provenance when data is derived from Cursor local state.
- Missing optional Cursor enrichment is represented as degraded provenance or `unknown`, not as a false empty result.
- Mutating routes return the updated resource or a deletion result.
- Long-running execution routes start local CLI-backed work only through existing process/manager boundaries.
- Errors use the HTTP server core error contract, with stable machine-readable codes such as `not_found`, `invalid_request`, `conflict`, `unauthorized`, and `forbidden`.

## Resource Routes

### Health

Health routes depend only on the HTTP server core.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/health` | Return process health and readiness. | none |
| `GET` | `/api/version` | Return package and tool version information. | none |

### Groups

Group routes expose `GroupRecord` and `GroupProgressSnapshot` from the local group lifecycle model.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/groups` | List groups. | `group:read` |
| `POST` | `/api/groups` | Create a group from name and workspaces. | `group:write` |
| `GET` | `/api/groups/:name` | Show one group. | `group:read` |
| `PATCH` | `/api/groups/:name` | Update mutable group metadata or workspace membership. | `group:write` |
| `DELETE` | `/api/groups/:name` | Delete a group, with optional force behavior. | `group:write` |
| `POST` | `/api/groups/:name/pause` | Persist paused lifecycle state. | `group:write` |
| `POST` | `/api/groups/:name/resume` | Persist active lifecycle state. | `group:write` |
| `POST` | `/api/groups/:name/runs` | Start a group run through existing Cursor process boundaries. | `group:run` |
| `GET` | `/api/groups/:name/progress` | Return the latest activity-derived progress snapshot. | `group:read` |

### Queues

Queue routes expose local queue records and queue item lifecycle. They depend on the queue lifecycle slice for pause, resume, update, move, mode, delete, and run behavior.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/queues` | List queues. | `queue:read` |
| `POST` | `/api/queues` | Create a queue for one workspace or target session. | `queue:write` |
| `GET` | `/api/queues/:name` | Show one queue. | `queue:read` |
| `DELETE` | `/api/queues/:name` | Delete a queue, with optional force behavior. | `queue:write` |
| `POST` | `/api/queues/:name/items` | Add a prompt item. | `queue:write` |
| `PATCH` | `/api/queues/:name/items/:itemId` | Update prompt text or execution mode. | `queue:write` |
| `DELETE` | `/api/queues/:name/items/:itemId` | Remove an item. | `queue:write` |
| `POST` | `/api/queues/:name/items/:itemId/move` | Reorder an item. | `queue:write` |
| `POST` | `/api/queues/:name/pause` | Persist paused lifecycle state. | `queue:write` |
| `POST` | `/api/queues/:name/resume` | Persist active lifecycle state. | `queue:write` |
| `POST` | `/api/queues/:name/runs` | Run the queue through existing Cursor process boundaries. | `queue:run` |

### Bookmarks

Bookmark routes expose `BookmarkRecord` and `BookmarkSearchResult`.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/bookmarks` | List bookmarks with optional `sessionId`, `type`, and `tag` filters. | `bookmark:read` |
| `POST` | `/api/bookmarks` | Create session, message, or range bookmark. | `bookmark:write` |
| `GET` | `/api/bookmarks/:id` | Show one bookmark. | `bookmark:read` |
| `DELETE` | `/api/bookmarks/:id` | Delete one bookmark. | `bookmark:write` |
| `GET` | `/api/bookmarks/search` | Search bookmark metadata, tags, ids, and excerpts. | `bookmark:read` |

Bookmark creation must use the bookmark manager so message and range targets are validated through stable transcript message IDs.

### Files

File routes expose `P3-FILE-INTELLIGENCE` service results. Cursor `ai-tracking` rows stay behind `src/cursor/ai-tracking-reader.ts`.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/files/sessions/:sessionId` | List touched files for a resolved session. | `files:read` |
| `GET` | `/api/files/sessions/:sessionId/snapshots` | List tracked snapshot metadata, with explicit content opt-in. | `files:read` |
| `GET` | `/api/files/sessions/:sessionId/deleted` | List deleted files for a resolved session. | `files:read` |
| `GET` | `/api/files/find` | Find sessions by normalized or raw file path query. | `files:read` |
| `POST` | `/api/files/rebuild` | Rebuild the repository-owned file intelligence index. | `files:write` |

### Activity

Activity routes expose `SessionActivity` records derived from process, stream, transcript, stderr/stdout, and index signals.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/activity` | List session activity with optional `status` and `limit`. | `session:read` |
| `GET` | `/api/activity/sessions/:sessionId` | Show activity for one resolved session. | `session:read` |

### Repository Analytics

Repository analytics routes aggregate local state for dashboard and SDK consumers. They must use repositories and managers rather than scanning Cursor raw files in the route handler.

| Method | Path | Behavior | Permission |
|--------|------|----------|------------|
| `GET` | `/api/repository/analytics` | Return aggregate counts and freshness across sessions, groups, queues, bookmarks, activity, and file index state. | `server:read` |

Analytics should include:

- session counts by status, identity state, mode, and workspace
- group and queue counts by lifecycle state
- bookmark counts by type and tag
- activity counts by status
- file index freshness and indexed session/file counts when available
- `updatedAt` and provenance fields for derived sections

## Response DTO Boundaries

HTTP DTOs should mirror domain names but remain transport safe:

- `Date` values are ISO strings.
- filesystem paths are included only when local CLI output already exposes them or when required for a resource contract.
- transcript excerpts use normalized raw/display fields from domain records.
- responses never include raw Cursor JSON event objects or SQL row objects.
- paginated list routes accept `limit` and `offset` where the underlying service can honor them; otherwise `limit` is applied after deterministic service ordering.

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/graphql/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/group/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/queue/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/bookmark/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/index.ts`

Reference behavior to preserve:

- command coverage for group, queue, bookmark, and file resources
- local-only persistence for groups, queues, and bookmarks
- rebuildable file index behavior
- explicit not-found and invalid-input failures
- version and health style readiness checks

Intentional divergences:

- This project exposes REST resources instead of codex-agent's generic GraphQL `command(name, params)` bridge.
- Routes return normalized Cursor-local domain DTOs, not codex-agent records or raw Cursor payloads.
- File intelligence is sourced from Cursor `ai-code-tracking.db`, not Codex rollout tool logs.
- Group and queue execution operate over Cursor workspaces and local session identity, not Codex process/session IDs.
- GraphQL compatibility remains a possible Phase 5 bridge and is not part of this feature.

## Dependencies

| Dependency ID | Required Contract |
|---------------|-------------------|
| `P4-HTTP-SERVER` | route registration, JSON body parsing, query parsing, response/error helpers, server lifecycle |
| `P4-AUTH` | optional bearer auth middleware and permission checks |
| `P2-BOOKMARKS` | bookmark manager, store, stable transcript bookmark targets |
| `P3-GROUP-LIFECYCLE` | group lifecycle records, pause/resume/delete/run/progress behavior |
| `P3-QUEUE-LIFECYCLE` | queue lifecycle records, item update/move/mode, pause/resume/delete/run behavior |
| `P3-FILE-INTELLIGENCE` | file intelligence service, index, provenance-aware results |
| `P2-ACTIVITY` | session activity manager for activity and group progress responses |

## Verification

Implementation verification should use:

```bash
task typecheck
task test
task ci
bun run src/main.ts server start --host 127.0.0.1 --port 0
```

Manual HTTP smoke coverage should call:

- `GET /api/health`
- `GET /api/groups`
- `GET /api/queues`
- `GET /api/bookmarks`
- `GET /api/activity`
- `GET /api/repository/analytics`

## Risks

- The HTTP server core and token auth contracts are separate dependencies; route implementation must not invent incompatible middleware APIs.
- Queue lifecycle types are not present in the current local source tree and must be aligned before queue routes are implemented.
- Repository analytics can become expensive if it bypasses existing indexes and managers.
- Exposing local filesystem paths over HTTP may surprise users if they bind beyond localhost, so auth and host binding defaults matter.

## Open Questions

None. This design chooses unversioned `/api` paths to match the existing architecture and command documents; a later compatibility phase can add `/api/v1` aliases if needed.

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-4-server-auth-daemon-and-public-sdk`
- `design-docs/specs/architecture.md#server-and-daemon`
- `design-docs/specs/command.md#server-commands`
- `design-docs/specs/design-bookmarks.md`
- `design-docs/specs/design-group-lifecycle.md`
- `design-docs/specs/design-file-intelligence.md`
- `impl-plans/completed/http-resource-apis.md`
