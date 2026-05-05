# Markdown Task Extraction Implementation Plan

**Status**: Blocked
**Design Reference**: `design-docs/specs/design-codex-agent-parity-gap.md#phase-2-search-bookmarks-and-activity`
**Created**: 2026-05-05
**Last Updated**: 2026-05-05

---

## Design Document Reference

**Source**: `design-docs/specs/design-codex-agent-parity-gap.md`, `design-docs/specs/design-parity-backlog-workflow.md`

### Summary

Implement backlog slice `P2-MARKDOWN-TASKS`: parse assistant markdown from transcript-backed messages into section and task views without mutating transcripts.

### Scope

**Included**: markdown parse types, parser service, transcript extraction helper, CLI task view, and tests.

**Excluded**: markdown rendering UI, bookmark storage, server APIs, SDK exports, and editing transcript content.

### Codex Reference Mapping

- `/Users/taco/gits/tacogips/codex-agent/src/markdown/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/markdown/parser.test.ts`

Intentional divergence: Cursor task extraction reads normalized assistant transcript messages from Cursor JSONL instead of Codex rollout events.

---

## Modules

### 1. Markdown Task Types

#### `src/types/markdown-task.ts`

**Status**: NOT_STARTED

```typescript
export interface MarkdownSection {
  readonly heading: string;
  readonly level: number;
  readonly content: string;
}

export interface MarkdownTask {
  readonly sessionId: string;
  readonly messageId: string;
  readonly sectionHeading?: string;
  readonly text: string;
  readonly checked: boolean;
  readonly lineNumber: number;
}

export interface MarkdownTaskExtractionResult {
  readonly sessionId: string;
  readonly messageId?: string;
  readonly sections: readonly MarkdownSection[];
  readonly tasks: readonly MarkdownTask[];
  readonly provenance: "transcript";
}
```

**Checklist**:

- [ ] Define section and task result contracts.
- [ ] Preserve session and message identity for transcript-backed tasks.
- [ ] Export types for CLI and later SDK/server reuse.

### 2. Markdown Parser

#### `src/markdown/parser.ts`

**Status**: NOT_STARTED

```typescript
export interface MarkdownTaskParser {
  parse(sessionId: string, messageId: string, markdown: string): MarkdownTaskExtractionResult;
}
```

**Checklist**:

- [ ] Parse ATX headings into sections.
- [ ] Parse `- [ ]` and `- [x]` task list items.
- [ ] Preserve line numbers and original task text.
- [ ] Avoid external network or rendering dependencies.

### 3. Transcript Task Extraction

#### `src/markdown/transcript-tasks.ts`

**Status**: NOT_STARTED

```typescript
export interface TranscriptTaskExtractor {
  extractForSession(sessionId: string, options?: TranscriptTaskOptions): Promise<MarkdownTaskExtractionResult>;
}
```

**Checklist**:

- [ ] Read assistant messages through transcript search/reader boundaries.
- [ ] Support optional message ID filtering.
- [ ] Merge results deterministically by transcript position.
- [ ] Return empty results for chat-only records without transcript content.

### 4. CLI Command

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
```

**Checklist**:

- [ ] Add markdown task usage.
- [ ] Validate session, optional message, and checked filters.
- [ ] Render task text, checked state, section, and message ID.

### 5. Tests and Verification

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

- [ ] Cover heading sections and checked/unchecked task parsing.
- [ ] Cover assistant-only extraction from transcripts.
- [ ] Cover empty and malformed markdown inputs.

---

## Work Breakdown

### TASK-001: Markdown Task Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/markdown-task.ts`
**Dependencies**: `transcript-search:TASK-001`

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Results include session, message, line, and provenance fields.
- [ ] Types are exported for parser, CLI, and later APIs.

### TASK-002: Parser

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/markdown/parser.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [ ] Parser extracts headings and task list items.
- [ ] Parser preserves line numbers and checked state.
- [ ] Parser tests cover common markdown edge cases.

### TASK-003: Transcript Extraction

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/markdown/transcript-tasks.ts`
**Dependencies**: TASK-001, TASK-002, `transcript-search:TASK-002`

**Completion Criteria**:

- [ ] Extractor reads transcript-backed assistant messages.
- [ ] Message ID filtering uses stable transcript IDs.
- [ ] Chat-only sessions return empty transcript-provenance results.

### TASK-004: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [ ] `markdown tasks` command validates flags.
- [ ] Human and JSON output are deterministic.
- [ ] Existing CLI commands remain unchanged.

### TASK-005: Test Coverage

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/markdown/parser.test.ts`, `src/markdown/transcript-tasks.test.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [ ] Parser, extractor, and CLI tests pass.
- [ ] `task typecheck`, `task test`, and `task ci` expectations are recorded.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Markdown task types | `src/types/markdown-task.ts` | NOT_STARTED | - |
| Markdown parser | `src/markdown/parser.ts` | NOT_STARTED | `src/markdown/parser.test.ts` |
| Transcript extractor | `src/markdown/transcript-tasks.ts` | NOT_STARTED | `src/markdown/transcript-tasks.test.ts` |
| CLI command | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P2-MARKDOWN-TASKS | P2-TRANSCRIPT-SEARCH | Blocked |
| Server/SDK task views | P2-MARKDOWN-TASKS | Future phase |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual smoke: `bun run src/main.ts markdown tasks --session <id> --json`
- Manual smoke: `bun run src/main.ts markdown tasks --session <id> --checked false`

## Completion Criteria

- [ ] Assistant markdown is parsed into sections and tasks.
- [ ] Extraction reads transcript-backed messages without mutating transcripts.
- [ ] Results include stable session and message identities.
- [ ] Checked-state filtering works in CLI output.
- [ ] Empty or chat-only inputs return deterministic empty results.

## Progress Log

### Session: 2026-05-05 Step 3 Batch Planning

**Tasks Completed**: Created implementation plan for `P2-MARKDOWN-TASKS`.
**Tasks In Progress**: None.
**Blockers**: Waiting for `P2-TRANSCRIPT-SEARCH` stable message IDs and transcript extraction boundary.
**Notes**: Plan is blocked by design dependency, not missing design coverage.

## Related Plans

- **Depends On**: `impl-plans/active/transcript-search.md`
- **Related**: `impl-plans/active/bookmarks.md`
