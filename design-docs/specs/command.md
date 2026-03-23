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

List known sessions from the local index.

Example:

```bash
cursor-cli-agent session list --workspace /repo/path --limit 20
```

### `session show <session-id>`

Show transcript summary and metadata.

### `session watch <session-id>`

Follow transcript updates and normalized live events.

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

Wrap `cursor-agent create-chat` and persist the returned `cursorChatId`.

### `session resume <session-id-or-chat-id>`

Resume a known session and optionally send a prompt.

Flags:

- `--prompt <text>`
- `--workspace <path>`
- `--stream <text|json|events>`

### `session continue`

Continue the latest session for the current or specified workspace.

### `session attach <session-id-or-chat-id>`

Open interactive Cursor Agent attached to the requested session.

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

Phase-1.5 scope:

- `skill list`
- `skill show <name>`

Discovery roots:

- built-in: `~/.cursor/skills-cursor`
- user: `~/.cursor/skills`
- project: `.cursor/skills`

## Server Commands

Phase-2 scope:

- `server start --host <host> --port <port>`

## Daemon Commands

Phase-2 scope:

- `daemon start`
- `daemon stop`
- `daemon status`

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
| `--stream` | enum | `events` | Output projection for users of this wrapper |
| `--json` | boolean | false | Emit structured command results |

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
