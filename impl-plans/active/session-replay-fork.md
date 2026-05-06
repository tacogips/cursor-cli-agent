# Best-Effort Session Replay and Fork Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-session-replay-fork.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-session-replay-fork.md`

### Summary

Implement backlog slice `P5-SESSION-REPLAY-FORK`: a Cursor-local `session fork` experiment that slices transcript-backed user and assistant messages, builds an explicit replay prompt, starts a new headless Cursor session, records provenance, and labels the behavior as degraded replay rather than native fork semantics.

### Scope

**Included**: replay/fork types, transcript slice selection, replay prompt construction, provenance persistence, headless Cursor launch integration, `session fork` CLI validation/rendering, dry-run support, limitation reporting, and focused service/CLI tests.

**Excluded**: native Cursor fork claims, Cursor transcript mutation, hidden model-state reconstruction, tool-state reconstruction, server APIs, SDK exports, daemon behavior, bookmark mutation, and markdown task extraction changes.

### Codex Reference Mapping

- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`: native Codex `spawnFork` process shape and process option mapping reference.
- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`: session identity lookup and rollout-backed source discovery reference.
- `/Users/taco/gits/tacogips/codex-agent/src/rollout/reader.ts`: JSONL message normalization and provenance derivation reference.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: `session fork <id> [--nth-message N]` CLI reference.

Intentional divergence: Cursor launches a new headless session with a generated replay prompt and provenance metadata. It does not call a native fork command.

---

## Modules

### 1. Replay/Fork Types

#### `src/types/session-replay-fork.ts`

**Status**: NOT_STARTED

```typescript
import type { CursorSessionRecord } from "./session-record";

export type ReplayForkMode = "best_effort_replay";
export type ReplayForkSemantics = "replay_not_native_fork";

export interface ReplayForkBoundary {
  readonly messageId?: string;
  readonly nthMessage?: number;
  readonly eventOffset?: number;
  readonly role?: "user" | "assistant";
  readonly inclusive: true;
}

export interface ReplayForkRequest {
  readonly sourceSessionId: string;
  readonly continuationPrompt: string;
  readonly throughMessageId?: string;
  readonly nthMessage?: number;
  readonly dryRun: boolean;
}

export interface ReplayForkProvenance {
  readonly replayForkId: string;
  readonly sourceRecordId: string;
  readonly sourceLocalSessionId?: string;
  readonly sourceCursorChatId?: string;
  readonly newRecordId?: string;
  readonly newLocalSessionId?: string;
  readonly promptHash: string;
  readonly createdAt: string;
  readonly semantics: ReplayForkSemantics;
}

export interface ReplayForkResult {
  readonly mode: ReplayForkMode;
  readonly sourceSession: CursorSessionRecord;
  readonly forkPoint: ReplayForkBoundary;
  readonly replay: ReplayForkPlan;
  readonly newSession?: CursorSessionRecord;
  readonly provenance: ReplayForkProvenance;
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
}

export interface ReplayForkPlan {
  readonly messageCount: number;
  readonly omittedMessageCount: number;
  readonly truncated: boolean;
  readonly promptPreview: string;
}
```

**Checklist**:

- [ ] Define immutable request, boundary, plan, provenance, and result contracts.
- [ ] Reuse `CursorSessionRecord` for source and new session identity.
- [ ] Include explicit `best_effort_replay` and `replay_not_native_fork` flags.
- [ ] Export contracts for service, persistence, CLI, and tests.

### 2. Transcript Slice and Replay Prompt Builder

#### `src/cursor/session-replay.ts`

**Status**: NOT_STARTED

```typescript
export interface ReplayableTranscriptMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly eventOffset: number;
  readonly byteOffset: number;
}

export interface TranscriptReplaySliceOptions {
  readonly transcriptPath: string;
  readonly throughMessageId?: string;
  readonly nthMessage?: number;
}

export interface TranscriptReplaySlice {
  readonly messages: readonly ReplayableTranscriptMessage[];
  readonly forkPoint: ReplayForkBoundary;
  readonly omittedMessageCount: number;
  readonly truncated: boolean;
}

export function sliceTranscriptForReplay(
  options: TranscriptReplaySliceOptions,
): Promise<TranscriptReplaySlice>;

export function buildReplayPrompt(
  slice: TranscriptReplaySlice,
  continuationPrompt: string,
  source: CursorSessionRecord,
): string;
```

**Checklist**:

