# Tool Registry, Model Helpers, and Usage Stats Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tool-registry-model-helpers.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-tool-registry-model-helpers.md`

### Summary

Implement Phase 5 `P5-TOOL-REGISTRY`: Cursor-safe helper APIs for a typed tool registry, tool/version introspection, conservative model/auth checks, and local usage/activity stats derived from repository-owned indexes.

### Scope

**Included**: SDK helper contracts, local registry implementation, bounded subprocess version readers, conservative model availability service, optional explicit model probe, usage stats aggregation, CLI commands, and focused tests.

**Excluded**: mutation of Cursor-managed files/databases, remote model catalogs, undocumented Cursor APIs, live transcript content scanning for aggregate stats, and replacing existing activity/skill/version behavior.

### Dependencies

- `P4-PUBLIC-SDK`: import-safe public SDK and package export map; dependency is ready for this issue-resolution run.
- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, Cursor path config, process runner flags, stream normalization, and identity model.
- `P2-ACTIVITY`: derived activity manager and activity signal provenance.
- Optional `P3-REPO-ANALYTICS` / `P3-FILE-INTELLIGENCE`: read-only `ai-tracking` enrichment for model-count completeness when available.

### Codex Reference Mapping

Preferred reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent` is an empty placeholder for this run.
Behavioral fallback reference repository root: `/g/gits/tacogips/codex-agent`.

- `/g/gits/tacogips/codex-agent/src/sdk/tool-registry.ts`: reference generic registry and sorted listing.
- `/g/gits/tacogips/codex-agent/src/sdk/tool-versions.ts`: reference bounded subprocess version checks with structured errors.
- `/g/gits/tacogips/codex-agent/src/sdk/model-availability.ts`: reference structured auth/probe result shapes and CLI exit behavior.
- `/g/gits/tacogips/codex-agent/src/sdk/usage-stats.ts`: reference local aggregation, recent-day bucketing, cache behavior, and missing-source degradation.
- `/g/gits/tacogips/codex-agent/src/cli/index.ts`: reference `version` and `model check` CLI contracts.

Intentional divergences accepted by the design:

- Cursor auth is `unknown` by default because no stable local login-status API is available.
- model probing is opt-in and explicitly probe-derived because it may create local Cursor state or consume quota.
- usage stats aggregate repository-owned Cursor indexes and normalized usage events, not Codex rollout files.
- tool registry helpers are local SDK/CLI helpers, not Cursor MCP discovery.

---

## Modules

### 1. Tool Registry Types and SDK Helper

#### `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts`

**Status**: COMPLETED

```typescript
export interface ToolContext {
  readonly sessionId?: string;
  readonly workspace?: string;
}

export interface ToolConfig<TInput, TOutput> {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  run(input: TInput, context?: ToolContext): Promise<TOutput> | TOutput;
}

export interface RegisteredTool<TInput, TOutput> {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  run(input: TInput, context?: ToolContext): Promise<TOutput>;
}
```

**Checklist**:

- [x] Define public registry types without exposing private managers.
- [x] Implement name validation, registration, lookup, sorted list, and typed run helpers.
- [x] Export through `P4-PUBLIC-SDK` SDK entrypoints.
- [x] Add unit tests for duplicate registration, blank names, not-found errors, and async run behavior.

### 2. Version Introspection

#### `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts`

**Status**: COMPLETED

```typescript
export type ToolAvailabilityStatus = "available" | "unavailable" | "unknown" | "not_checked";

export interface ToolVersionInfo {
  readonly name: string;
  readonly command?: string;
  readonly version: string | null;
  readonly status: ToolAvailabilityStatus;
  readonly error?: string;
  readonly checkedAt: string;
}

export interface ToolVersionReport {
  readonly packageVersion: string;
  readonly tools: readonly ToolVersionInfo[];
}
```

**Checklist**:

- [x] Read package version from `package.json`.
- [x] Probe `cursor-agent --version` with timeout and no shell.
- [x] Include Git and Bun only when requested by options/flags.
- [x] Return structured `unavailable` errors for missing commands, non-zero exits, empty stdout, and timeouts.
- [x] Add tests with injectable command runner and timeout cases.

### 3. Conservative Model/Auth Availability

#### `src/cursor/model-availability.ts`, `src/types/model-availability.ts`

**Status**: COMPLETED

```typescript
export interface AuthAvailabilityInfo {
  readonly status: ToolAvailabilityStatus;
  readonly detail: string;
  readonly provenance: "stable_api" | "probe" | "not_available";
}

