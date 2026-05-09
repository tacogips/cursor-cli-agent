# Tool Registry and Model Helper Decisions

**Status**: Pending Decision

**Created**: 2026-05-07

**Category**: Command Design

## Decision Needed

The `P5-TOOL-REGISTRY` design has three user-facing rollout decisions for the
public CLI and SDK helper surface.

## Context

The feature adds local helper APIs for tool registry operations, bounded version
introspection, conservative model checks, and usage/activity stats. The design
sets conservative defaults so implementation planning can proceed without
guessing, while leaving these choices visible for user override.

## Decisions

### 1. `tool run` CLI Exposure

Should `tool run` ship in the first CLI release, or should registry execution
remain SDK-only until input schemas are finalized?

| Option | Behavior | Tradeoff |
|---|---|---|
| Ship in CLI by default | `cursor-cli-agent tool run <name> --input <json\|path>` executes registered local helper tools | Matches the current design and enables scriptable helpers, but exposes the execution contract earlier |
| SDK-only first | Registry execution is available only through SDK helpers | Smaller CLI surface, but less parity with Codex helper workflows |

**Default for implementation planning**: Ship `tool run` in the first CLI
release with strict structured input and registered local helpers only.

### 2. Probe Workspace Flag

Should `model check --probe` require an explicit workspace flag?

| Option | Behavior | Tradeoff |
|---|---|---|
| No dedicated workspace flag | Probe uses existing workspace/process context and marks results as probe-derived | Simpler CLI and matches current design, but side effects must be documented clearly |
| Require workspace flag | Probe requires an explicit workspace path or workspace opt-in flag | Makes side effects more visible, but adds friction to an already explicit probe command |

**Default for implementation planning**: Do not require a dedicated workspace
flag; keep `--probe` explicit, bounded, and provenance-marked.

### 3. Default Version Sources

Which optional tool versions should be included by default?

| Option | Behavior | Tradeoff |
|---|---|---|
| Package and `cursor-agent` only | Default output includes wrapper package metadata and bounded `cursor-agent --version` | Minimal and stable default |
| Include Bun and Git by default | Default output also checks Bun and Git | More environment context, but slower and noisier |
| Add configured helper binaries | Default output checks additional configured helper commands | Extensible, but expands failure modes and configuration surface |

**Default for implementation planning**: Include package metadata and
`cursor-agent` only by default. Keep Bun and Git behind explicit include flags
and do not add other optional binaries by default.

## Impact

- `design-docs/specs/design-tool-registry-model-helpers.md`
- `impl-plans/active/tool-registry-model-helpers.md`
- `src/cli/cli.ts`
- `src/sdk/tool-registry.ts`
- `src/cursor/tool-versions.ts`
- `src/cursor/model-availability.ts`

## Awaiting

User confirmation or override for `tool run` CLI exposure, probe workspace flag
requirements, and default version sources.
