# Prompt Attachments and Image Inputs Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-prompt-attachments.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-prompt-attachments.md`

### Summary

Implement `P3-PROMPT-ATTACHMENTS`: validate local image attachments, detect Cursor attachment capability, forward supported attachments through session run/resume plus group/queue runs, persist provenance outside Cursor-managed files, and fail gracefully when unsupported.

### Scope

**Included**: attachment types, local path validation, capability detection, process-runner argv forwarding, CLI flags, queue item/run provenance, group run provenance, activity provenance summaries, and tests.

**Excluded**: non-image attachments, remote URLs, clipboard inputs, GUI automation, direct Cursor-managed file writes, and a dedicated `src/sdk/agent-requests.ts` module (parsing remains colocated in `src/cli/cli.ts` and process-runner options).

### Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`

- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`: `CodexProcessOptions.images`.
- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`: repeatable `--image` argv forwarding for exec.
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/agent-runner.ts`: SDK attachment input and normalization pattern.
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`: session config image propagation.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: repeatable `--image` CLI parsing for session, group, and queue flows.

Intentional divergences:

- Cursor image flags are detected from installed `cursor-agent` capabilities before launch.
- Base64 SDK attachments are deferred; this slice accepts local image paths only.
- Attachment provenance is stored in repository-owned state/activity records because Cursor transcripts may omit image metadata.
- Queue/group provenance follows Cursor workspace/item run records instead of Codex session-id group semantics.

---

## Modules

### 1. Attachment Domain Types

#### `src/types/prompt-attachment.ts`

**Status**: COMPLETED

```typescript
export type PromptAttachmentKind = "image";
export type PromptAttachmentSource = "cli" | "sdk" | "queue" | "group";
export type PromptAttachmentStatus = "validated" | "rejected" | "unsupported" | "forwarded";
export type PromptAttachmentMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface PromptAttachmentInput {
  readonly kind: PromptAttachmentKind;
  readonly path: string;
  readonly label?: string;
}

export interface PromptAttachmentProvenance {
  readonly id: string;
  readonly kind: PromptAttachmentKind;
  readonly source: PromptAttachmentSource;
  readonly originalPath: string;
  readonly resolvedPath: string;
  readonly mediaType: PromptAttachmentMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly status: PromptAttachmentStatus;
  readonly recordedAt: string;
}
```

**Checklist**:

- [x] Define strict attachment input and provenance types.
- [x] Keep binary image content out of persisted records.
- [x] Export types for CLI, persistence, activity, and future SDK facade use.

### 2. Attachment Validation

#### `src/cursor/prompt-attachments.ts`
#### `src/cursor/prompt-attachments.test.ts`

**Status**: COMPLETED

```typescript
export interface ValidatePromptAttachmentsOptions {
  readonly workspace: string;
  readonly source: PromptAttachmentSource;
  readonly now: () => Date;
}

export interface ValidatedPromptAttachments {
  readonly attachments: readonly PromptAttachmentProvenance[];
  readonly imagePaths: readonly string[];
}

export type PromptAttachmentValidationErrorCode =
  | "invalid_scheme"
  | "unsafe_path"
  | "stat_failed"
  | "not_regular_file"
  | "unsupported_media"
  | "hash_failed";

export interface PromptAttachmentValidationError {
  readonly code: PromptAttachmentValidationErrorCode;
  readonly path: string;
  readonly detail: string;
}

export async function validatePromptAttachments(
  inputs: readonly PromptAttachmentInput[],
  options: ValidatePromptAttachmentsOptions,
): Promise<
  | { readonly ok: true; readonly value: ValidatedPromptAttachments }
  | { readonly ok: false; readonly error: PromptAttachmentValidationError }
>;
```

**Checklist**:

- [x] Resolve relative paths against the command workspace.
- [x] Reject URLs, data URIs, stdin markers, directories, missing files, unreadable files, and unsupported media types.
- [x] Compute size and sha256 for provenance.
- [x] De-duplicate forwarded paths while preserving provenance.
- [x] Cover path resolution, validation failures, media detection, and duplicate handling in tests.

### 3. Cursor Capability Detection

#### `src/cursor/attachment-capability.ts`
#### `src/cursor/attachment-capability.test.ts`

**Status**: COMPLETED

```typescript
export type AttachmentCapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CursorAttachmentCapabilities {
  readonly imageFlag?: "--image" | "--attach" | "--file";
  readonly status: AttachmentCapabilityStatus;
  readonly detectedFrom: "help" | "override";
  readonly checkedAt: string;
}

export async function probeCursorAttachmentCapabilities(options: {
  readonly cursorBinary?: string;
  readonly helpTextOverride?: string;
  readonly forceStatus?: AttachmentCapabilityStatus;
  readonly now: () => Date;
  readonly bypassCache?: boolean;
}): Promise<CursorAttachmentCapabilities>;
```

**Checklist**:

- [x] Probe `cursor-agent --help` without writing Cursor state.
- [x] Cache detection per process.
- [x] Support deterministic test override injection.
- [x] Return unsupported/unknown without throwing for normal CLI handling.

