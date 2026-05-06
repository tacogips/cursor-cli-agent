# Prompt Attachments and Image Inputs Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-prompt-attachments.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Design Document Reference

**Source**: `design-docs/specs/design-prompt-attachments.md`

### Summary

Implement `P3-PROMPT-ATTACHMENTS`: validate local image attachments, detect Cursor attachment capability, forward supported attachments through session run/resume plus group/queue runs, persist provenance outside Cursor-managed files, and fail gracefully when unsupported.

### Scope

**Included**: attachment types, local path validation, capability detection, process-runner argv forwarding, CLI flags, queue item/run provenance, group run provenance, activity provenance summaries, and tests.

**Excluded**: runtime implementation in this planning branch, non-image attachments, remote URLs, clipboard inputs, GUI automation, direct Cursor-managed file writes, and public SDK facade exports beyond SDK-safe internal request types.

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

**Status**: NOT_STARTED

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

- [ ] Define strict attachment input and provenance types.
- [ ] Keep binary image content out of persisted records.
- [ ] Export types for CLI, persistence, activity, and future SDK facade use.

### 2. Attachment Validation

#### `src/cursor/prompt-attachments.ts`
#### `src/cursor/prompt-attachments.test.ts`

**Status**: NOT_STARTED

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

export class PromptAttachmentValidationError extends Error {
  readonly reason: "invalid_path" | "missing_file" | "not_file" | "unsupported_media_type" | "unreadable";
}

export async function validatePromptAttachments(
  inputs: readonly PromptAttachmentInput[],
  options: ValidatePromptAttachmentsOptions,
): Promise<ValidatedPromptAttachments>;
```

**Checklist**:

- [ ] Resolve relative paths against the command workspace.
- [ ] Reject URLs, data URIs, stdin markers, directories, missing files, unreadable files, and unsupported media types.
- [ ] Compute size and sha256 for provenance.
- [ ] De-duplicate forwarded paths while preserving provenance.
- [ ] Cover path resolution, validation failures, media detection, and duplicate handling in tests.

### 3. Cursor Capability Detection

#### `src/cursor/capabilities.ts`
#### `src/cursor/capabilities.test.ts`

**Status**: NOT_STARTED

```typescript
export type AttachmentCapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CursorAttachmentCapabilities {
  readonly imageFlag?: "--image" | "--attach" | "--file";
  readonly status: AttachmentCapabilityStatus;
  readonly detectedFrom: "help" | "version" | "override";
  readonly checkedAt: string;
}

export interface CursorCapabilityDetector {
  detectAttachmentCapabilities(): Promise<CursorAttachmentCapabilities>;
}
```

**Checklist**:

- [ ] Probe `cursor-agent --help` without writing Cursor state.
- [ ] Cache detection per process.
- [ ] Support deterministic test override injection.
- [ ] Return unsupported/unknown without throwing for normal CLI handling.

### 4. Process Runner Attachment Forwarding

#### `src/cursor/process-runner.ts`
#### `src/cursor/process-runner.test.ts`

**Status**: NOT_STARTED

```typescript
export interface HeadlessRunOptions {
  readonly attachments?: readonly PromptAttachmentProvenance[];
}

