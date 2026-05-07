# Token and Bearer Auth Design

This document defines the Phase 4 design for canonical backlog slice `P4-AUTH`.

## Overview

`curort-cli-agent` will support local API token management and bearer-token
authorization for the planned HTTP server. The feature mirrors the useful
`codex-agent` token lifecycle while mapping auth state to this repository's
local config, normalized server route contracts, and Cursor-specific adapter
boundaries.

The primary user-facing surface is:

- `token create --name <name> [--permissions <csv>] [--expires-at <iso8601>] [--json]`
- `token list [--json]`
- `token revoke <id> [--json]`
- `token rotate <id> [--json]`

The server-facing surface is:

- parse `Authorization: Bearer <token>`
- verify active, unexpired, non-revoked tokens
- enforce route-level permissions before handlers read or mutate local state

## Behavior

Token records are repository-owned local config. They must not be stored in,
derived from, or written to Cursor-managed directories such as
`~/.cursor/projects`, `~/.cursor/ai-tracking`, or `~/.cursor/skills-cursor`.

Token creation:

- requires a non-empty display name
- defaults to `session:read` when no permissions are provided
- rejects empty permission sets after normalization
- accepts an optional ISO `expiresAt`
- stores only a hash of the secret
- prints or returns the raw token secret exactly once

Token listing:

- returns metadata only
- never exposes token hashes or raw secrets
- includes `id`, `name`, `permissions`, `createdAt`, optional `expiresAt`, and
  optional `revokedAt`
- sorts newest first

Token revocation:

- marks `revokedAt` idempotently for an existing token
- reports not found for unknown ids
- causes future verification to fail

Token rotation:

- replaces the stored secret hash for an existing token id
- clears `revokedAt` so an explicitly rotated token becomes active again
- returns the replacement raw token exactly once
- invalidates the previous secret

Bearer verification:

- rejects malformed tokens
- resolves the token id first, then compares the submitted secret with constant
  time comparison after hashing
- rejects revoked or expired records
- returns token metadata for downstream permission checks

## Permission Model

Initial permissions are route-facing, not Cursor-payload-facing:

- `session:create`
- `session:read`
- `session:cancel`
- `group:*`
- `queue:*`
- `bookmark:*`
- `files:*`
- `server:admin`

`group:*`, `queue:*`, `bookmark:*`, and `files:*` cover all routes in their
family. `server:admin` is reserved for server administration and any future
remote token-management endpoints. CLI token commands remain local operator
commands and do not require bearer auth.

Route handlers introduced by `P4-HTTP-SERVER` must declare their required
permission before they call domain managers or persistence repositories.
Handlers expose normalized application entities only and must not pass raw
Cursor CLI payloads through auth decisions.

## Data Flow

1. CLI parses a `token` subcommand and validates local command shape.
2. Token manager loads `tokens.json` from `getConfigDir()`.
3. Create, revoke, and rotate operations atomically rewrite the config file.
4. Server middleware extracts bearer credentials and verifies the token.
5. Route registration maps each API route to one required permission.
6. Authorized handlers call existing Cursor adapters, managers, and persistence
   layers through normalized interfaces.

## Storage

Token config lives under this repository's config directory:

- default: `~/.config/curort-cli-agent/tokens.json`
- override: `CURORT_CLI_AGENT_CONFIG_DIR`
- legacy fallback: `CURSOR_CLI_AGENT_CONFIG_DIR`

The token config shape is:

- `tokens`: ordered array of token records
- token records include metadata plus `tokenHash`
- raw token secrets are never persisted

Writes should be atomic. When the runtime supports it, created token files
should use owner-only permissions.

## Auth Modes

Auth is optional for loopback-only local server use and mandatory when the
server is exposed beyond loopback.

Server startup policy belongs to `P4-HTTP-SERVER`, but this feature
requires these auth hooks:

- `authMode: "disabled" | "optional" | "required"`
- host binding awareness so non-loopback hosts cannot accidentally run without
  auth
- a request context field carrying verified token metadata when present

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/auth/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/auth/token-manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/auth/token-manager.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reused concepts:

- token format with separate id and secret components
- metadata-only listing
- secret hashing instead of raw secret persistence
- revoke and rotate lifecycle
- default `session:read` permission
- wildcard family permission checks
- tests for create, list, revoke, rotate, verify, and permission parsing

Intentional divergences:

- Config paths use `getConfigDir()` and project environment variable names
  instead of `~/.config/codex-agent`.
- Permission names include `files:*` and `server:admin` from this repository's
  Phase 4 server design.
- Server enforcement targets normalized Cursor-derived route entities rather
  than raw Codex rollout/session payloads.
- GraphQL token commands from the reference are not part of this slice unless a
  later compatibility bridge requests them.

## Dependencies

`P4-AUTH` depends on `P4-HTTP-SERVER` for:

- server startup auth mode wiring
- request context shape
- route registration metadata
- response helpers for `401 Unauthorized` and `403 Forbidden`

This design can be implemented after the server core establishes middleware and
route metadata contracts. Token CLI and token storage can be built first, but
server permission enforcement cannot be completed without the server core.

## Verification

Planned verification commands:

- `task typecheck`
- `task test`
- `task build`
- targeted token manager tests once implemented
- targeted server auth middleware tests once `P4-HTTP-SERVER` exists

## Open Questions

None for this planning pass. The design assumes the server core will provide
explicit route metadata and an auth mode field.

## References

- `design-docs/specs/design-codex-agent-parity-gap.md#phase-4-server-auth-daemon-and-public-sdk`
- `design-docs/specs/command.md#token-commands`
- `impl-plans/active/token-auth.md`
- `design-docs/references/README.md`
