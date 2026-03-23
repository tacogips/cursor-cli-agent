# Architecture Design

This document defines the target architecture for `cursor-cli-agent`.

## Goals

1. Provide a scriptable control plane around `cursor-agent`
2. Discover and inspect existing Cursor sessions from local transcript storage
3. Normalize Cursor's headless stream output into stable internal events
4. Recreate high-value orchestration features already present in `codex-agent`
5. Keep the implementation resilient to Cursor CLI changes by isolating tool-specific adapters
6. Recognize local Cursor skill catalogs without coupling execution to internal built-in skills

## Non-Goals

- Reimplement Cursor's internal protocol
- Depend on undocumented private Cursor cloud APIs
- Require the official Cursor GUI to be running
- Achieve full feature parity with `codex-agent` in phase 1

## Design Drivers

`cursor-cli-agent` differs from `codex-agent` in three structural ways:

1. Cursor persists local transcripts under `~/.cursor/projects/<workspace-slug>/agent-transcripts/*.jsonl`, not under a date hierarchy.
2. Local transcript files are minimal message logs, while richer machine-readable state appears on stdout in `--print --output-format stream-json`.
3. Cursor does not expose a local SQLite session index comparable to Codex state DB, so this project must maintain its own index.
4. Cursor does ship an `ai-tracking` SQLite DB, but it is an enrichment source, not a full conversation store.

## Top-Level Architecture

```text
External Users / Automation
        |
   CLI + SDK Surface
        |
  Application Services
   |- SessionService
   |- GroupService
   |- QueueService
   |- ActivityService
   +- ProcessService
        |
   Cursor Adapters
   |- CursorCommandBuilder
   |- CursorProcessRunner
   |- CursorTranscriptReader
   |- CursorStreamNormalizer
   |- CursorWorkspaceResolver
   |- CursorAiTrackingReader
   +- CursorSkillCatalog
        |
 Persistence and Index
   |- SessionIndexRepository   (SQLite)
   |- GroupRepository          (JSON/SQLite)
   |- QueueRepository          (JSON/SQLite)
   +- BookmarkRepository       (later phase)
        |
   File/Process Watchers
   |- TranscriptWatcher
   |- WorkspaceWatcher
   +- ProcessSupervisor
```

### Phase 1 implementation note

The diagram shows Application Services as a distinct layer. In phase 1, the CLI module (`src/cli/`) orchestrates repositories and Cursor adapters directly. Extracting `SessionService`, `GroupService`, and related facades remains a follow-on refactor once the command surface and persistence APIs stabilize; adapter and persistence boundaries already match the diagram.

## Core Module Boundaries

### 1. Cursor Adapter Layer

This is the only layer that knows Cursor-specific CLI flags, transcript layout, or stream event quirks.

Primary modules:

- `cursor/process-runner` (includes `cursor-agent` argv construction for phase 1; a separate `cursor/command-builder` module is optional if argument assembly grows)
- `cursor/transcript-reader`
- `cursor/stream-normalizer`
- `cursor/workspace-resolver`
- `cursor/ai-tracking-reader`
- `cursor/skill-catalog`

### 2. Domain Layer

Owns stable application semantics that should remain valid even if Cursor changes.

Primary modules:

- `session` / `group` / `queue` (phase 1: orchestrated in `src/cli/` with types in `src/types/`)
- `activity`
- `types`

### 3. Persistence Layer

Owns durable metadata that Cursor does not provide natively.

Primary storage:

- `~/.config/cursor-cli-agent/config.toml`
- `~/.local/share/cursor-cli-agent/state.db`
- `~/.local/share/cursor-cli-agent/groups.json`
- `~/.local/share/cursor-cli-agent/queues.json`

## Session Identity Model

Cursor requires a dual-ID model plus a repository-owned record identity.

### Confirmed IDs

- `localSessionId`: the transcript filename and the `session_id` emitted by `--print`
- `cursorChatId`: the identifier returned by `cursor-agent create-chat`

### Repository-Owned ID

- `recordId`: a stable local primary key stored in `state.db`

### Observed Behavior

- `create-chat` returns a chat ID before any transcript exists
- that chat ID is materialized as the transcript/session ID when the first `--resume <chatId> <prompt>` prompt is sent
- a fresh headless run without `create-chat` creates a new `localSessionId` immediately

### Internal Model

```ts
interface CursorSessionRecord {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly identityState: "chat_only" | "transcript_only" | "linked";
  readonly workspaceSlug: string;
  readonly workspacePath?: string;
  readonly transcriptPath?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly materializedAt?: string;
  readonly source: "create-chat" | "headless" | "interactive" | "unknown";
  readonly model?: string;
  readonly mode?: "default" | "plan" | "ask";
  readonly status: "pending" | "active" | "completed" | "failed" | "unknown";
  readonly firstUserText?: string;
  readonly lastAssistantText?: string;
}
```

Record invariants:

1. at least one of `localSessionId` or `cursorChatId` must be present
2. `transcriptPath` is required only after transcript materialization
3. `session create` persists a `chat_only` record before any transcript exists
4. `session run` without `create-chat` persists a `transcript_only` record
5. `session resume <chatId>` upgrades a matching `chat_only` record to `linked` when the transcript appears

## Workspace Resolution Strategy

Cursor project directories are stored under slugged paths such as:

```text
~/.cursor/projects/g-gits-tacogips-cursor-cli-agent
```

Transcript files do not contain the workspace path in the observed JSONL format, so `cursor-cli-agent` must resolve workspace context using:

1. `system.init.cwd` from headless `stream-json` when sessions are spawned by this tool
2. the current workspace passed explicitly by the caller
3. `worker.log`, which contains `workspacePath=...` entries
4. a best-effort local registry in `state.db`

