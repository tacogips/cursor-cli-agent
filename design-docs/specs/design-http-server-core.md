# HTTP Server Core

This document defines the canonical `P4-HTTP-SERVER` design slice for a normalized local REST server over Cursor session state.

## Overview

The HTTP server exposes repository-owned Cursor session models through local REST routes. It is a phase-4 control-plane foundation, not a raw Cursor CLI proxy and not the daemon supervisor. The server runtime should be usable from `curort-cli-agent server start` and should reuse existing Cursor adapters, persistence repositories, metadata search, and transcript search services.

## Source Issue Mapping

- Backlog ID: `P4-HTTP-SERVER`
- Target feature area: `http server`
- Requested behavior: normalized local REST server runtime, configuration, health/version routes, session detail/list/search routes, error envelope, and CLI server start behavior
- Dependencies: `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE`

## Codex Reference Mapping

Use `/g/gits/tacogips/codex-agent` as the parity reference for this delegated workflow run.

Relevant reference files:

- `/g/gits/tacogips/codex-agent/impl-plans/completed/phase4-daemon-app-server.md`
- `/g/gits/tacogips/codex-agent/design-docs/specs/design-codex-session-management.md`
- `/g/gits/tacogips/codex-agent/src/session/index.ts`
- `/g/gits/tacogips/codex-agent/src/session/sqlite.ts`
- `/g/gits/tacogips/codex-agent/src/types/session.ts`
- `/g/gits/tacogips/codex-agent/src/graphql/index.ts`

Reference behavior to preserve:

- one runtime entrypoint resolves host, port, config directory, and local data roots
- server route handlers call domain/session/search APIs instead of parsing storage files directly
- health/version style commands are cheap and deterministic
- request validation returns structured errors instead of process crashes
- server start is explicit CLI behavior and should be testable without spawning Cursor

Intentional Cursor divergences:

- This repository exposes REST JSON first; the Codex GraphQL command dispatcher remains a behavioral reference, not an API shape to copy.
- Session APIs return `CursorSessionRecord` identities: `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.
- Session data comes from `~/.cursor/projects/*/agent-transcripts/*.jsonl`, `worker.log`, optional `ai-code-tracking.db`, and the local `state.db` index through adapters.
- App-server transport, daemon lifecycle, token storage, SSE streaming, groups, queues, bookmarks, and file routes are separate phase-4/phase-5 slices.

## Runtime Configuration

Server configuration should be resolved once at startup.

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
```

Defaults:

- `host`: `127.0.0.1`
- `port`: `0` when omitted, allowing Bun to allocate a free local port
- `dataDir`, `configDir`, `cursorHome`: existing helpers in `src/config/paths.ts`
- `token`: optional static bearer token supplied by CLI flag or environment variable

Loopback hosts may run without a token for local single-user usage. Non-loopback hosts must require a token unless a later auth design adds a safer explicit override.

## Route Contract

All routes return normalized JSON and must not expose raw Cursor transcript rows except where a detail endpoint explicitly includes normalized message objects.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/health` | liveness, uptime, server time, version |
| `GET` | `/api/version` | package name, package version, API version |
| `GET` | `/api/sessions` | list indexed sessions with optional workspace and pagination |
| `GET` | `/api/sessions/:id` | resolve by record, local session, or Cursor chat ID |
| `GET` | `/api/sessions/:id/messages` | return normalized transcript messages when materialized |
| `GET` | `/api/search/sessions` | metadata search backed by `SessionIndexRepository.searchSessions()` |
| `GET` | `/api/search/transcripts` | transcript search backed by `createTranscriptSearchService()` |

Query parameter validation follows existing CLI semantics:

- `limit` is a positive integer
- `offset` is a non-negative integer
- `workspace` is normalized with the same path logic as CLI search
- session search requires non-blank `q`
- transcript search requires non-blank `q` and accepts existing role and scan-budget parameters

Session list and detail routes should refresh/import local transcripts before reading the index, matching current CLI behavior. Missing Cursor directories return empty collections, not server failures.

## Error Envelope

Error responses use one stable envelope:

```typescript
export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId: string;
  };
}
```

Initial error codes:

- `INVALID_REQUEST` for malformed path, query, or JSON inputs
- `UNAUTHORIZED` for missing or invalid bearer token when configured
- `NOT_FOUND` for unknown session IDs
- `METHOD_NOT_ALLOWED` for unsupported HTTP methods on known paths
- `INTERNAL_ERROR` for unexpected runtime failures

Errors must not include stack traces or raw filesystem payloads. Logs may include diagnostic details locally.

## CLI Behavior

`curort-cli-agent server start` starts the foreground local server.

Accepted flags for this slice:

- `--host <host>`
- `--port <port>`
- `--token <token>`
- `--json`

Human output prints the resolved listen URL and whether auth is enabled. JSON output returns:

```typescript
export interface ServerStartResult {
  readonly status: "running";
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly auth: "none" | "bearer";
}
```

The command should keep the process alive until interrupted. Tests should use the server module directly to avoid long-running CLI processes except for parser/startup unit coverage.

## Boundaries

Included:

- Bun HTTP server runtime
- config resolution
- optional static bearer check
- health and version routes
- session list/detail/messages routes
- session metadata search route
- transcript search route
- shared error envelope
- CLI `server start`

Excluded:

- daemon start/stop/status
- persistent token management and scoped permissions
- SSE/watch streams
- groups, queues, bookmarks, files, activity routes
- GraphQL compatibility
- app-server transport bridge
- SDK export stabilization

## Open Questions

None for this slice. Later auth and daemon slices may revise token storage, route permissions, and background lifecycle behavior.

## References

See `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/design-session-search.md`, `design-docs/specs/design-transcript-search.md`, and `design-docs/specs/design-codex-agent-parity-gap.md`.
