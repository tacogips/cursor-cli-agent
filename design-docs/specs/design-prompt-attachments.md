# Prompt Attachments and Image Inputs

This document defines `P3-PROMPT-ATTACHMENTS`: Cursor-safe prompt attachment support for session run/resume, group execution, queue execution, and SDK-facing request validation.

## Overview

Prompt attachments let callers provide local image files alongside a text prompt while preserving this repository's product boundary: Cursor state is read-only except for normal `cursor-agent` execution, and repository-owned state records attachment provenance separately from Cursor transcripts.

Included:

- repeatable CLI image inputs for `session run`, `session resume`, `group run`, `queue add`, and `queue run`
- SDK-facing attachment request types and validation for future public facade wiring
- Cursor capability detection before spawning `cursor-agent`
- process-runner argv construction for supported Cursor image flags
- durable provenance for queue items, group runs, and session activity where transcripts do not preserve attachment metadata
- graceful unsupported behavior when the installed `cursor-agent` has no compatible image-input flag

Excluded:

- non-image attachments, remote URLs, clipboard capture, GUI automation, or cloud uploads
- direct writes to `~/.cursor/projects`, `~/.cursor/skills-cursor`, or Cursor transcript files
- changing Cursor transcript parsing to infer attachments that Cursor does not record
- implementing runtime code in this design branch

## Source Issue Mapping

- Feature ID: `P3-PROMPT-ATTACHMENTS`
- Target feature area: `session-process`
- Requested behavior: Design and plan Cursor-safe prompt attachment support for session run/resume plus group and queue execution, with CLI/SDK input validation, capability detection, provenance, and graceful unsupported behavior.
- Assigned implementation plan: `impl-plans/completed/prompt-attachments.md`

## Attachment Model

The repository should normalize all caller inputs into a small image-only contract before any process is launched:

```typescript
export type PromptAttachmentKind = "image";
export type PromptAttachmentSource = "cli" | "sdk" | "queue" | "group";
export type PromptAttachmentStatus = "validated" | "rejected" | "unsupported" | "forwarded";

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
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly status: PromptAttachmentStatus;
  readonly recordedAt: string;
}
```

Validation rules:

1. Paths are local filesystem paths only; URLs, data URIs, stdin markers, and glob expansion are rejected.
2. Paths resolve against the command workspace unless already absolute.
3. Each path must exist, be a regular file, and be readable before `cursor-agent` starts.
4. Supported media types are PNG, JPEG, WebP, and GIF, identified by extension plus a small magic-byte check where practical.
5. Empty attachment lists are omitted from process options so existing runs are unchanged.
6. Duplicate resolved paths are de-duplicated after provenance is recorded.
7. Validation errors occur before process launch for session/group/queue run commands.

## CLI Contract

Commands gain repeatable image flags:

```bash
curort-cli-agent session run --prompt <text> --image <path>...
curort-cli-agent session resume <id> --prompt <text> --image <path>...
curort-cli-agent group run <name> --prompt <text> --image <path>...
curort-cli-agent queue add <name> --prompt <text> --image <path>...
curort-cli-agent queue run <name> --image <path>...
```

`--image` is the CLI spelling because the codex-agent reference already uses that user-facing flag for image inputs. Internally, the feature uses the broader "attachment" model so SDK and future non-CLI callers do not depend on CLI flag names.

Output rules:

- Human validation failures print one concise error and return usage exit code before Cursor is spawned.
- JSON/stream modes emit `session.error` or command-level JSON errors with `reason: "attachment_validation_failed"` or `reason: "attachments_unsupported"`.
- `queue add --json` returns the queue item with attachment provenance in `status: "validated"`.
- `group run` and `queue run` fail before scheduling any workspace/item when run-level attachments are requested but unsupported.

## SDK Contract