- [ ] Stream through `streamTranscriptSearchLines` or the same transcript-reader adapter boundary.
- [ ] Include only replayable `user` and `assistant` messages.
- [ ] Support all messages, `--through-message`, and `--nth-message`.
- [ ] Reject empty slices and out-of-range boundaries.
- [ ] Include explicit degradation warnings in the generated prompt.
- [ ] Keep transcript files read-only.

### 3. Replay Provenance Persistence

#### `src/persistence/session-replay-forks-store.ts`

**Status**: NOT_STARTED

```typescript
export interface ReplayForkStore {
  record(provenance: ReplayForkProvenance): void;
  findByReplayForkId(id: string): ReplayForkProvenance | undefined;
  listForSource(sourceRecordId: string): readonly ReplayForkProvenance[];
}
```

**Checklist**:

- [ ] Store provenance in repository-owned state, not Cursor transcript files.
- [ ] Persist source ids, new session ids when known, prompt hash, created timestamp, and semantics flag.
- [ ] Add SQLite migration or dedicated store initialization without breaking existing session index data.
- [ ] Cover dry-run output without persisting a launched-session provenance unless the design is revised.

### 4. Replay/Fork Service

#### `src/cursor/session-replay-fork.ts`

**Status**: NOT_STARTED

```typescript
export interface ReplayForkProcessOptions {
  readonly workspace: string;
  readonly model?: string;
  readonly mode?: "default" | "plan" | "ask";
  readonly trust?: boolean;
  readonly force?: boolean;
  readonly yolo?: boolean;
  readonly sandbox?: "enabled" | "disabled";
  readonly approveMcps?: boolean;
}

export interface SessionReplayForkService {
  fork(
    request: ReplayForkRequest,
    processOptions: ReplayForkProcessOptions,
  ): Promise<ReplayForkResult>;
}
```

**Checklist**:

- [ ] Resolve source through `SessionIndexRepository.resolveSessionKey`.
- [ ] Return not-found or transcript-not-materialized failures consistently with existing session commands.
- [ ] Build the replay prompt from the transcript slice and continuation prompt.
- [ ] For `dryRun`, return plan, limitations, warnings, and provenance preview without invoking Cursor.
- [ ] For normal runs, launch via `runHeadlessStreaming`.
- [ ] Normalize stream output through existing stream normalizer behavior used by `session run`.
- [ ] Import transcripts after completion and link new session identity when possible.
- [ ] Record replay provenance after the new session identity is known or record a warning if identity cannot be linked.

### 5. CLI Command

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

```typescript
curort-cli-agent session fork <id> --prompt <text> [--through-message <message-id>] [--nth-message <n>] [--dry-run] [--json]
```

**Checklist**:

- [ ] Add `session fork` usage and routing.
- [ ] Validate required id, required prompt, mutually exclusive boundary flags, positive `--nth-message`, and message id format.
- [ ] Reuse existing process option parsing where possible.
- [ ] Render human output with source id, fork point, new session id, limitations, and warnings.
- [ ] Emit full `ReplayForkResult` for `--json`.
- [ ] Ensure human dry-run output does not dump full private transcript text by default.

### 6. Tests and Verification Fixtures

#### `src/cursor/session-replay.test.ts`
#### `src/cursor/session-replay-fork.test.ts`
#### `src/persistence/session-replay-forks-store.test.ts`
#### `src/cli/cli.test.ts`

**Status**: NOT_STARTED

```typescript
describe("best-effort session replay fork", () => {
  // slicer, prompt builder, provenance store, service, and CLI tests
});
```

**Checklist**:

- [ ] Cover all-message, `--through-message`, and `--nth-message` slicing.
- [ ] Cover malformed transcript rows as non-fatal input.
- [ ] Cover pending `chat_only` source rejection.
- [ ] Cover limitation strings in JSON and human output.
- [ ] Cover dry-run path without Cursor process invocation.
- [ ] Cover process-runner invocation through a fake runner.
- [ ] Cover provenance persistence and new session linking when a transcript materializes.

---

## Work Breakdown

### TASK-001: Replay/Fork Types

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/session-replay-fork.ts`
**Dependencies**: phase1-core-foundation:TASK-004, transcript-search:TASK-001

**Completion Criteria**:

- [ ] Type contracts compile under strict TypeScript.
- [ ] Result contract includes source, replay plan, new session, provenance, limitations, and warnings.
- [ ] Semantics flags explicitly state replay is not native fork.

### TASK-002: Transcript Slicer and Prompt Builder

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/session-replay.ts`, `src/cursor/session-replay.test.ts`
**Dependencies**: TASK-001, transcript-search:TASK-002, transcript-search:TASK-003

