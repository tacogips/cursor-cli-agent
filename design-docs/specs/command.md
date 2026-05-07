# Command Design

This document defines the planned CLI contract for `curort-cli-agent`.

## Design Principles

- Mirror `codex-agent` where it helps migration
- Preserve Cursor-native concepts such as `plan`, `ask`, workspace trust, and worktrees
- Prefer explicit workspace/session targeting over implicit global state

## Top-Level Commands

```text
curort-cli-agent session <subcommand>
curort-cli-agent transcript <subcommand>
curort-cli-agent group <subcommand>
curort-cli-agent queue <subcommand>
curort-cli-agent bookmark <subcommand>
curort-cli-agent activity [options]
curort-cli-agent markdown <subcommand>
curort-cli-agent files <subcommand>
curort-cli-agent token <subcommand>
curort-cli-agent tool <subcommand>
curort-cli-agent model <subcommand>
curort-cli-agent usage <subcommand>
curort-cli-agent skill <subcommand>
curort-cli-agent server <subcommand>
curort-cli-agent daemon <subcommand>
curort-cli-agent version
```

## Session Commands

### `session list`

List known sessions from the local index, including pending chat-only records created by `session create`.

Example:

```bash
curort-cli-agent session list --workspace /repo/path --limit 20
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

### `session search <query>`

Phase-2 metadata-search scope for backlog item `P2-SESSION-SEARCH`.

Search known sessions by indexed metadata. Transcript full-text search is a separate phase-2 slice and should not be implemented as part of metadata search.

Primary flags:

- `--workspace <path>`
- `--model <model>`
- `--mode <default|plan|ask>`
- `--status <pending|active|completed|failed|unknown>`
- `--limit <n>`
- `--offset <n>`
- `--json`

Behavior rules:

- query matching is case-insensitive over indexed metadata such as session IDs, workspace, model, mode, status, first user text, and latest assistant text
- metadata filters must be satisfied from the local session index
- results must report match provenance as `index`
- pending chat-only records must remain searchable by `cursorChatId`, workspace metadata, status, and source

See `design-docs/specs/design-session-search.md` for the detailed behavior, validation, Codex-reference mapping, and Cursor-specific boundaries.

### `transcript search <query>`

Phase-2 transcript full-text scope for backlog item `P2-TRANSCRIPT-SEARCH`.

Search transcript-backed Cursor sessions by message content. This command scans local transcript JSONL files and must not change the metadata-only behavior of `session search`.

Primary flags:

- `--session <id>`
- `--role <user|assistant|system|tool>` (`system` and `tool` are Cursor-specific transcript roles and only match when normalized from observed Cursor rows)
- `--limit <n>`
- `--offset <n>`
- `--max-sessions <n>`
- `--max-bytes <n>`
- `--max-events <n>`
- `--json`

Behavior rules:

- query matching is case-insensitive over transcript message text
- results must report match provenance as `transcript`
- pending chat-only records do not produce transcript hits until materialized
- scan budgets must surface `truncated` or `timedOut` state in JSON output

See `design-docs/specs/design-transcript-search.md` for the detailed behavior, validation, Codex-reference mapping, and Cursor-specific boundaries.

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

P3 group lifecycle scope (see `design-docs/specs/design-group-lifecycle.md`):

- `group pause <name> [--json]`
- `group resume <name> [--json]`
- `group delete <name> [--force] [--json]`
- `group watch <name> [--interval <seconds>] [--once] [--json]`

## Queue Commands

Phase-1 scope:

- `queue create <name> --workspace <path>`
- `queue list`
- `queue show <name>`
- `queue add <name> --prompt <text>`
- `queue remove <name> --item <id>`
- `queue run <name>`

Later phases:

- `queue pause <name>`
- `queue resume <name>`
- `queue delete <name>`
- `queue update <name> --item <id> --prompt <text>`
- `queue move <name> --from <n> --to <n>`
- `queue mode <name> --item <id> --mode <auto|manual>`
- `queue stop <name>`

See `design-docs/specs/design-queue-lifecycle.md` for the detailed phase-3
queue lifecycle behavior and dependency on `P2-ACTIVITY`.

## Bookmark Commands

Phase-2 scope:

- `bookmark add --type <session|message|range> --session <id> --name <name> [--message <id>] [--from <id>] [--to <id>] [--tag <tag>] [--json]`
- `bookmark list [--session <id>] [--type <type>] [--tag <tag>] [--json]`
- `bookmark show <id> [--json]`
- `bookmark delete <id> [--json]`
- `bookmark search <query> [--limit <n>] [--json]`

Bookmark rules:

- `message` and `range` bookmarks require transcript-backed sessions
- pending `chat_only` records may only receive `session` bookmarks until transcript materialization
- message and range bookmark output must preserve raw and display excerpts when available

See `design-docs/specs/design-bookmarks.md` for the detailed behavior, validation, Codex-reference mapping, and Cursor-specific boundaries.

## Activity Command

Phase-2 scope:

```bash
curort-cli-agent activity [--session <id>] [--status <status>] [--limit <n>] [--json]
```

Activity rules:

- activity is derived from local Cursor session index records, managed process state, transcript mtimes, normalized stream events, and stderr/stdout waiting signals
- status values are `idle`, `running`, `waiting_trust`, `waiting_input`, `completed`, and `failed`
- every JSON record must include `provenance: "derived"` plus signal source details
- missing optional signals reduce confidence/provenance detail but must not make list or lookup fail

See `design-docs/specs/design-activity.md` for the detailed behavior, validation, Codex-reference mapping, and Cursor-specific boundaries.

## Markdown Commands

Phase-2 scope:

- `markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]`

Markdown rules:

- extraction is read-only over normalized assistant transcript message text
- stable task records reference Cursor session identity and transcript message IDs
- no transcript, bookmark, server, or SDK mutation happens in this slice

See `design-docs/specs/design-markdown-tasks.md` for the detailed behavior,
validation, Codex-reference mapping, and Cursor-specific boundaries.

## File Commands

Phase-3 scope:

- `files list <session-id>`
- `files snapshots <session-id>`
- `files deleted <session-id>`
- `files find <path>`
- `files rebuild`

Response rules:

- file intelligence is derived from `ai-tracking`, not direct transcript replay
- output must surface provenance and best-effort limitations

## Token Commands

Phase-4 scope:

- `token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]`
- `token list`
- `token revoke <id>`
- `token rotate <id>`

## Skill Commands

Phase-1 scope (read-only discovery):

- `skill list`
- `skill show <name>`

Discovery roots:

- built-in: `~/.cursor/skills-cursor`
- user: `~/.cursor/skills`
- project: `.cursor/skills`

## Server Commands

Phase-4 scope:

- `server start --host <host> --port <port>`
- `server start --host <host> --port <port> [--token <token>]`

Phase-1 behavior: invoking `server` prints a short message and exits with a non-zero code (feature not yet implemented).

Target route groups:

- `/api/health`
- `/api/version`
- `/api/sessions`
- `/api/search`
- `/api/groups`
- `/api/queues`
- `/api/bookmarks`
- `/api/files`

See `design-docs/specs/design-http-server-core.md` for the core route contract.
Bookmark, group, queue, file, and activity routes are enabled only after their
local services are implemented and reviewed.

## Daemon Commands

Phase-4 scope:

- `daemon start`
- `daemon stop`
- `daemon status`

`P4-DAEMON` replaces the earlier placeholder behavior. The command contract is
defined in `design-docs/specs/design-daemon-lifecycle.md`: start supervises the
local HTTP/SSE server, status reports stable human or JSON fields, and stop only
terminates repository-owned daemon processes.

## Tool, Model, and Usage Commands

Phase-5 scope:

- `tool list [--json]`
- `tool show <name> [--json]`
- `tool run <name> --input <json|path> [--json]`
- `tool versions [--include-git] [--include-bun] [--json] [--timeout-ms <ms>]`
- `model check --model <model> [--probe] [--json] [--timeout-ms <ms>]`
- `usage stats [--recent-days <n>] [--json]`

Rules:

- helper commands report repository-owned local tool, version, model, and usage
  evidence; they do not call undocumented Cursor cloud APIs
- `model check --probe` may run a bounded Cursor process and must report the
  result as probe-derived rather than as a durable authorization guarantee
- all JSON responses include provenance and degraded-state fields when optional
  local data sources are absent

See `design-docs/specs/design-tool-registry-model-helpers.md`.

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
| `CURORT_CLI_AGENT_CONFIG_DIR` | No | `~/.config/curort-cli-agent` | Config location |
| `CURORT_CLI_AGENT_DATA_DIR` | No | `~/.local/share/curort-cli-agent` | State and repository data |
| `CURORT_CLI_AGENT_CURSOR_HOME` | No | `~/.cursor` | Override Cursor home for testing |

Compatibility note:

- the implementation may continue to accept legacy `CURSOR_CLI_AGENT_*` variable names during the rename transition, but docs should prefer `CURORT_CLI_AGENT_*`

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
- `files` commands are designed around `ai-tracking` enrichment, so they provide best-effort intelligence rather than exact tool-log replay.
- `transcript search` is separate from `session search` so metadata lookup can
  remain fast and pending chat-only records can remain searchable before
  transcript materialization.
- phase-5 GraphQL and app-server-style compatibility commands are optional
  bridges over normalized local services, not a raw Codex or Cursor protocol
  clone.
