# Markdown Task Extraction Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-markdown-tasks.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-markdown-tasks.md`

### Summary

Implement backlog slice `P2-MARKDOWN-TASKS`: parse assistant markdown from transcript-backed Cursor messages into section and task records without mutating Cursor transcript files.

### Scope

**Included**: markdown task types, pure markdown parser, transcript-backed assistant extraction service, `markdown tasks` CLI command, and focused parser/extractor/CLI tests.

**Excluded**: markdown rendering UI, bookmark storage, server routes, SDK exports, daemon watches, activity summaries, file intelligence, and editing transcript content.

### Codex Reference Mapping

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/markdown/types.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/markdown/parser.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/markdown/parser.test.ts`
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/README.md`

Reference behavior to preserve:

- split markdown into ATX heading sections
- return one default section when markdown has no heading
- extract `- [ ]`, `- [x]`, and `- [X]` tasks
- preserve checked state, trimmed task text, and containing section heading
- treat non-task markdown as non-fatal input

Intentional Cursor divergences accepted by the design:

- Cursor parses assistant transcript rows streamed from `~/.cursor/projects/*/agent-transcripts/*.jsonl` instead of direct Codex markdown inputs.
- Cursor extraction includes `recordId`, `localSessionId`, `cursorChatId`, `transcriptPath`, stable `messageId`, `eventOffset`, and transcript provenance.
- Stable message IDs use the `event-<offset>-<role>` convention established by `P2-TRANSCRIPT-SEARCH`.
- Pending `chat_only` records return empty transcript-provenance results until materialized.

---

## Modules

### 1. Markdown Task Types

#### `src/types/markdown-task.ts`

**Status**: COMPLETED

```typescript
export interface MarkdownSection {
  readonly messageId: string;
  readonly heading: string;
  readonly level: number;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface MarkdownTask {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath: string;
  readonly messageId: string;
  readonly role: "assistant";
  readonly sectionHeading?: string;
  readonly text: string;
  readonly checked: boolean;
  readonly lineNumber: number;
  readonly eventOffset: number;
  readonly byteOffset?: number;
  readonly provenance: "transcript";
}

export interface MarkdownTaskExtractionResult {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath?: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly sections: readonly MarkdownSection[];
  readonly tasks: readonly MarkdownTask[];
  readonly totalTasks: number;
  readonly provenance: "transcript";
}
```

**Checklist**:

- [x] Define immutable section, task, and result contracts.
- [x] Preserve Cursor session identity and transcript provenance.
- [x] Export types for parser, extractor, CLI, and later bookmark/server reuse.

### 2. Pure Markdown Parser

#### `src/markdown/parser.ts`

**Status**: COMPLETED

```typescript
export interface MarkdownParseInput {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath: string;
  readonly messageId: string;
  readonly eventOffset: number;
  readonly byteOffset?: number;
  readonly markdown: string;
}

export interface MarkdownTaskParser {
  parse(input: MarkdownParseInput): {
    readonly sections: readonly MarkdownSection[];
    readonly tasks: readonly MarkdownTask[];
  };
}
```

**Checklist**:

- [x] Parse ATX headings into sections with heading level and line ranges.
- [x] Return one empty-heading section for markdown without headings.
- [x] Parse `- [ ]`, `- [x]`, and `- [X]` task-list items.
- [x] Preserve task line numbers relative to the assistant message text.
- [x] Avoid rendering, network, or transcript-writing dependencies.

### 3. Transcript Task Extraction Service

#### `src/markdown/transcript-tasks.ts`

**Status**: COMPLETED

```typescript
export interface TranscriptMarkdownTaskOptions {
  readonly sessionId: string;
  readonly messageId?: string;
  readonly checked?: boolean;
}

export interface TranscriptMarkdownTaskExtractor {
  extract(options: TranscriptMarkdownTaskOptions): Promise<MarkdownTaskExtractionResult>;
}
```

**Checklist**:

- [x] Resolve `sessionId` through `SessionIndexRepository.resolveSessionKey`.
- [x] Return empty results for non-materialized `chat_only` records consistently with existing CLI behavior.
- [x] Stream transcript rows through `streamTranscriptSearchLines`.
- [x] Parse assistant rows only.
- [x] Attach stable message IDs from event offset and role.
- [x] Apply optional message and checked-state filters deterministically.

### 4. CLI Command

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
curort-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
```

**Checklist**:

- [x] Add `markdown tasks` command routing and usage.
- [x] Validate required `--session`, optional `--message`, and optional `--checked`.
- [x] Render human output with checked state, message ID, section heading, and task text.
- [x] Emit the full `MarkdownTaskExtractionResult` for `--json`.
- [x] Keep existing `transcript search`, `session search`, and bookmark behavior unchanged.

### 5. Tests and Verification Fixtures

#### `src/markdown/parser.test.ts`
#### `src/markdown/transcript-tasks.test.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
describe("markdown task extraction", () => {
  // parser, transcript extraction, and CLI contract tests
});
```

**Checklist**:

- [x] Cover heading sections, no-heading markdown, and empty markdown.
- [x] Cover checked and unchecked task parsing with `-` and `*` bullets.
- [x] Cover assistant-only extraction from transcript rows.
- [x] Cover message ID and checked-state filtering.
- [x] Cover pending `chat_only` records and malformed transcript rows.

---

## Work Breakdown

### TASK-001: Markdown Task Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/markdown-task.ts`
**Dependencies**: `impl-plans/active/transcript-search.md`

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Result contracts include Cursor identity, transcript path, stable message ID, line, offset, and provenance fields.
- [x] Types are exported for parser, extractor, CLI, and future bookmark/server use.