export interface ModelAvailabilityReport {
  readonly model: string;
  readonly binary: ToolVersionInfo;
  readonly auth: AuthAvailabilityInfo;
  readonly modelReachability: {
    readonly status: ToolAvailabilityStatus;
    readonly probed: boolean;
    readonly output?: string;
    readonly error?: string;
  };
  readonly checkedAt: string;
}
```

**Checklist**:

- [x] Validate non-empty model names.
- [x] Report default auth as `unknown` with `not_available` provenance.
- [x] Report model reachability as `not_checked` unless explicit probe is requested.
- [x] Implement bounded optional probe through Cursor process adapter or injectable command runner.
- [x] Classify trust/auth-looking probe failures conservatively without claiming global auth state.
- [x] Add tests for default no-probe JSON, probe success, probe failure, timeout, and invalid model.

### 4. Usage Stats Types and Aggregator

#### `src/types/usage-stats.ts`, `src/usage/manager.ts`

**Status**: COMPLETED

```typescript
export interface UsageStatsOptions {
  readonly recentDays?: number;
  readonly now?: Date;
  readonly includeAiTracking?: boolean;
}

export interface UsageStatsReport {
  readonly totalSessions: number;
  readonly statusCounts: Record<string, number>;
  readonly activityStatusCounts: Record<string, number>;
  readonly firstSessionDate: string | null;
  readonly lastComputedDate: string;
  readonly models: Record<string, number>;
  readonly recentDailyActivity: readonly DailyUsageActivity[];
  readonly completenessNotes: readonly string[];
}
```

**Checklist**:

- [x] Aggregate session counts from `SessionIndexRepository`.
- [x] Aggregate activity status counts from `ActivityManager`.
- [x] Bucket recent daily activity by indexed session/update dates and activity signal dates.
- [x] Include model counts from session records and optional read-only `ai-tracking` enrichment when requested.
- [x] Include token totals only from repository-owned normalized usage events when that source exists.
- [x] Return completeness notes instead of false zeroes for missing token or enrichment sources.
- [x] Add tests for empty index, missing activity store, missing enrichment, recent-day bounds, and deterministic `now`.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: COMPLETED

```typescript
export interface ToolCommandArgs {
  readonly json: boolean;
  readonly timeoutMs?: number;
  readonly includeGit?: boolean;
  readonly includeBun?: boolean;
}

export interface ModelCheckCommandArgs {
  readonly model: string;
  readonly probe: boolean;
  readonly json: boolean;
  readonly timeoutMs?: number;
}
```

**Checklist**:

- [x] Add `tool list`, `tool show`, `tool run`, and `tool versions` dispatch.
- [x] Add `model check --model <model> [--probe] [--json] [--timeout-ms <ms>]`.
- [x] Add `usage stats [--recent-days <n>] [--json]`.
- [x] Preserve existing `version`, `activity`, and `skill` behavior.
- [x] Use existing exit code conventions for usage, not found, and Cursor/tool failures.
- [x] Add CLI tests for JSON output, tool-run dispatch, no-probe output, probe success, probe failure, timeout, and invalid model input.

### 6. SDK Facade Integration

#### `src/sdk/index.ts`, `src/sdk/helpers.ts`

**Status**: COMPLETED

```typescript
export interface ToolHelperSdk {
  readonly registry: ToolRegistrySdk;
  versions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
  checkModel(options: ModelAvailabilityOptions): Promise<ModelAvailabilityReport>;
  usageStats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
}
```

**Checklist**:

- [x] Add helper facade to `CursorAgentSdk` through the ready `P4-PUBLIC-SDK` entrypoints.
- [x] Support dependency injection for command runner, session repository, activity manager, and clock.
- [x] Keep raw Cursor subprocess output out of public stable result shapes except summarized error/output fields.
- [x] Export testing helpers for deterministic registry and command-runner mocks.

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Tool registry | `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts` | COMPLETED | `src/sdk/tool-registry.test.ts` |
| Version introspection | `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts` | COMPLETED | `src/cursor/tool-versions.test.ts` |
| Model availability | `src/cursor/model-availability.ts`, `src/types/model-availability.ts` | COMPLETED | `src/cursor/model-availability.test.ts` |
| Usage stats | `src/types/usage-stats.ts`, `src/usage/manager.ts` | COMPLETED | `src/usage/manager.test.ts` |
| CLI commands | `src/cli/cli.ts`, `src/main.ts` | COMPLETED | `src/cli/tool-registry-cli.test.ts` |
| SDK integration | `src/sdk/index.ts`, `src/sdk/helpers.ts`, `src/sdk/types.ts`, `src/sdk/testing.ts` | COMPLETED | `src/sdk/index.test.ts`, `src/sdk/testing.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| `P5-TOOL-REGISTRY` SDK exports | `P4-PUBLIC-SDK` | Ready |
| Usage stats session counts | `P1-CORE-FOUNDATION` | Available |
| Usage stats activity counts | `P2-ACTIVITY` | Available |
| Optional model enrichment | `P3-REPO-ANALYTICS` / `P3-FILE-INTELLIGENCE` | Optional |
| Model availability binary evidence | TASK-002 version reader types and service | Planned |
| CLI command dispatch | Existing `src/cli/cli.ts` | Available |