## AI Tracking Enrichment Strategy

Observed local DB:

- `~/.cursor/ai-tracking/ai-code-tracking.db`

Observed useful tables:

- `ai_code_hashes`
- `tracked_file_content`
- `ai_deleted_files`
- `scored_commits`
- `conversation_summaries` (schema exists, currently empty in this environment)

Design position:

1. transcripts remain the source of truth for conversation text
2. `ai-code-tracking.db` is an optional enrichment source
3. joins should key primarily on `conversationId == localSessionId`
4. absence of DB rows must not hide or invalidate sessions

## Skill Catalog Strategy

Observed local roots:

- built-in skills: `~/.cursor/skills-cursor/`
- user skills: `~/.cursor/skills/`
- project skills: `.cursor/skills/`

Design position:

1. `skills-cursor` should be indexed as built-in metadata
2. user and project skills should be indexed as user-extensible assets
3. no phase-1 runtime behavior should depend on built-in skill names or bodies
4. writes must never target `skills-cursor`

Example internal type:

```ts
interface CursorSkillRecord {
  readonly name: string;
  readonly description?: string;
  readonly scope: "builtin" | "user" | "project";
  readonly path: string;
  readonly disableModelInvocation: boolean;
}
```

## Session Ingestion Paths

### A. Foreign Session Discovery

Used for sessions created outside `cursor-cli-agent`.

1. Scan `~/.cursor/projects/*/agent-transcripts/*.jsonl`
2. Infer `workspaceSlug` from the parent directory
3. Read transcript line count, timestamps, first user text, last assistant text
4. Resolve workspace path from `worker.log` if possible
5. Upsert into local SQLite index

### B. Managed Headless Run

Used when `cursor-cli-agent` itself starts a run.

1. Spawn `cursor-agent --print --trust --output-format stream-json`
2. Read `system.init` to capture `session_id`, `cwd`, `model`, `permissionMode`
3. Stream normalized events to CLI/SDK callers
4. Watch transcript file materialization and append events
5. Merge optional `ai-tracking` enrichment keyed by `session_id`
6. Persist durable session metadata into local index

### C. Pre-Materialized Chat Creation

Used when `cursor-cli-agent` wraps `cursor-agent create-chat`.

1. Invoke `cursor-agent create-chat`
2. Persist a `chat_only` session record keyed by local `recordId`
3. Store returned `cursorChatId`, caller workspace, and `pending` status
4. Resolve later `resume <chatId>` materialization to the existing record instead of creating a duplicate

## Event Normalization Model

Cursor stream-json should be normalized into stable internal events:

```ts
interface NormalizedMessage {
  readonly role: "user" | "assistant";
  readonly rawText: string;
  readonly displayText: string;
  readonly structured?: {
    readonly userQueryText?: string;
  };
}

type AgentEvent =
  | { type: "session.started"; sessionId: string; cwd: string; model?: string }
  | { type: "session.pending"; recordId: string; cursorChatId: string; workspacePath?: string }
  | { type: "session.materialized"; recordId: string; sessionId: string; cursorChatId?: string }
  | { type: "session.user_message"; sessionId: string; message: NormalizedMessage }
  | { type: "session.thinking"; sessionId: string; state: "delta" | "completed" }
  | { type: "session.assistant_message"; sessionId: string; message: NormalizedMessage }
  | { type: "session.completed"; sessionId: string; result: string; usage?: UsageStats }
  | { type: "session.error"; sessionId?: string; message: string };
```

This keeps Cursor-specific payloads out of higher layers.

Normalization rules:

1. transcript replay and live `stream-json` events must produce the same `NormalizedMessage` shape
2. `rawText` preserves Cursor-stored content verbatim
3. `displayText` may unwrap recognized wrapper tags such as `<user_query>...</user_query>`
4. machine-readable outputs must retain both raw and display forms to avoid information loss
5. pending chat-only records may emit `session.pending` before any transcript-backed `sessionId` exists

## Orchestration Model

### Groups

Groups coordinate multiple sessions against one workspace set. They should reuse the same group and queue concepts from `codex-agent`, but use Cursor headless runs as the execution primitive.

### Queues

Queues serialize prompts against one workspace or one target session.

Execution modes:

- create a new session
- resume a known session
- continue the latest session for a workspace

## Server and Daemon

The daemon/server layer remains a phase-2 concern.

It should expose:

- session listing
- session detail
- transcript streaming
- group/queue control
- health/version endpoints

It should not expose raw Cursor internals directly.

## Key Architecture Decisions

### Decision 1: Own the session index

Reason:

- Cursor does not expose a stable local DB for sessions
- transcript files are insufficient for fast querying by themselves

### Decision 2: Treat stdout stream as richer than transcript files

Reason:

- transcripts only show persisted messages
- stream-json contains startup metadata, thinking events, and result usage
- both must converge on the same normalized message model for replay and live watch

### Decision 2.5: Use `ai-code-tracking.db` as enrichment only

Reason:

- it contains valuable per-conversation metadata
- it does not replace transcripts as a canonical conversation log
- some tables are sparse or empty, so the system cannot depend on them unconditionally

### Decision 3: Separate Cursor adapters from domain services

Reason:

- reduces blast radius when `cursor-agent` CLI flags or event shapes change

### Decision 4: Support both imported and managed sessions

Reason:

- users already have existing Cursor transcripts
- the tool should add value immediately without requiring all sessions to originate here

### Decision 5: Treat `skills-cursor` as inspectable but non-authoritative

Reason:

- it is locally available and useful
- built-in skill docs explicitly mark it as Cursor-managed internal storage
- depending on it as an execution contract would be brittle
