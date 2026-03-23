# Cursor Session Management - Research and Design

This document captures the confirmed local behavior of `cursor-agent` and the resulting design for `cursor-cli-agent`.

Design baseline date:

- 2026-03-23
- local CLI version: `2026.02.27-e7d2ef6`

## 1. Confirmed Local Cursor CLI Surface

Observed from `cursor-agent --help`:

- interactive default command: `cursor-agent [prompt...]`
- headless/script mode: `--print`
- structured output modes: `--output-format text|json|stream-json`
- partial stream support: `--stream-partial-output`
- session controls: `--resume [chatId]`, `--continue`, `create-chat`, `resume`, `ls`
- execution controls: `--mode plan|ask`, `--model`, `--sandbox`, `--force`, `--yolo`, `--approve-mcps`, `--trust`
- workspace controls: `--workspace`, `--worktree`, `--worktree-base`

## 2. Confirmed Local Storage Layout

Observed under `~/.cursor`:

```text
~/.cursor/
  agent-cli-state.json
  ai-tracking/
  skills-cursor/
    <skill-name>/
      SKILL.md
  projects/
    <workspace-slug>/
      .workspace-trusted
      agent-transcripts/
        <session-id>.jsonl
      repo.json
      worker.log
```

Examples observed locally:

```text
~/.cursor/projects/g-gits-tacogips-cursor-cli-agent/agent-transcripts/16861d2c-5b04-4960-8068-2a4ba1228a5d.jsonl
~/.cursor/projects/g-gits-tacogips-cursor-cli-agent/worker.log
~/.cursor/skills-cursor/create-skill/SKILL.md
```

### Skill Catalog Observation

Built-in skill files exist locally under `~/.cursor/skills-cursor/`.

Observed examples:

- `create-rule`
- `create-skill`
- `create-subagent`
- `migrate-to-skills`
- `update-cursor-settings`

One built-in skill explicitly states:

- `~/.cursor/skills-cursor/` is reserved for Cursor internal built-in skills
- user-authored skills belong in `~/.cursor/skills/` or project `.cursor/skills/`

## 3. Transcript Format

Observed transcript lines are simple JSON objects with `role` and `message.content[]`.

Example:

```json
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\nReply with exactly OK\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}
```

### Implications

- transcript files preserve user/assistant content
- transcripts do not, in the observed format, embed cwd, model, token usage, or timing metadata
- transcripts are append-only session logs and are good for history playback, but insufficient as a complete metadata source
- transcript text may contain wrapper markup such as `<user_query>...</user_query>` inside `message.content[].text`

### Message Extraction Strategy

`cursor-cli-agent` should distinguish three layers when reading transcript messages:

1. `rawText`: exact text stored in the transcript content block
2. `displayText`: human-oriented text after unwrapping known wrapper tags when safe
3. `structured`: optional semantic extraction such as `userQueryText`

Initial phase-1 rules:

- preserve `rawText` exactly as stored
- when a text block is fully wrapped by `<user_query>...</user_query>`, set:
  - `displayText` to the inner text
  - `structured.userQueryText` to the same inner text
- otherwise, keep `displayText == rawText`
- never discard the original wrapper-marked text from machine-readable output
- unknown wrapper tags must not fail parsing; they remain raw text until explicitly supported
- unknown non-text content blocks must be preserved as opaque metadata and ignored for summary extraction

### Confirmed Use

The transcript filenames under:

- `~/.cursor/projects/<workspace>/agent-transcripts/*.jsonl`

are valid conversation-level identifiers and can be used directly for:

- conversation listing
- first-user / latest-assistant summaries
- full message replay
- joins against `ai-code-tracking.db` via `conversationId`

## 4. Headless JSON Output

### 4.1 `--output-format json`

