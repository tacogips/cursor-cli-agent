# Command Design

This document defines the planned CLI contract for `cursor-cli-agent`.

## Design Principles

- Mirror `codex-agent` where it helps migration
- Preserve Cursor-native concepts such as `plan`, `ask`, workspace trust, and worktrees
- Prefer explicit workspace/session targeting over implicit global state

## Top-Level Commands

```text
cursor-cli-agent session <subcommand>
cursor-cli-agent group <subcommand>
cursor-cli-agent queue <subcommand>
cursor-cli-agent skill <subcommand>
cursor-cli-agent server <subcommand>
cursor-cli-agent daemon <subcommand>
cursor-cli-agent version
```

## Session Commands

### `session list`

List known sessions from the local index, including pending chat-only records created by `session create`.

Example:

```bash
cursor-cli-agent session list --workspace /repo/path --limit 20
```

### `session show <session-id-or-chat-id>`

Show transcript summary and metadata.

For pending chat-only records, return the persisted chat/workspace metadata and surface that the transcript has not materialized yet.

Message presentation rules:

- human-readable output defaults to `displayText`
- JSON output must include both `rawText` and `displayText`
- when available, JSON output should expose semantic extraction such as `structured.userQueryText`

### `session watch <session-id-or-chat-id>`

Follow transcript updates and normalized live events.

Behavior rules:

- transcript-backed sessions begin streaming immediately
- pending chat-only records are valid watch targets
- when watching a pending chat-only record, the command should emit pending state, wait for transcript materialization, then continue with normal transcript/live event streaming
- normalized message events must preserve both `rawText` and `displayText` in JSON mode

### `session run`

Start a new headless Cursor session.

Primary flags:

- `--prompt <text>` required
- `--workspace <path>` defaults to current working directory
- `--model <model>`
- `--mode <default|plan|ask>`
- `--trust`
- `--force`
- `--yolo`
- `--sandbox <enabled|disabled>`
- `--approve-mcps`
- `--stream <text|json|events>`
- `--stream-partial-output`
- `--worktree [name]`
- `--worktree-base <ref>`

### `session create`

Wrap `cursor-agent create-chat` and persist the returned `cursorChatId` as a pending chat-only session record.

Primary flags:

- `--workspace <path>` defaults to current working directory
- `--json`

### `session resume <session-id-or-chat-id>`

Resume a known session and optionally send a prompt.

Flags:

- `--prompt <text>`
- `--workspace <path>` (when omitted, use the indexed workspace for a known session if available; otherwise current working directory)
- `--stream <text|json|events>`

### `session continue`

Continue the latest session for the current or specified workspace (most recently updated in the local index, matching `workspace_slug` or `workspace_path`).

Flags:

- `--workspace <path>`
- `--stream <text|json|events>` (same semantics as `session run` / `session resume`; `--json` is an alias for `--stream json`)

### `session attach <session-id-or-chat-id>`

Open interactive Cursor Agent attached to the requested session.

When `--workspace` is omitted, use the indexed workspace for a known session if available; otherwise current working directory.

## Session Identity Semantics

- `session create` creates a local pending record before any transcript exists
- `session run` creates a transcript-backed session immediately
- `session show`, `session watch`, `session resume`, and `session attach` must resolve both transcript-backed `localSessionId` and pre-materialized `cursorChatId`
- `session list` must label pending chat-only records so users can distinguish them from transcript-backed sessions

## Group Commands

Phase-1 scope:

- `group create <name>`
- `group list`
- `group show <name>`
- `group add <name> --workspace <path>`
- `group remove <name> --workspace <path>`
- `group run <name> --prompt <text>`

## Queue Commands

Phase-1 scope:

- `queue create <name> --workspace <path>`
- `queue list`
- `queue show <name>`
- `queue add <name> --prompt <text>`
- `queue remove <name> --item <id>`
- `queue run <name>`

## Skill Commands

Phase-1 scope (read-only discovery):

- `skill list`
- `skill show <name>`

Discovery roots:

- built-in: `~/.cursor/skills-cursor`
- user: `~/.cursor/skills`
- project: `.cursor/skills`

## Server Commands

Phase-2 scope:

- `server start --host <host> --port <port>`

Phase-1 behavior: invoking `server` prints a short message and exits with a non-zero code (feature not yet implemented).

## Daemon Commands

Phase-2 scope:

- `daemon start`
- `daemon stop`
- `daemon status`

Phase-1 behavior: invoking `daemon` prints a short message and exits with a non-zero code (feature not yet implemented).

## Shared Flags and Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--workspace` | path | current cwd | Target workspace for Cursor |
| `--model` | string | Cursor default | Model passed through to `cursor-agent` |
| `--mode` | enum | `default` | Cursor execution mode: default, plan, ask |
| `--trust` | boolean | false | Accept workspace trust in headless flows |
| `--force` | boolean | false | Force allow commands unless explicitly denied |
| `--yolo` | boolean | false | Cursor alias for run-everything mode |
| `--sandbox` | enum | Cursor default | `enabled` or `disabled` |
| `--approve-mcps` | boolean | false | Auto-approve MCP servers |
| `--stream` | enum | `events` | Output projection for users of this wrapper (`text`, `json`, or `events`; invalid values are rejected) |
| `--json` | boolean | false | For list/show/create-style commands: emit structured command results. For `session run`, `session resume`, `session continue`, `group run`, and `queue run`: alias for `--stream json` (after explicit `--stream` if both are set, `--stream` wins) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CURSOR_API_KEY` | No | none | Native Cursor CLI authentication override |
| `CURSOR_CLI_AGENT_CONFIG_DIR` | No | `~/.config/cursor-cli-agent` | Config location |
| `CURSOR_CLI_AGENT_DATA_DIR` | No | `~/.local/share/cursor-cli-agent` | State and repository data |
| `CURSOR_CLI_AGENT_CURSOR_HOME` | No | `~/.cursor` | Override Cursor home for testing |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid CLI usage |
| 3 | Session not found |
| 4 | Cursor CLI invocation failed |
| 5 | Workspace trust required |
| 6 | Transcript parse error |

## Compatibility Notes

- `fork` is intentionally absent in phase 1 because Cursor CLI does not expose a native equivalent.
- `session create` and `session resume` are separate because Cursor uses a pre-materialized chat ID flow that Codex does not.
- `skill` commands are read-only because `skills-cursor` is internal Cursor-managed state.