The SDK-facing request contract mirrors the normalized attachment model and stays adapter-agnostic:

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
```

SDK validation should return structured errors rather than printing. Public SDK exports can be wired later by `P4-PUBLIC-SDK`; this feature defines and tests the domain-safe request and validation behavior first.

## Cursor Capability Detection

Cursor attachment support must be detected locally instead of assumed. The implementation should add a small adapter that probes the installed `cursor-agent` help/version output and caches the result per process:

```typescript
export type AttachmentCapabilityStatus = "supported" | "unsupported" | "unknown";

export interface CursorAttachmentCapabilities {
  readonly imageFlag?: "--image" | "--attach" | "--file";
  readonly status: AttachmentCapabilityStatus;
  readonly detectedFrom: "help" | "version" | "override";
  readonly checkedAt: string;
}
```

Detection rules:

1. Prefer explicit test or environment override only for tests and deterministic smoke runs.
2. Probe `cursor-agent --help` and choose the first known image flag documented by the installed binary.
3. Treat no recognized flag as `unsupported`.
4. Treat probe failure as `unknown`; commands with attachments fail gracefully before spawning Cursor.
5. Commands without attachments never block on capability detection.

## Process Runner Mapping

`src/cursor/process-runner.ts` remains the only module that translates normalized attachments into raw Cursor argv. If capabilities report `imageFlag: "--image"`, headless run and resume argv append one flag-value pair per validated image.

The same validated attachment list should flow through:

- `runHeadlessStreaming` for `session run`, `group run`, and `queue run`
- `resumeStreaming` for `session resume` and `session continue` only when a prompt is present
- queue item persistence for `queue add`

Interactive `session attach` is excluded because it resumes an inherited terminal process and does not accept a prompt payload in this repository.

## Persistence and Provenance

Cursor transcripts may omit attachment metadata, so provenance is repository-owned:

- session run/resume activity signals include attachment provenance summaries
- group `lastRun` records store run-level attachment provenance and copy it to each workspace run as needed
- queue items store item-level attachment provenance from `queue add`
- queue run records store run-level attachments supplied at execution time

Provenance records never embed image bytes. They store paths, media type, size, hash, source, and status so users can audit which local files were supplied without duplicating the files.

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/agent-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to preserve:

- process options carry `images?: readonly string[]`
- CLI uses repeatable `--image <path>` flags
- queue items can persist prompt-level image paths
- SDK request normalization accepts attachment inputs before starting a session
- temporary/base64 attachment support is isolated from process spawning

Intentional Cursor divergences:

- Cursor support is capability-gated because installed `cursor-agent` flags may differ from Codex CLI flags.
- This repository records attachment provenance in its own stores and activity signals because Cursor transcripts are the canonical message source but may not preserve attachment metadata.
- Only local image file paths are included in this phase; base64 SDK inputs are deferred until there is a public SDK temp-file policy.
- Resume with attachments is supported only when Cursor exposes a compatible prompt-plus-image headless resume flag.

## Dependencies

- `P1-CORE-FOUNDATION`: required for `src/cursor/process-runner.ts`, CLI session/group/queue execution, local session index imports, and stream normalization.
- `P3-GROUP-LIFECYCLE`: optional but useful for durable group run provenance if implemented first.
- `P3-QUEUE-LIFECYCLE`: optional but useful for retained queue item/run provenance if implemented first.
- `P4-PUBLIC-SDK`: later exports SDK-facing request types; this feature should not require the public SDK facade to exist.

## Verification

Implementation should be verified with:

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

Manual smoke commands require a real installed `cursor-agent` whose help output advertises a supported image flag. Unsupported smoke verification should force or simulate unsupported capabilities and confirm no Cursor process is spawned.

## Open Questions

- Which image flag does the installed Cursor CLI currently advertise for headless prompt attachments, if any?
- Should base64 SDK attachments be accepted in the first SDK-compatible implementation or deferred until public SDK temp-file ownership is designed?
- Should queue-level run attachments be merged with item attachments or should item attachments override run-level attachments on duplicate paths?

## References

- `design-docs/specs/design-cursor-session-management.md`
- `design-docs/specs/design-group-lifecycle.md`
- `design-docs/specs/design-queue-lifecycle.md`
- `design-docs/specs/design-public-sdk.md`