Observed result shape:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 6940,
  "duration_api_ms": 6940,
  "result": "\nOK",
  "session_id": "16861d2c-5b04-4960-8068-2a4ba1228a5d",
  "request_id": "41126ad5-3d57-418e-8552-b685d4f389f5",
  "usage": {
    "inputTokens": 7363,
    "outputTokens": 22,
    "cacheReadTokens": 4992,
    "cacheWriteTokens": 0
  }
}
```

### 4.2 `--output-format stream-json --stream-partial-output`

Observed event sequence:

```json
{"type":"system","subtype":"init","cwd":"/g/gits/tacogips/cursor-cli-agent","session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf","model":"Composer 2 Fast","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with exactly STREAM"}]},"session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf"}
{"type":"thinking","subtype":"delta","text":"","session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf","timestamp_ms":1774244961275}
{"type":"thinking","subtype":"completed","session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf","timestamp_ms":1774244961313}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"\nSTREAM"}]},"session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf","timestamp_ms":1774244961314}
{"type":"result","subtype":"success","duration_ms":6562,"duration_api_ms":6562,"is_error":false,"result":"\nSTREAM","session_id":"658ae48e-6b4b-4724-a53f-7188bf1da5bf","request_id":"99b19e30-a0b3-4b31-b466-5a6f1be69498","usage":{"inputTokens":7363,"outputTokens":28,"cacheReadTokens":864,"cacheWriteTokens":0}}
```

### Implications

- `stream-json` is the richest machine-readable interface available locally
- it includes metadata not present in transcript files
- it duplicates some assistant payloads and also emits a final `result`, so a normalizer must deduplicate presentation events

## 5. Session ID Lifecycle

### Confirmed Observations

1. `cursor-agent create-chat` returned `14c9917d-86df-4542-9f0e-5203bc4d029e`
2. no transcript file was created immediately after `create-chat`
3. a fresh headless run without `create-chat` produced a new transcript-backed `session_id`
4. `cursor-agent --resume 16861d2c-...` resumed an existing local transcript session
5. `cursor-agent --resume 14c9917d-...` created and resumed a transcript whose filename matched that earlier chat ID

### Design Interpretation

The CLI supports a pre-materialized chat identity that may exist before local transcript creation.

Therefore `cursor-cli-agent` must model:

- `cursorChatId`: a resumable chat identifier
- `localSessionId`: the persisted transcript/session identifier

In many cases they will become equal, but the design must not assume they always start equal.

### Design Response

`cursor-cli-agent` must persist a local session record even before transcript materialization.

Required lifecycle states:

- `chat_only`: created by `session create`; has `cursorChatId`, no transcript yet
- `transcript_only`: created by direct headless execution; has `localSessionId`
- `linked`: chat-backed record after transcript materialization; may have both IDs

Required record behavior:

1. `session create` stores a pending record keyed by a local repository ID
2. `session list` and `session show` must surface pending `chat_only` records clearly
3. `session resume <chatId>` must link transcript materialization back to the existing pending record
4. imported transcript sessions may exist without any `cursorChatId`
5. message retrieval for transcript-backed sessions must preserve both `rawText` and `displayText`

## 6. Workspace Trust Behavior

Confirmed locally:

- headless execution in a new workspace fails without trust confirmation
- the CLI instructs callers to use `--trust`, `--yolo`, or `-f`

Observed error shape:

```text
Workspace Trust Required
Cursor Agent can execute code and access files in this directory.
```

### Design Response

- expose a dedicated exit code for trust failures
- surface a first-class `--trust` flag in `cursor-cli-agent`
- persist trust-related failures as structured session/process errors

## 7. Workspace Mapping

Confirmed locally:

- project folders are stored under slug-like directory names
- `worker.log` contains `workspacePath=/absolute/path`

Observed example:

```text
[info] Getting tree structure for workspacePath=/g/gits/tacogips/cursor-cli-agent
```

### Design Response

Workspace resolution order:

1. `system.init.cwd` from headless runs
2. explicit `--workspace` from caller
3. latest `workspacePath=` entry in `worker.log`
4. best-effort registry lookup in local index

The explicit caller workspace is preferred over `worker.log` because:

- `session create` needs a stable workspace association before any transcript exists
- `worker.log` is an inferred fallback, not an authoritative command input

## 7.5 Skill Sources

For `cursor-cli-agent`, local skill data can be read from three sources:

1. built-in skill catalog: `~/.cursor/skills-cursor/`
2. user skill catalog: `~/.cursor/skills/`
3. project skill catalog: `<workspace>/.cursor/skills/`

Design response:

- phase 1 may read these for inspection and metadata indexing
- phase 1 should not assume built-in skills are stable execution primitives
- write operations must target user/project skill directories, never `skills-cursor`

## 7.6 AI Tracking Database

Confirmed local DB:

- `~/.cursor/ai-tracking/ai-code-tracking.db`

Confirmed tables:

- `ai_code_hashes`
- `ai_deleted_files`
- `conversation_summaries`
- `scored_commits`
- `tracked_file_content`
- `tracking_state`

### Observed Table Semantics

#### `ai_code_hashes`

Useful columns:

- `conversationId`
- `fileName`
- `fileExtension`
- `requestId`
- `timestamp`
- `model`
- `source`

Observed use:

- very high-volume per-conversation file-touch history
- includes absolute file paths in `fileName`
- `conversationId` matches transcript IDs

#### `tracked_file_content`

Useful columns:

- `gitPath`
- `content`
- `conversationId`
- `model`
- `fileExtension`
- `createdAt`

Observed use:

- stores full file snapshots for some conversations
- sparse in this environment, but valuable when present

#### `ai_deleted_files`

Useful columns:

- `gitPath`
- `conversationId`
- `model`
- `deletedAt`

Observed use:

- deleted-file audit trail for some conversations

#### `scored_commits`

Useful columns:

- `commitHash`
- `branchName`
- `commitMessage`
- `commitDate`
- `composerLinesAdded`
- `composerLinesDeleted`
- `v1AiPercentage`
- `v2AiPercentage`

Observed use:

- commit-level AI attribution and line statistics
- not keyed by `conversationId`, but still useful for repository analytics

#### `conversation_summaries`

Useful columns:

- `conversationId`
- `title`
- `tldr`
- `overview`
- `summaryBullets`
- `model`
- `mode`
- `updatedAt`

Observed use:

- schema exists, but row count was `0` in this environment
- should be treated as optional future enrichment

### Design Response

`cursor-cli-agent` should add an optional `AiTrackingEnricher` that:

1. joins transcript sessions to DB rows via `conversationId`
2. derives touched-file summaries from `ai_code_hashes`
3. derives deleted-file summaries from `ai_deleted_files`
4. exposes tracked file snapshots from `tracked_file_content` when present
5. never requires `ai-code-tracking.db` for base session listing

## 8. Comparison to Codex

| Aspect | Codex (`codex-agent`) | Cursor (`cursor-cli-agent`) |
|--------|------------------------|-----------------------------|
| Primary local session file | rollout JSONL with typed items | transcript JSONL with message rows |
| Rich metadata source | rollout + SQLite state DB | headless stdout stream-json |
| Built-in local index | Yes | no full session index observed |
| Local enrichment DB | rollout DB already session-centric | `ai-code-tracking.db` provides partial enrichment |
| Local built-in skill catalog | Not relevant to core design | `~/.cursor/skills-cursor` exists |
| Pre-created chat id without transcript | No | Yes |
| Native fork command | Yes | Not observed |
| Workspace trust gate | separate policies | explicit trust prompt in CLI |

## 9. Proposed Internal Components

### 9.1 `CursorTranscriptReader`

Responsibilities:

- read transcript files
- parse `role`/`message.content[]`
- extract first user prompt and latest assistant reply
- derive `rawText`, `displayText`, and optional `structured.userQueryText`
- tolerate unknown content block types

### 9.2 `CursorStreamNormalizer`

Responsibilities:

- parse `stream-json` events
- normalize to internal `AgentEvent`
- derive the same message view model as transcript replay
- deduplicate repeated assistant terminal payloads
- retain usage stats from final `result`

### 9.3 `CursorSessionIndex`

Responsibilities:

- scan `~/.cursor/projects`
- correlate workspace slug, workspace path, transcript file, and known chat IDs
- cache summarized metadata in local SQLite

### 9.4 `CursorProcessManager`

Responsibilities:

- spawn new runs
- resume by session/chat ID
- continue latest workspace session
- handle trust failures and structured stdout parsing

### 9.5 `CursorSkillCatalog`

Responsibilities:

- discover built-in, user, and project skill roots
- parse `SKILL.md` frontmatter
- expose read-only metadata for inspection and future UX
- enforce that writes never target `skills-cursor`

### 9.6 `CursorAiTrackingReader`

Responsibilities:

- open `ai-code-tracking.db` when available
- read table schemas defensively
- aggregate per-conversation file touches and deletions
- expose tracked file snapshots when present
- tolerate missing tables or empty datasets

## 10. Open Questions

These points were not fully resolved by local observation alone:

1. whether `repo.json` can be used to stably recover workspace path beyond a repo-local ID
2. whether interactive sessions always write the same transcript schema as headless runs
3. whether `ai-tracking/ai-code-tracking.db` contains reusable session metadata
4. whether future Cursor versions will add non-message transcript item types
5. whether `cursor-agent` exposes any direct CLI command to list or invoke skills beyond prompt-driven use

After local inspection on 2026-03-23, question 3 is partially resolved:

- yes, `ai-code-tracking.db` contains reusable per-conversation enrichment
- no, it should not replace transcript parsing as the base session source

## 11. Implementation Priorities

| Priority | Feature | Reason |
|----------|---------|--------|
| P0 | Transcript reader | foundation for imported sessions |
| P0 | Stream normalizer | foundation for managed sessions |
| P0 | Session index | required because Cursor lacks a public local index |
| P1 | Process manager | enables run/resume/continue/create |
| P1 | CLI session commands | minimal usable product including show/watch/attach |
| P1 | Watchers/activity | required for phase-1 `session watch` behavior |
| P1 | Group/queue managers | included in phase-1 foundational orchestration |
| P3 | Server/daemon | integration layer after core stabilizes |
