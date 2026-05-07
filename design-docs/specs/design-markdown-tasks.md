# Markdown Task Extraction

This document defines the phase-2 `P2-MARKDOWN-TASKS` slice for deriving markdown sections and task-list items from assistant messages in local Cursor transcripts.

## Overview

`markdown tasks` must parse assistant-authored markdown from transcript-backed Cursor sessions into structured section and task records. The feature is read-only: Cursor transcript JSONL files remain the source of truth and must never be rewritten, annotated, or normalized in place.

This slice depends on `P2-TRANSCRIPT-SEARCH` for stable transcript message identity and the streaming transcript adapter. It does not add markdown rendering, bookmark storage, activity summaries, server routes, SDK exports, or transcript mutation.

## Source Issue Mapping

- Backlog ID: `P2-MARKDOWN-TASKS`
- Parent workflow: `parity-global-design-plan-implement-loop`
- Delegated workflow: `design-and-implement-review-loop`
- Requested behavior: parse assistant transcript markdown into sections and task lists without mutating Cursor transcripts
- Scope boundary: read-only local transcript scanning through Cursor adapter modules
- Dependency: `P2-TRANSCRIPT-SEARCH` must be available so extracted tasks can reference stable transcript message IDs

## Codex Reference Mapping

Use `/Users/taco/gits/tacogips/codex-agent` as the local parity reference.

Relevant reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/markdown/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/README.md`

Reference behavior to preserve:

- split markdown into ATX heading-based sections
- return one default section for markdown with no headings
- extract `- [ ]`, `- [x]`, and `- [X]` task-list items
- preserve task checked state and trimmed task text
- associate tasks with the containing section heading
- keep malformed or non-task markdown as non-fatal input

Intentional Cursor adaptation:

- Codex parses direct markdown strings; Cursor parses assistant message text streamed from `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- Cursor extraction must include `recordId`, `localSessionId`, `cursorChatId`, `transcriptPath`, `messageId`, and `eventOffset` where available
- Cursor message IDs use the stable `event-<offset>-<role>` convention established by `P2-TRANSCRIPT-SEARCH`
- extraction filters to assistant messages because the requested behavior targets assistant transcript markdown
- pending `chat_only` records return empty transcript-provenance results until a transcript materializes

## CLI Behavior

The CLI command is:

```bash
curort-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
```

Primary flags:

- `--session <id>`: required; resolves a known `recordId`, `localSessionId`, or `cursorChatId`
- `--message <id>`: optional stable transcript message ID filter
- `--checked <true|false>`: optional task checked-state filter
- `--json`: emit the structured result contract

Human output should show display session identity, message ID, section heading when present, checked state, and task text. JSON output should return all extraction metadata needed by later bookmark, server, or SDK work without forcing those surfaces into this slice.

## Result Contract

JSON output should return:

- `recordId`
- `localSessionId`
- `cursorChatId`
- `transcriptPath`
- `sessionId`
- `messageId` when the request is message-filtered
- `sections`
- `tasks`
- `totalTasks`
- `provenance: "transcript"`

Each section should include:

- `messageId`
- `heading`
- `level`
- `content`
- `startLine`
- `endLine`

Each task should include:

- `recordId`
- `localSessionId`
- `cursorChatId`
- `transcriptPath`
- `messageId`
- `role: "assistant"`
- `sectionHeading`
- `text`
- `checked`
- `lineNumber`
- `eventOffset`
- `byteOffset` when known
- `provenance: "transcript"`

## Data Flow

1. CLI parses `markdown tasks` and validates `--session`, optional `--message`, and optional `--checked`.
2. The extraction service resolves `--session` through `SessionIndexRepository.resolveSessionKey`.
3. Records without `transcriptPath` return an empty result with transcript provenance and no Cursor file mutation.
4. The service streams transcript rows through `src/cursor/transcript-reader.ts`, reusing the `P2-TRANSCRIPT-SEARCH` adapter boundary.
5. Non-assistant transcript rows are ignored.
6. The pure markdown parser splits assistant text into sections and tasks, preserving line numbers relative to the assistant message text.
7. The extractor attaches Cursor session identity, transcript path, stable message ID, transcript offsets, and provenance.
8. Optional message and checked-state filters are applied deterministically.
9. The CLI renders human or JSON output.

## Validation Rules

- Missing `--session` is a usage error.
- Unknown `--session` follows existing session command not-found behavior.
- `--message` must match the stable transcript message ID format used by transcript search.
- `--checked` accepts only `true` or `false`.
- Malformed transcript rows are skipped by the transcript adapter and must not abort the extraction.
- Markdown without headings returns a default empty-heading section.
- Markdown without task-list items returns sections and an empty task list.

## Cursor Boundary Rules

No new Cursor CLI invocation is required for this slice. The feature reads local state from:

- `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- the repository-owned `state.db` session index

Cursor-specific behavior remains isolated:

- transcript streaming and row normalization stay under `src/cursor/`
- session identity resolution stays under `src/persistence/session-index.ts`
- CLI code must not parse raw Cursor transcript payloads directly
- Cursor transcript files and Cursor-managed directories remain read-only

## Open Questions

None for this slice.

## References

See `design-docs/specs/architecture.md`, `design-docs/specs/design-transcript-search.md`, `design-docs/specs/design-bookmarks.md`, and `design-docs/references/README.md`.