### 4. Process Runner Attachment Forwarding

#### `src/cursor/process-runner.ts`
#### `src/cursor/process-runner.test.ts`

**Status**: COMPLETED

```typescript
export interface HeadlessRunOptions {
  readonly promptImages?: PromptImageArgv;
}

export interface PromptImageArgv {
  readonly flag: string;
  readonly paths: readonly string[];
}

export interface ResumeRunOptions extends Omit<HeadlessRunOptions, "prompt"> {
  readonly sessionOrChatId: string;
  readonly prompt?: string;
}
```

**Checklist**:

- [x] Append CLI-validated `PromptImageArgv` flag/value pairs for every resolved image path.
- [x] Apply the same forwarding to headless run and prompt-bearing resume.
- [x] Fail in CLI orchestration before spawning when attachments are present and capability is unsupported or unknown.
- [x] Keep commands without attachments on the current code path.
- [x] Test argv construction and no-spawn unsupported behavior.

### 5. CLI and SDK-Safe Request Parsing

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`

**Status**: COMPLETED

```typescript
export interface AgentRunRequest {
  readonly prompt: string;
  readonly workspace?: string;
  readonly attachments?: readonly PromptAttachmentInput[];
}

export interface AgentResumeRequest {
  readonly sessionId: string;
  readonly prompt?: string;
  readonly workspace?: string;
  readonly attachments?: readonly PromptAttachmentInput[];
}

export function attachmentInputsFromFlags(
  flags: Record<string, string | boolean>,
): readonly PromptAttachmentInput[];
```

**Checklist**:

- [x] Parse repeatable `--image <path>` for `session run`, `session resume`, `group run`, `queue add`, and `queue run`.
- [x] Validate attachments before opening long-lived run loops or spawning Cursor.
- [x] Return structured JSON errors in JSON/stream modes.
- [x] SDK surface defers dedicated `agent-requests` helpers; CLI and runner carry validated provenance.
- [x] Keep `session attach` excluded.

### 6. Queue, Group, and Activity Provenance

#### `src/persistence/queues-store.ts`
#### `src/types/group.ts`
#### `src/persistence/groups-store.ts`
#### `src/types/activity.ts`
#### `src/persistence/activity-store.ts`

**Status**: COMPLETED

```typescript
export interface QueueItemRecord {
  readonly attachments?: readonly PromptAttachmentProvenance[];
}

export interface QueueRunRecord {
  readonly runAttachments?: readonly PromptAttachmentProvenance[];
}

export interface GroupRunRecord {
  readonly attachments?: readonly PromptAttachmentProvenance[];
}

export interface ActivitySignal {
  readonly attachments?: readonly PromptAttachmentProvenance[];
}
```

**Checklist**:

- [x] Persist queue item attachments from `queue add`.
- [x] Merge queue item attachments with run-level attachments deterministically.
- [x] Persist group run attachment provenance once per group run.
- [x] Include session run/resume attachment summaries in activity signals.
- [x] Preserve backward-compatible loading for records without attachments.

---

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Attachment domain types | `src/types/prompt-attachment.ts` | COMPLETED | typecheck + CLI tests |
| Attachment validation | `src/cursor/prompt-attachments.ts` | COMPLETED | `src/cursor/prompt-attachments.test.ts` |
| Capability detection | `src/cursor/attachment-capability.ts` | COMPLETED | `src/cursor/attachment-capability.test.ts` |
| Process forwarding | `src/cursor/process-runner.ts` | COMPLETED | CLI orchestration tests cover forwarding and no-spawn guards |
| CLI parsing | `src/cli/cli.ts` | COMPLETED | `src/cli/cli.test.ts` |
| Provenance persistence | `queues-store`, `groups-store`, `activity`, `activity-store` | COMPLETED | store + CLI tests |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| P3-PROMPT-ATTACHMENTS | P1-CORE-FOUNDATION | READY |
| Queue provenance integration | P3-QUEUE-LIFECYCLE | OPTIONAL |
| Group provenance integration | P3-GROUP-LIFECYCLE | OPTIONAL |
| Public SDK exports | P4-PUBLIC-SDK | FOLLOW-UP |

## Tasks

### TASK-001: Attachment Types and Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/types/prompt-attachment.ts`, `src/cursor/prompt-attachments.ts`, `src/cursor/prompt-attachments.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Types compile under strict TypeScript.
- [x] Validation rejects unsupported or unsafe inputs before process launch.
- [x] Tests cover valid images, invalid paths, unsupported media, and duplicates.

### TASK-002: Capability Detection

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/cursor/attachment-capability.ts`, `src/cursor/attachment-capability.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Help-output probing returns supported, unsupported, or unknown.
- [x] Per-process probe cache (`bypassCache` for tests).
- [x] Probe failures surface as `attachments_capability_unknown` before spawn.

### TASK-003: Process Runner Forwarding

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cursor/process-runner.ts`, `src/cursor/process-runner.test.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Supported capabilities append one image flag/value pair per resolved path.
- [x] Unsupported/unknown capabilities fail in CLI orchestration before spawning.
- [x] Existing no-attachment process behavior is unchanged.

### TASK-004: CLI and SDK-Safe Request Parsing

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`, (optional follow-up) SDK request helpers
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [x] `session run`, `session resume`, `group run`, `queue add`, and `queue run` accept repeatable `--image` (session `continue` rejects images by design).
- [x] JSON/events stream modes emit structured `session.error` with `reason` for attachment failures.
- [x] `src/cli/cli.test.ts` covers attachment parsing and representative error envelopes; broader queue/group matrix remains covered through shared orchestration paths and smoke commands.
- [x] `session attach` remains excluded.

