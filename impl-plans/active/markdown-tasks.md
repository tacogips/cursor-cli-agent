# Markdown Task Extraction Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-markdown-tasks.md`
**Created**: 2026-05-05
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-markdown-tasks.md`

### Summary

Implement backlog slice `P2-MARKDOWN-TASKS`: parse assistant markdown from transcript-backed Cursor messages into section and task records without mutating Cursor transcript files.

### Scope

**Included**: markdown task types, pure markdown parser, transcript-backed assistant extraction service, `markdown tasks` CLI command, and focused parser/extractor/CLI tests.

**Excluded**: markdown rendering UI, bookmark storage, server routes, SDK exports, daemon watches, activity summaries, file intelligence, and editing transcript content.

### Codex Reference Mapping

- `/Users/taco/gits/tacogips/codex-agent/src/markdown/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/README.md`

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

**Status**: NOT_STARTED

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

- [ ] Define immutable section, task, and result contracts.
- [ ] Preserve Cursor session identity and transcript provenance.
- [ ] Export types for parser, extractor, CLI, and later bookmark/server reuse.

### 2. Pure Markdown Parser

#### `src/markdown/parser.ts`

**Status**: NOT_STARTED

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

- [ ] Parse ATX headings into sections with heading level and line ranges.
- [ ] Return one empty-heading section for markdown without headings.
- [ ] Parse `- [ ]`, `- [x]`, and `- [X]` task-list items.
- [ ] Preserve task line numbers relative to the assistant message text.
- [ ] Avoid rendering, network, or transcript-writing dependencies.

### 3. Transcript Task Extraction Service

#### `src/markdown/transcript-tasks.ts`

**Status**: NOT_STARTED

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

- [ ] Resolve `sessionId` through `SessionIndexRepository.resolveSessionKey`.
- [ ] Return empty results for unknown or non-materialized `chat_only` records consistently with existing CLI behavior.
- [ ] Stream transcript rows through `streamTranscriptSearchLines`.
- [ ] Parse assistant rows only.
- [ ] Attach stable message IDs from event offset and role.
- [ ] Apply optional message and checked-state filters deterministically.

### 4. CLI Command

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
```

**Checklist**:

- [ ] Add `markdown tasks` command routing and usage.
- [ ] Validate required `--session`, optional `--message`, and optional `--checked`.
- [ ] Render human output with checked state, message ID, section heading, and task text.
- [ ] Emit the full `MarkdownTaskExtractionResult` for `--json`.
- [ ] Keep existing `transcript search`, `session search`, and bookmark behavior unchanged.

### 5. Tests and Verification Fixtures

#### `src/markdown/parser.test.ts`
#### `src/markdown/transcript-tasks.test.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
describe("markdown task extraction", () => {
  // parser, transcript extraction, and CLI contract tests
});
```

**Checklist**:

- [ ] Cover heading sections, no-heading markdown, and empty markdown.
- [ ] Cover checked and unchecked task parsing with `-` and `*` bullets.
- [ ] Cover assistant-only extraction from transcript rows.
- [ ] Cover message ID and checked-state filtering.
- [ ] Cover pending `chat_only` records and malformed transcript rows.

---

## Work Breakdown

### TASK-001: Markdown Task Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/markdown-task.ts`
**Dependencies**: `impl-plans/active/transcript-search.md`

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Result contracts include Cursor identity, transcript path, stable message ID, line, offset, and provenance fields.
- [ ] Types are exported for parser, extractor, CLI, and future bookmark/server use.

### TASK-002: Pure Parser

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/markdown/parser.ts`, `src/markdown/parser.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [ ] Parser extracts headings and task-list items.
- [ ] Parser preserves line numbers, checked state, heading level, and section heading.
- [ ] Parser tests cover Codex reference behavior and Cursor-required metadata.

### TASK-003: Transcript Extraction

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/markdown/transcript-tasks.ts`, `src/markdown/transcript-tasks.test.ts`
**Dependencies**: TASK-001, TASK-002, `impl-plans/active/transcript-search.md`

**Completion Criteria**:

- [ ] Extractor reads transcript-backed assistant messages through Cursor adapter boundaries.
- [ ] Message ID filtering uses stable transcript IDs.
- [ ] Checked-state filtering is deterministic.
- [ ] Pending `chat_only` sessions return empty transcript-provenance results without transcript mutation.

### TASK-004: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-003

**Completion Criteria**:

- [ ] `markdown tasks` command validates all supported flags.
- [ ] Human and JSON output are deterministic.
- [ ] Existing CLI commands remain unchanged.

### TASK-005: Plan Progress and Verification

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `impl-plans/active/markdown-tasks.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [ ] Progress log is updated after implementation.
- [ ] `task typecheck`, `task test`, and `task ci` results are recorded.
- [ ] Any unresolved user questions are documented before completion.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Markdown task types | `src/types/markdown-task.ts` | NOT_STARTED | `task typecheck` |
| Pure markdown parser | `src/markdown/parser.ts` | NOT_STARTED | `src/markdown/parser.test.ts` |
| Transcript extractor | `src/markdown/transcript-tasks.ts` | NOT_STARTED | `src/markdown/transcript-tasks.test.ts` |
| CLI command | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |
| Plan progress | `impl-plans/active/markdown-tasks.md` | NOT_STARTED | Review |

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

- [ ] Assistant markdown is parsed into sections and tasks.
- [ ] Extraction reads transcript-backed messages without mutating transcripts.
- [ ] Results include stable session, message, line, offset, and provenance fields.
- [ ] Message ID and checked-state filtering work in CLI output.
- [ ] Empty, malformed, or chat-only inputs return deterministic empty results.

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

## Related Plans

- **Depends On**: `impl-plans/active/transcript-search.md`
- **Related**: `impl-plans/active/bookmarks.md`
