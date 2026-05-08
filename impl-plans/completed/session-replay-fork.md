# Best-Effort Session Replay and Fork Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-session-replay-fork.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-09

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

**Status**: COMPLETED

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

- [x] Define immutable request, boundary, plan, provenance, and result contracts.
- [x] Reuse `CursorSessionRecord` for source and new session identity.
- [x] Include explicit `best_effort_replay` and `replay_not_native_fork` flags.
- [x] Export contracts for service, persistence, CLI, and tests.

### 2. Transcript Slice and Replay Prompt Builder

#### `src/cursor/session-replay-slice.ts`
#### `src/cursor/replay-prompt.ts`
#### `src/cursor/transcript-message-id.ts`

**Status**: COMPLETED

```typescript
export interface ReplayTranscriptReplayableRow {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly displayText: string;
  readonly eventOffset: number;
}

export interface TranscriptReplaySliceOptions {
  readonly transcriptPath: string;
  readonly throughMessageId?: string;
  readonly nthMessage?: number;
}

export interface TranscriptReplaySlice {
  readonly messages: readonly ReplayTranscriptReplayableRow[];
  readonly forkPoint: ReplayForkBoundary;
  readonly omittedMessageCount: number;
  readonly truncated: boolean;
}

export function sliceTranscriptForReplay(
  options: TranscriptReplaySliceOptions,
): Promise<TranscriptReplaySlice>;

export function buildReplayForkPrompt(
  slice: TranscriptReplaySlice,
  continuationPrompt: string,
  source: CursorSessionRecord,
): string;
```

**Checklist**:

- [x] Stream through transcript reader / search line streaming boundaries.
- [x] Include only replayable `user` and `assistant` messages.
- [x] Support all messages, `--through-message`, and `--nth-message`.
- [x] Reject empty slices and out-of-range boundaries.
- [x] Include explicit degradation warnings in the generated prompt.
- [x] Keep transcript files read-only.
- [x] Use transcript reader event offsets and stable message ids; byte offsets are not part of the shipped replay row contract.

### 3. Replay Provenance Persistence

#### `src/persistence/session-replay-forks-store.ts`

**Status**: COMPLETED

```typescript
export interface ReplayForkStore {
  record(provenance: ReplayForkProvenance): Promise<void>;
  findByReplayForkId(id: string): Promise<ReplayForkProvenance | undefined>;
  listForSource(sourceRecordId: string): Promise<readonly ReplayForkProvenance[]>;
}
```

**Checklist**:

- [x] Store provenance in repository-owned state, not Cursor transcript files.
- [x] Persist source ids, new session ids when known, prompt hash, created timestamp, and semantics flag.
- [x] Use dedicated JSON store (`sessionReplayForksJsonPath`) without mutating the session index database.
- [x] Dry-run skips persistence for launched sessions per CLI orchestration.

### 4. Replay/Fork Service

#### `src/cursor/session-replay-fork.ts`

**Status**: COMPLETED

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

- [x] Resolve source through `SessionIndexRepository.resolveSessionKey`.
- [x] Return not-found or transcript-not-materialized failures consistently with existing session commands.
- [x] Build the replay prompt from the transcript slice and continuation prompt.
- [x] For `dryRun`, return plan, limitations, warnings, and provenance preview without invoking Cursor.
- [x] For normal runs, launch via headless streaming runner.
- [x] Normalize stream output through existing stream normalizer behavior used by `session run`.
- [x] Import transcripts after completion and link new session identity when possible.
- [x] Record replay provenance after the new session identity is known or record a warning if identity cannot be linked.

### 5. CLI Command

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
curort-cli-agent session fork <id> --prompt <text> [--through-message <message-id>] [--nth-message <n>] [--dry-run] [--json]
```

**Checklist**:

- [x] Add `session fork` usage and routing.
- [x] Validate required id, required prompt, mutually exclusive boundary flags, positive `--nth-message`, and message id format.
- [x] Reuse existing process option parsing where possible.
- [x] Render human output with source id, fork point, new session id, limitations, and warnings.
- [x] Emit full `ReplayForkResult` for `--json`.
- [x] Ensure human dry-run output does not dump full private transcript text by default.

### 6. Tests and Verification Fixtures

#### `src/cursor/session-replay-slice.test.ts`
#### `src/cursor/replay-prompt.test.ts`
#### `src/persistence/session-replay-forks-store.test.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
describe("best-effort session replay fork", () => {
  // slicer, prompt builder, provenance store, service, and CLI tests
});
```

**Checklist**:

- [x] Cover all-message, `--through-message`, and `--nth-message` slicing.
- [x] Cover malformed transcript rows as non-fatal input.
- [x] Cover pending `chat_only` source rejection.
- [x] Cover limitation strings in JSON and human output.
- [x] Cover dry-run path without Cursor process invocation.
- [x] Cover argv / runner wiring indirectly via CLI tests and typecheck.
- [x] Cover provenance persistence and listing by source id.

---

## Work Breakdown

### TASK-001: Replay/Fork Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/session-replay-fork.ts`
**Dependencies**: phase1-core-foundation:TASK-004, transcript-search:TASK-001

**Completion Criteria**:

- [x] Type contracts compile under strict TypeScript.
- [x] Result contract includes source, replay plan, new session, provenance, limitations, and warnings.
- [x] Semantics flags explicitly state replay is not native fork.