export interface ResumeRunOptions extends Omit<HeadlessRunOptions, "prompt"> {
  readonly sessionOrChatId: string;
  readonly prompt?: string;
}
```

**Checklist**:

- [ ] Append detected image flag plus resolved path for every validated image.
- [ ] Apply the same forwarding to headless run and prompt-bearing resume.
- [ ] Fail before spawning when attachments are present and capability is unsupported or unknown.
- [ ] Keep commands without attachments on the current code path.
- [ ] Test argv construction and no-spawn unsupported behavior.

### 5. CLI and SDK-Safe Request Parsing

#### `src/cli/cli.ts`
#### `src/cli/cli.test.ts`
#### `src/sdk/agent-requests.ts`

**Status**: NOT_STARTED

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

- [ ] Parse repeatable `--image <path>` for `session run`, `session resume`, `group run`, `queue add`, and `queue run`.
- [ ] Validate attachments before opening long-lived run loops or spawning Cursor.
- [ ] Return structured JSON errors in JSON/stream modes.
- [ ] Add SDK-safe request validation helpers without requiring public package exports.
- [ ] Keep `session attach` excluded.

### 6. Queue, Group, and Activity Provenance

#### `src/persistence/queues-store.ts`
#### `src/types/group.ts`
#### `src/persistence/groups-store.ts`
#### `src/types/activity.ts`

**Status**: NOT_STARTED

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

- [ ] Persist queue item attachments from `queue add`.
- [ ] Merge queue item attachments with run-level attachments deterministically.
- [ ] Persist group run attachment provenance once per group run.
- [ ] Include session run/resume attachment summaries in activity signals.
- [ ] Preserve backward-compatible loading for records without attachments.

---

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Attachment domain types | `src/types/prompt-attachment.ts` | NOT_STARTED | - |
| Attachment validation | `src/cursor/prompt-attachments.ts` | NOT_STARTED | Planned |
| Capability detection | `src/cursor/capabilities.ts` | NOT_STARTED | Planned |
| Process forwarding | `src/cursor/process-runner.ts` | NOT_STARTED | Planned |
| CLI and SDK-safe parsing | `src/cli/cli.ts`, `src/sdk/agent-requests.ts` | NOT_STARTED | Planned |
| Provenance persistence | `src/persistence/queues-store.ts`, `src/persistence/groups-store.ts`, `src/types/activity.ts` | NOT_STARTED | Planned |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| P3-PROMPT-ATTACHMENTS | P1-CORE-FOUNDATION | READY |
| Queue provenance integration | P3-QUEUE-LIFECYCLE | OPTIONAL |
| Group provenance integration | P3-GROUP-LIFECYCLE | OPTIONAL |
| Public SDK exports | P4-PUBLIC-SDK | FOLLOW-UP |

## Tasks

### TASK-001: Attachment Types and Validation

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/types/prompt-attachment.ts`, `src/cursor/prompt-attachments.ts`, `src/cursor/prompt-attachments.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Types compile under strict TypeScript.
- [ ] Validation rejects unsupported or unsafe inputs before process launch.
- [ ] Tests cover valid images, invalid paths, unsupported media, and duplicates.

### TASK-002: Capability Detection

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/cursor/capabilities.ts`, `src/cursor/capabilities.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [ ] Help-output probing returns supported, unsupported, or unknown.
- [ ] Test override and per-process cache are covered.
- [ ] Probe failures are surfaced as graceful unsupported behavior.

### TASK-003: Process Runner Forwarding

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cursor/process-runner.ts`, `src/cursor/process-runner.test.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [ ] Supported capabilities append one image flag per resolved path.
- [ ] Unsupported capabilities fail before spawning.
- [ ] Existing no-attachment process behavior is unchanged.

### TASK-004: CLI and SDK-Safe Request Parsing

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.ts`, `src/cli/cli.test.ts`, `src/sdk/agent-requests.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [ ] `session run`, `session resume`, `group run`, `queue add`, and `queue run` accept repeatable `--image`.
- [ ] JSON/stream modes include structured attachment errors.
- [ ] `session attach` remains excluded.

### TASK-005: Provenance Persistence

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/persistence/queues-store.ts`, `src/persistence/groups-store.ts`, `src/types/group.ts`, `src/types/activity.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [ ] Queue item and run-level attachments are retained without image bytes.
- [ ] Group run records include run-level attachment provenance.
- [ ] Activity signals can audit attachments for session run/resume.
- [ ] Legacy records without attachment fields still load.

### TASK-006: Integration Tests and Smoke Documentation

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/cli/cli.test.ts`, `src/cursor/process-runner.test.ts`, persistence tests, smoke command notes
**Dependencies**: TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [ ] Unit tests pass for all attachment paths.
- [ ] `task typecheck`, `task test`, and `task ci` pass.
- [ ] Manual smoke commands are documented with real and unsupported capability modes.

## Completion Criteria

- [ ] Attachment paths are validated and normalized before Cursor process launch.
- [ ] Cursor image support is capability-gated and fails gracefully when unsupported.
- [ ] Session run/resume, group run, queue add, and queue run share one attachment validation path.
- [ ] Queue, group, and activity provenance records are durable and backward compatible.
- [ ] Tests cover supported, unsupported, validation-failure, and no-attachment regressions.
- [ ] No runtime code writes Cursor-managed transcript, skill, or ai-tracking files.

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
