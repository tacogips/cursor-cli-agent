# Transcript Full-Text Search

This document defines the phase-2 `P2-TRANSCRIPT-SEARCH` slice for searching Cursor transcript message content.

## Overview

`transcript search` must scan local Cursor JSONL transcript files for message-text matches. This is separate from `session search`, which remains metadata-only against the repository-owned session index.

The goal is to expose exact transcript content search with stable pagination, role filters, scan budgets, and explicit transcript provenance without mutating Cursor files or introducing server, SDK, bookmark, activity, or file-intelligence behavior.

## Source Issue Mapping

- Backlog ID: `P2-TRANSCRIPT-SEARCH`
- Parent workflow: `parity-global-design-plan-implement-loop`
- Delegated workflow: `design-and-implement-review-loop`
- Requested behavior: implement transcript full-text search across Cursor JSONL transcripts
- Scope boundary: read-only local transcript scanning through Cursor adapter modules
- Dependency: `P2-SESSION-SEARCH` must be available so transcript candidates can preserve Cursor session identity

## Codex Reference Mapping

Use `/Users/taco/gits/tacogips/codex-agent` as the local parity reference.

Relevant reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/session/search.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/search.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/types/session.ts`

Reference behavior to preserve:

- reject blank search queries
- support Codex-compatible transcript role filtering for user and assistant message text
- enforce `limit`, `offset`, `maxSessions`, `maxBytes`, and `maxEvents`
- expose scan counters and truncation or timeout state
- use deterministic candidate ordering and pagination
- test malformed or partial transcript data as non-fatal scan input

Intentional Cursor adaptation:

- Codex scans rollout JSONL items with richer typed events; Cursor scans `~/.cursor/projects/*/agent-transcripts/*.jsonl` message rows
- Codex returns Codex session IDs; Cursor results must include `recordId`, `localSessionId`, `cursorChatId`, and transcript path when available
- Codex role filtering is limited to user, assistant, and both; Cursor additionally accepts `system` and `tool` only when the transcript adapter can normalize observed Cursor rows into those roles
- Cursor message IDs are synthetic and stable, derived from transcript position, because the observed Cursor transcript schema does not provide per-message IDs
- Pending `chat_only` records have no transcript content and therefore produce no transcript hits until materialization

## Search Inputs

The CLI command is:

```bash
curort-cli-agent transcript search <query> [filters]
```

Primary flags for this slice:

- `--session <id>`: restrict search to a known `recordId`, `localSessionId`, or `cursorChatId`
- `--role <user|assistant|system|tool>`: restrict matches to one role. `user` and `assistant` are Codex-compatible; `system` and `tool` are Cursor-specific extensions that return no matches when the transcript adapter cannot identify those role rows.
- `--limit <n>`: positive integer page size
- `--offset <n>`: non-negative integer page offset
- `--max-sessions <n>`: positive integer cap on candidate transcript files
- `--max-bytes <n>`: positive integer cap on scanned bytes
- `--max-events <n>`: positive integer cap on scanned transcript rows
- `--json`: emit the structured result contract

Default matching is case-insensitive substring matching over normalized transcript message text. The raw transcript text remains the source for message identity and excerpts; display text may be used for human rendering only after adapter normalization.

## Result Contract

JSON output should return:

- `query`
- `hits`
- `total`
- `offset`
- `limit`
- `scannedSessions`
- `scannedBytes`
- `scannedEvents`
- `truncated`
- `timedOut`

Each hit should include:

- `recordId`
- `localSessionId`
- `cursorChatId`
- `transcriptPath`
- `messageId`
- `role`
- `excerpt`
- `eventOffset`
- `byteOffset` when known
- `provenance: "transcript"`

Human output should show enough identity to resume inspection: display session ID, role, message ID, excerpt, and a truncation notice when budgets stop scanning before all candidates are exhausted.

## Data Flow

1. CLI parses `transcript search <query>` and validates filters, pagination, and scan budgets.
2. The search service obtains candidate sessions from the repository-owned session index in deterministic `updatedAt DESC`, then `recordId ASC` order.
3. `--session` resolution accepts known `recordId`, `localSessionId`, or `cursorChatId` and narrows the candidate set to the matching transcript-backed record.
4. Transcript content is read through `src/cursor/transcript-reader.ts` or a sibling Cursor adapter, not directly inside CLI parsing code.
5. The scanner streams JSONL rows and avoids loading large transcript files fully into memory.
6. Role filters, byte budgets, event budgets, session budgets, and timeout checks are applied during scanning.
7. Hits receive stable synthetic message IDs derived from transcript position, such as transcript event offset plus role.
8. Pagination is applied over matching hits after deterministic candidate ordering.
9. The CLI renders human output or JSON output.

## Validation Rules

- Missing or blank `<query>` returns a usage error.
- `--role` accepts only `user`, `assistant`, `system`, or `tool`; unsupported or unobserved Cursor row roles are ignored as non-matching input rather than coerced.
- `--limit`, `--max-sessions`, `--max-bytes`, and `--max-events` must be positive integers.
- `--offset` must be a non-negative integer.
- Unknown `--session` targets return an empty result or a not-found usage error consistently with existing session commands.
- Malformed transcript lines are skipped as non-fatal scan input and should not abort the entire search.

## Cursor CLI Behavior Mapping

No new Cursor CLI invocation is required for this slice. Search reads local state from:

- `~/.cursor/projects/*/agent-transcripts/*.jsonl`
- the local `state.db` session index

Cursor-specific behavior remains isolated behind adapter and persistence boundaries:

- transcript parsing stays under `src/cursor/`
- session identity and candidate ordering are supplied by `src/persistence/session-index.ts`
- CLI code should not parse raw Cursor transcript payloads directly
- transcript files are read-only inputs and must never be rewritten

## Rollout Constraints

- The feature must work when no transcript-backed sessions exist and return an empty result, not a crash.
- Pending chat-only records are excluded from transcript hits until a transcript materializes.
- Existing `session search` metadata behavior must remain unchanged.
- This slice should not introduce bookmark storage, markdown extraction, activity summaries, server routes, daemon behavior, or SDK exports.
- Stable message IDs are a prerequisite for later `P2-BOOKMARKS` and `P2-MARKDOWN-TASKS` slices.

## Open Questions

None for this slice.

## References

See `design-docs/specs/command.md`, `design-docs/specs/architecture.md`, `design-docs/specs/design-session-search.md`, and `design-docs/specs/design-codex-agent-parity-gap.md`.