### TASK-002: Transcript Slicer and Prompt Builder

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/session-replay-slice.ts`, `src/cursor/session-replay-slice.test.ts`, `src/cursor/transcript-message-id.ts`, `src/cursor/replay-prompt.ts`, `src/cursor/replay-prompt.test.ts`
**Dependencies**: TASK-001, transcript-search:TASK-002, transcript-search:TASK-003

**Completion Criteria**:

- [x] Slicer consumes `streamTranscriptSearchLines` (transcript-search adapter boundary).
- [x] Stable message ids (`event-<n>-<role>`) align with transcript search/bookmark lookups.
- [x] Prompt builder composes replay header, limitations, continuation prompt (`buildReplayForkPrompt`).

### TASK-003: Provenance Store

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/persistence/session-replay-forks-store.ts`, `src/persistence/session-replay-forks-store.test.ts`, `src/config/paths.ts` (`sessionReplayForksJsonPath`)
**Dependencies**: TASK-001, phase1-core-foundation:TASK-004

**Completion Criteria**:

- [x] Store persists replay/fork provenance without mutating Cursor files.
- [x] Store can list provenance by source record id.
- [x] Existing session index tests keep passing after store initialization (isolated JSON file).

### TASK-004: Replay/Fork Service

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/session-replay-fork.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003, phase1-core-foundation:TASK-005

**Completion Criteria**:

- [x] Service rejects unknown, chat-only, and empty-slice sources clearly.
- [x] Dry-run returns no process invocation.
- [x] Normal run invokes existing Cursor headless runner with replay prompt.
- [x] Result imports or links new session identity when possible.
- [x] Limitations are always present.

### TASK-005: CLI Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`
**Dependencies**: TASK-004, phase1-core-foundation:TASK-006

**Completion Criteria**:

- [x] `session fork` is documented in usage output.
- [x] CLI validation covers prompt and boundary errors.
- [x] JSON output matches the design contract.
- [x] Human output labels the action as best-effort replay.

### TASK-006: Progress and Documentation Refresh

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/session-replay-fork.md`, `README.md` capability line
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Plan progress log records implementation and verification results.
- [x] README lists `session fork` at a high level.
- [x] Intentional divergence remains in `design-docs/specs/design-session-replay-fork.md`.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Replay/fork types | `src/types/session-replay-fork.ts` | Completed | `task typecheck` |
| Transcript slicer + prompt | `src/cursor/session-replay-slice.ts`, `src/cursor/replay-prompt.ts` | Completed | slice + replay-prompt tests |
| Provenance store | `src/persistence/session-replay-forks-store.ts` | Completed | `session-replay-forks-store.test.ts` |
| Replay/fork service | `src/cursor/session-replay-fork.ts` | Completed | CLI + typecheck |
| CLI command | `src/cli/cli.ts` | Completed | `cli.test.ts` |
| Plan progress | `impl-plans/completed/session-replay-fork.md` | Completed | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| P5-SESSION-REPLAY-FORK | P1-CORE-FOUNDATION | Required |
| P5-SESSION-REPLAY-FORK | P2-TRANSCRIPT-SEARCH | Required for stable message ids and streaming transcript access |
| P5-SESSION-REPLAY-FORK | P2-MARKDOWN-TASKS | Required by assigned feature decomposition; no runtime parser dependency expected unless message-range conventions change |
| TASK-004 | TASK-001, TASK-002, TASK-003 | Completed |
| TASK-005 | TASK-004 | Completed |

## Verification

- `task typecheck`
- `task test`
- `task ci`
- Manual dry-run smoke: `bun run src/main.ts session fork <id> --prompt "continue here" --through-message event-0-user --dry-run --json`
- Manual launch smoke in a disposable workspace: `bun run src/main.ts session fork <id> --prompt "continue here" --nth-message 2 --json`

## Completion Criteria

- [x] `session fork` creates a new Cursor headless session from a transcript replay prompt.
- [x] JSON and human output explicitly report `best_effort_replay` behavior and limitations.
- [x] Source transcript files remain read-only.
- [x] Provenance records source ids, new session ids when known, prompt hash, timestamp, and `replay_not_native_fork`.
- [x] Dry-run produces a replay plan without invoking Cursor.
- [x] Tests cover slicer, store, CLI validation, dry-run, and replay prompt hashing.

## Progress Log

### Session: 2026-05-08

**Tasks Completed**: TASK-002 through TASK-006 — `replay-prompt`, JSON provenance store, `executeSessionReplayFork`, CLI `session fork` (dry-run + live), README bullet, consolidated tests; live fork runs now pipe normalized stream events through `createUsagePersistenceChain` with `flush()` in `finally` (parity with `session run` / resume).
**Notes**: Optional dedicated `session-replay-fork.test.ts` deferred; coverage via `cli.test.ts`, store test, replay-prompt test, and existing slice tests. Dry-run still skips Cursor streaming (no usage captures).

### Session: 2026-05-09 (implementation batch)

**Tasks Completed**: TASK-001 type surface; TASK-002 transcript scan + slice helpers with tests (`session-replay-slice`, `transcript-message-id`).
**Tasks In Progress**: None (TASK-003+ landed the same cycle; final inventory is in Session 2026-05-08 and Session 2026-05-09 plan sync).
**Notes**: Stable message ids match transcript search `event-<offset>-<role>` scheme.

### Session: 2026-05-09 (plan sync)

**Tasks Completed**: Aligned module headers, file paths, JSON store notes, and test inventory with landed `session fork` implementation.
**Notes**: Removed stale "not started" bookkeeping; optional dedicated `session-replay-fork.test.ts` remains deferred per prior sessions.

### Session: 2026-05-06 00:00

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation not started by this design-plan node.
**Notes**: No upstream review payload was attached. The plan intentionally diverges from Codex native `fork` by using Cursor transcript replay and explicit provenance.
