# Compatibility Bridge Decisions

**Status**: Pending Decision

**Created**: 2026-05-07

**Category**: Command Design

## Decision Needed

The `P5-COMPAT-BRIDGE` design needs two user-facing rollout decisions before finalizing the public compatibility surface.

## Context

The compatibility bridge exposes optional Codex-agent-like GraphQL and app-server-style helpers over Cursor-local SDK, domain, server, and SSE boundaries. These decisions affect public CLI/server flags and capability metadata shape, but do not change the core design boundary.

## Decisions

### 1. Server Enablement Flag

Should the optional `/api/graphql` route use a dedicated `--compat-graphql` flag or a broader `--compat` flag?

| Option | Behavior | Tradeoff |
|---|---|---|
| `--compat-graphql` | Enables only the GraphQL compatibility route | More explicit and lower blast radius |
| `--compat` | Enables all compatibility helpers for the server | Easier to extend, but broader than the current slice |

### 2. Unsupported Command Metadata

Should capability metadata list unsupported Codex-only commands by default, or only when requested with an include flag?

| Option | Behavior | Tradeoff |
|---|---|---|
| Default include | Capability output always lists unsupported commands such as `session.fork` and `files.patches` | More transparent, but noisier |
| Include flag | Capability output lists unsupported commands only when requested | Quieter default, but less discoverable |

## Impact

- `design-docs/specs/design-compat-bridge.md`
- `impl-plans/active/compat-bridge.md`
- `src/cli/graphql.ts`
- `src/server/graphql-route.ts`
- `src/server/app-server-compat.ts`
- `src/compat/commands.ts`

## Awaiting

User decision on compatibility flag naming and unsupported-command capability metadata default.