**Completion Criteria**:

- [ ] Slicer uses transcript adapter APIs rather than direct CLI JSONL parsing.
- [ ] Stable message ids and nth-message boundaries are deterministic.
- [ ] Prompt builder includes source identity, replay slice, continuation prompt, and limitations.

### TASK-003: Provenance Store

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/persistence/session-replay-forks-store.ts`, `src/persistence/session-replay-forks-store.test.ts`
**Dependencies**: TASK-001, phase1-core-foundation:TASK-004

**Completion Criteria**:

- [ ] Store persists replay/fork provenance without mutating Cursor files.
- [ ] Store can list provenance by source record id.
- [ ] Existing session index tests keep passing after migration or store initialization.

### TASK-004: Replay/Fork Service

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/session-replay-fork.ts`, `src/cursor/session-replay-fork.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, phase1-core-foundation:TASK-005

**Completion Criteria**:

- [ ] Service rejects unknown, chat-only, and empty-slice sources clearly.
- [ ] Dry-run returns no process invocation.
- [ ] Normal run invokes existing Cursor headless runner with replay prompt.
- [ ] Result imports or links new session identity when possible.
- [ ] Limitations are always present.

### TASK-005: CLI Integration

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004, phase1-core-foundation:TASK-006

**Completion Criteria**:

- [ ] `session fork` is documented in usage output.
- [ ] CLI validation covers prompt and boundary errors.
- [ ] JSON output matches the design contract.
- [ ] Human output labels the action as best-effort replay.

### TASK-006: Progress and Documentation Refresh

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `impl-plans/active/session-replay-fork.md`, README or user-facing workflow docs if implementation changes require discoverability updates
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [ ] Plan progress log records implementation and verification results.
- [ ] README/user-facing docs are evaluated after CLI behavior exists.
- [ ] Any changed intentional divergence is reflected in `design-docs/specs/design-session-replay-fork.md`.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Replay/fork types | `src/types/session-replay-fork.ts` | NOT_STARTED | `task typecheck` |
| Transcript slicer | `src/cursor/session-replay.ts` | NOT_STARTED | `src/cursor/session-replay.test.ts` |
| Provenance store | `src/persistence/session-replay-forks-store.ts` | NOT_STARTED | `src/persistence/session-replay-forks-store.test.ts` |
| Replay/fork service | `src/cursor/session-replay-fork.ts` | NOT_STARTED | `src/cursor/session-replay-fork.test.ts` |
| CLI command | `src/cli/cli.ts` | NOT_STARTED | `src/cli/cli.test.ts` |
| Plan progress | `impl-plans/active/session-replay-fork.md` | READY | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P5-SESSION-REPLAY-FORK | P1-CORE-FOUNDATION | Required |
| P5-SESSION-REPLAY-FORK | P2-TRANSCRIPT-SEARCH | Required for stable message ids and streaming transcript access |
| P5-SESSION-REPLAY-FORK | P2-MARKDOWN-TASKS | Required by assigned feature decomposition; no runtime parser dependency expected unless message-range conventions change |
| TASK-004 | TASK-001, TASK-002, TASK-003 | Blocked |
| TASK-005 | TASK-004 | Blocked |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual dry-run smoke: `bun run src/main.ts session fork <id> --prompt "continue here" --through-message event-0-user --dry-run --json`
- Manual launch smoke in a disposable workspace: `bun run src/main.ts session fork <id> --prompt "continue here" --nth-message 2 --json`

## Completion Criteria

- [ ] `session fork` creates a new Cursor headless session from a transcript replay prompt.
- [ ] JSON and human output explicitly report `best_effort_replay` behavior and limitations.
- [ ] Source transcript files remain read-only.
- [ ] Provenance records source ids, new session ids when known, selected boundary, prompt hash, timestamp, and `replay_not_native_fork`.
- [ ] Dry-run produces a replay plan without invoking Cursor.
- [ ] Tests cover slicer, service, store, CLI validation, dry-run, and limitation reporting.

## Progress Log

### Session: 2026-05-06 00:00

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started by this design-plan node.
**Notes**: No upstream review payload was attached. The plan intentionally diverges from Codex native `fork` by using Cursor transcript replay and explicit provenance.