### TASK-002: Pure Parser

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/markdown/parser.ts`, `src/markdown/parser.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Parser extracts headings and task-list items.
- [x] Parser preserves line numbers, checked state, heading level, and section heading.
- [x] Parser tests cover Codex reference behavior and Cursor-required metadata.

### TASK-003: Transcript Extraction

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/markdown/transcript-tasks.ts`, `src/markdown/transcript-tasks.test.ts`
**Dependencies**: TASK-001, TASK-002, `impl-plans/active/transcript-search.md`

**Completion Criteria**:

- [x] Extractor reads transcript-backed assistant messages through Cursor adapter boundaries.
- [x] Message ID filtering uses stable transcript IDs.
- [x] Checked-state filtering is deterministic.
- [x] Pending `chat_only` sessions return empty transcript-provenance results without transcript mutation.

### TASK-004: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [x] `markdown tasks` command validates all supported flags.
- [x] Human and JSON output are deterministic.
- [x] Existing CLI commands remain unchanged.

### TASK-005: Plan Progress and Verification

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `impl-plans/active/markdown-tasks.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] Progress log is updated after implementation.
- [x] `task typecheck`, `task test`, and `task ci` results are recorded.
- [x] Any unresolved user questions are documented before completion.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Markdown task types | `src/types/markdown-task.ts` | Completed | `task typecheck` |
| Pure markdown parser | `src/markdown/parser.ts` | Completed | `src/markdown/parser.test.ts` |
| Transcript extractor | `src/markdown/transcript-tasks.ts` | Completed | `src/markdown/transcript-tasks.test.ts` |
| CLI command | `src/cli/cli.ts` | Completed | `src/cli/cli.test.ts` |
| Plan progress | `impl-plans/active/markdown-tasks.md` | Completed | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-MARKDOWN-TASKS | P2-TRANSCRIPT-SEARCH stable transcript IDs and streaming adapter | Available |
| P2-BOOKMARKS | P2-MARKDOWN-TASKS task/message references | Future phase |
| Server/SDK task views | P2-MARKDOWN-TASKS | Future phase |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts markdown tasks --session <id> --json`
- Manual smoke: `bun run src/main.ts markdown tasks --session <id> --checked false`
- Manual smoke: `bun run src/main.ts markdown tasks --session <id> --message event-0-assistant --json`

## Completion Criteria

- [x] Assistant markdown is parsed into sections and tasks.
- [x] Extraction reads transcript-backed messages without mutating transcripts.
- [x] Results include stable session, message, line, offset, and provenance fields.
- [x] Message ID and checked-state filtering work in CLI output.
- [x] Empty, malformed, or chat-only inputs return deterministic empty results.

## Progress Log

### Session: 2026-05-05 Step 3 Batch Planning

**Tasks Completed**: Created implementation plan for `P2-MARKDOWN-TASKS`.
**Tasks In Progress**: None.
**Blockers**: Waiting for `P2-TRANSCRIPT-SEARCH` stable message IDs and transcript extraction boundary.
**Notes**: Plan is blocked by design dependency, not missing design coverage.

### Session: 2026-05-06 Feature Design Refresh

**Tasks Completed**: Added feature-specific design document and refreshed the blocked implementation plan.
**Tasks In Progress**: None.
**Blockers**: None; `P2-TRANSCRIPT-SEARCH` is completed and provides stable message IDs plus the streaming transcript adapter.
**Notes**: No runtime code was implemented in this planning branch. The plan remains scoped to read-only assistant transcript markdown extraction.

### Session: 2026-05-07 Workflow Repair and Implementation

**Tasks Completed**: Repaired stale `divedra` parity workflow plan-path references, accepted the workflow-authored global parity design refresh, implemented `P2-MARKDOWN-TASKS`, and added parser/extractor/CLI tests.
**Tasks In Progress**: None.
**Blockers**: The attempted `parity-global-design-plan-implement-loop` run stalled after Step 1 repository edits and did not publish its structured step output, so implementation continued locally from the updated design/plan state.
**Notes**: Verification passed with `bun run typecheck`, focused `bun test src/markdown/parser.test.ts src/markdown/transcript-tasks.test.ts src/cli/cli.test.ts`, `task test`, and `task ci`.

## Related Plans

- **Depends On**: `impl-plans/active/transcript-search.md`
- **Related**: `impl-plans/active/bookmarks.md`