## Parallelizable Tasks

### TASK-001: Tool Registry Core

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts`, tests

**Completion Criteria**:

- [x] Public registry types and implementation exist.
- [x] Registry tests pass.
- [x] SDK export path follows `P4-PUBLIC-SDK`.

### TASK-002: Version Reader

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts`, tests

**Completion Criteria**:

- [x] Bounded no-shell subprocess version reads implemented.
- [x] Missing binary, timeout, empty stdout, and non-zero exit are tested.
- [x] Package version is included without subprocess probing.

### TASK-003: Model Availability Service

**Status**: COMPLETED
**Parallelizable**: No (depends on TASK-002 shared availability and binary-version result types)
**Deliverables**: `src/cursor/model-availability.ts`, `src/types/model-availability.ts`, tests

**Completion Criteria**:

- [x] Default no-probe result reports auth `unknown` and model reachability `not_checked`.
- [x] Explicit probe path is bounded and injectable.
- [x] Trust/auth-looking failures are classified conservatively.

### TASK-004: Usage Stats Aggregator

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/types/usage-stats.ts`, `src/usage/manager.ts`, tests

**Completion Criteria**:

- [x] Session, status, model, activity, and recent daily stats aggregate from local indexes.
- [x] Missing optional sources produce completeness notes.
- [x] Token totals are omitted or marked unknown until a repository-owned usage source exists.

### TASK-005: CLI Integration

**Status**: COMPLETED
**Parallelizable**: No (depends on TASK-001 through TASK-004)
**Deliverables**: `src/cli/cli.ts`, CLI tests

**Completion Criteria**:

- [x] `tool`, `model check`, and `usage stats` commands are documented in CLI usage text; README and user-facing skill refresh are deferred to the workflow's post-implementation documentation step.
- [x] JSON output mirrors SDK result contracts.
- [x] Exit codes follow existing CLI conventions.

### TASK-006: SDK Facade Integration

**Status**: COMPLETED
**Parallelizable**: No (depends on TASK-001 through TASK-004 and `P4-PUBLIC-SDK`)
**Deliverables**: `src/sdk/helpers.ts`, `src/sdk/index.ts`, SDK tests

**Completion Criteria**:

- [x] Helper facade is available from public SDK exports.
- [x] Dependency injection supports deterministic tests.
- [x] Import safety checks still pass.

## Completion Criteria

- [x] Assigned design and implementation plan are accepted.
- [x] All modules implemented with focused tests.
- [x] `task typecheck` passes.
- [x] `task test` passes.
- [x] `task ci` passes.
- [x] Manual non-probe smoke commands succeed.
- [x] Probe smoke command is documented as optional and side-effect-aware.
- [x] Cursor-managed files and databases remain read-only inputs.

## Verification Commands

```bash
task typecheck
task test
task ci
bun run src/main.ts tool versions --json
bun run src/main.ts model check --model test-model --json
bun run src/main.ts usage stats --json
```

Optional manual probe:

```bash
bun run src/main.ts model check --model <known-model> --probe --json --timeout-ms 30000
```

## Risks

- `P4-PUBLIC-SDK` may revise SDK file paths or facade composition before this slice starts.
- Cursor auth/model availability lacks a stable local API, so default checks must remain explicit about uncertainty.
- Probe mode may create local Cursor state or consume quota.
- Usage token totals will be incomplete until normalized usage events are persisted in repository-owned state.
- Private `ai-tracking` schemas may shift and must remain optional enrichment.

## Planning Decisions and User QA Tracking

- User-facing decision tracker: `design-docs/user-qa/pending-tool-registry-model-helpers.md`.
- Ship `tool run` in the first CLI release with strict structured JSON input, registered-tool lookup only, and no Cursor MCP discovery.
- Do not require a dedicated workspace flag for `model check --probe`; keep probe mode opt-in, bounded, and provenance-marked.
- Default `tool versions` output to package metadata and `cursor-agent`; include Bun and Git only behind explicit flags.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Planning only.
**Tasks In Progress**: None.
**Blockers**: Historical note: runtime implementation depended on `P4-PUBLIC-SDK` entrypoints for SDK exports at initial authoring time.
**Notes**: Initial plan authored from codex-agent helper references and adapted to Cursor-safe local boundaries. No runtime code was implemented in this branch.

### Session: 2026-05-07

**Tasks Completed**: Reconciled plan with accepted Step 3 design review for `parity-global-design-plan-implement-loop#P5-TOOL-REGISTRY`.
**Tasks In Progress**: None.
**Blockers**: None for planning; implementation still needs normal task sequencing.
**Notes**: Updated Codex reference root to the fallback `/g/gits/tacogips/codex-agent`, marked `P4-PUBLIC-SDK` ready per workflow intake, and replaced open questions with the accepted Step 4 defaults plus the user-QA tracker path.