### TASK-005: Provenance Persistence

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/persistence/queues-store.ts`, `src/types/group.ts`, `src/types/queue.ts`, `src/types/activity.ts`, `src/persistence/activity-store.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [x] Queue item and run-level attachment metadata are retained without image bytes.
- [x] Group `lastRun` includes optional run-level attachment provenance.
- [x] Activity signals include attachment summaries for session/group/queue runs.
- [x] Legacy JSON queue/group records without attachment fields still load.

### TASK-006: Integration Tests and Smoke Documentation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/cli.test.ts`, persistence tests, smoke command notes in plan
**Dependencies**: TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Unit tests pass for attachment paths exercised in CI.
- [x] `task typecheck`, `task test`, and `task ci` pass.
- [x] Manual smoke commands remain listed in plan Verification section.

## Completion Criteria

- [x] Attachment paths are validated and normalized before Cursor process launch.
- [x] Cursor image support is capability-gated and fails gracefully when unsupported.
- [x] Session run/resume, group run, queue add, and queue run share one attachment validation path.
- [x] Queue, group, and activity provenance records are durable and backward compatible.
- [x] Tests cover supported, unsupported, validation-failure, and no-attachment regressions.
- [x] No runtime code writes Cursor-managed transcript, skill, or ai-tracking files.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/main.ts session run --prompt "describe image" --image ./fixtures/sample.png --stream events
bun run src/main.ts session resume <session-id> --prompt "continue with image" --image ./fixtures/sample.png --stream events
bun run src/main.ts group run example --prompt "review image" --image ./fixtures/sample.png --json
bun run src/main.ts queue add example --prompt "review image" --image ./fixtures/sample.png --json
bun run src/main.ts queue run example --image ./fixtures/sample.png --json
```

## Open Questions

- Which image flag does the installed Cursor CLI currently advertise for headless prompt attachments, if any?
- Should base64 SDK attachments be accepted in this feature or deferred until public SDK temp-file ownership is designed?
- Should queue-level run attachments merge with item attachments or should item attachments override duplicates?

## Risks

- Cursor's attachment flag may be absent or unstable across installed versions.
- Resume with attachments may be unsupported even if new-run image inputs exist.
- Provenance fields touching group/queue records can conflict with concurrently planned lifecycle slices if implemented in parallel without coordinating type changes.

## Progress Log

### Session: 2026-05-08

**Tasks Completed**: TASK-004 CLI `--image` tests; TASK-005 `ActivitySignal.attachments` + session/group/queue activity summaries; TASK-006 verification; plan bookkeeping aligned with shipped code.
**Notes**: `sessionIdFromEvent` centralized in `src/types/agent-event.ts` (re-exported from usage persistence chain).

### Session: 2026-05-09 (implementation batch)

**Tasks Completed**: TASK-001 through TASK-003; substantial TASK-004/TASK-005 wiring (CLI `--image`, process-runner argv, queue item persistence, group lastRun attachment metadata, structured `session.error.reason`).
**Tasks In Progress**: None (TASK-004/005/006 completed in this batch and reconciled by Session 2026-05-09 plan sync).
**Notes**: Help flag detection uses tokenizer-safe patterns (leading `--image` is not a JS `\\b` word boundary). `task typecheck`, `task test`, `task ci` verified.

### Session: 2026-05-09 (plan sync)

**Tasks Completed**: Reconciled module headers and module status table with landed `P3-PROMPT-ATTACHMENTS` code paths (`attachment-capability`, colocated CLI parsing).
**Notes**: Prior contradictory "not started" log line removed; implementation matches `task test` green state.

### Session: 2026-05-06 16:35

**Tasks Completed**: Reviewed assigned design and implementation plan against the feature contract, codex-agent references, Cursor adapter boundaries, and prior accepted review payload.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation remains intentionally deferred to a later implementation branch.
**Notes**: Prior accepted review for `P3-PROMPT-ATTACHMENTS` reported no findings and no revision flags; this pass preserved the existing feature scope and progress log.

### Session: 2026-05-06 00:00

**Tasks Completed**: Design and implementation plan authored.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation is intentionally deferred to a later implementation branch.
**Notes**: No upstream review payload was attached for this node; `addressedFeedback` is therefore empty for this pass.