### Session: 2026-05-07 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, and TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented the tool registry, version reader, conservative model availability service, usage stats aggregator, CLI dispatch, public SDK helper facade, and focused tests. Verification passed with `task typecheck`, `task test`, `task ci`, and non-probe smoke commands using a writable temporary local state root. README and user-facing skill refresh remain assigned to the workflow's later documentation step.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review

**Tasks Completed**: Addressed Step 7 mid findings for strict `tool run` input and SDK helper dependency injection.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `tool run` now rejects array, string, number, and null JSON inputs with usage exit instead of coercing them to `{}`. `ToolHelperSdkOptions` and `CursorAgentSdkOptions` now support facade-level command-runner and activity-manager injection, with SDK facade tests covering those defaults.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review Round 2

**Tasks Completed**: Addressed Step 7 mid findings for public session repository injection, helper input validation exit codes, and tool command arity.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `CursorAgentSdkOptions` now exposes `sessionRepository` for the public SDK helper facade and the SDK tests cover injected session usage stats. `tool run` validates registered helper input fields before dispatch and returns usage exits for invalid structured input. `tool show` and `tool run` now reject extra positional arguments with usage exits and regression tests.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review Round 3

**Tasks Completed**: Addressed Step 7 mid finding for recent daily usage activity bucketing.
**Tasks In Progress**: None.
**Blockers**: Physical reset of the dirty `divedra` submodule pointer is blocked in this sandbox because `.git/modules/divedra/index.lock` cannot be created on the read-only filesystem.
**Notes**: Usage stats now counts both `createdAt` and `updatedAt` dates in `recentDailyActivity`, de-duplicating same-day hits and preserving `firstSessionDate` from the earliest session date. Added regression coverage for a session created before the recent window and updated inside it. The dirty `divedra` submodule is explicitly excluded from the P5 commit scope; command-node staging must use the Step 6 `changedFiles` list and must not stage `divedra`.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review Round 4

**Tasks Completed**: Addressed Step 7 mid finding for SDK helper clock injection in usage stats.
**Tasks In Progress**: None.
**Blockers**: None for code; dirty `divedra` remains excluded from commit scope per prior note.
**Notes**: `sdk.tools.usageStats()` now uses `CursorAgentSdkOptions.now` as the default `UsageStatsOptions.now` value when callers do not supply one, while preserving explicit per-call `now` overrides. Added SDK facade regression coverage for deterministic `lastComputedDate` and daily bucket dates from the injected clock.

### Session: 2026-05-07 Step 6 Revision After Step 7 Review Round 5

**Tasks Completed**: Addressed Step 7 mid finding for strict numeric validation in `tool run` structured JSON.
**Tasks In Progress**: None.
**Blockers**: None for code; dirty `divedra` remains excluded from commit scope per prior note.
**Notes**: Registered helper numeric fields now require positive integers before dispatch: `tool.versions.timeoutMs`, `model.check.timeoutMs`, and `usage.stats.recentDays`. Added CLI regression coverage for zero, negative, and fractional numeric JSON inputs returning usage exit with no JSON output.

### Session: 2026-05-08 Model Probe Compatibility Follow-up

**Tasks Completed**: Revalidated `model check --probe` against installed `cursor-agent 2026.04.08-a41fba1` and fixed the probe argv shape to use the current positional prompt form (`-- <probe prompt>`) instead of unsupported `--prompt <probe prompt>`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added regression coverage asserting the bounded probe keeps `--model <id>` before the `--` separator and the fixed probe prompt after it. Real wrapper smoke passed for `gpt-5.4-mini-low` and `gpt-5.3-codex-spark-preview-low`; probe results remain explicitly probe-derived and may consume Cursor quota.
