# Tool Registry, Model Helpers, and Usage Stats Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-tool-registry-model-helpers.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-07

---

## Design Document Reference

**Source**: `design-docs/specs/design-tool-registry-model-helpers.md`

### Summary

Implement Phase 5 `P5-TOOL-REGISTRY`: Cursor-safe helper APIs for a typed tool registry, tool/version introspection, conservative model/auth checks, and local usage/activity stats derived from repository-owned indexes.

### Scope

**Included**: SDK helper contracts, local registry implementation, bounded subprocess version readers, conservative model availability service, optional explicit model probe, usage stats aggregation, CLI commands, and focused tests.

**Excluded**: runtime implementation in this planning branch, mutation of Cursor-managed files/databases, remote model catalogs, undocumented Cursor APIs, live transcript content scanning for aggregate stats, and replacing existing activity/skill/version behavior.

### Dependencies

- `P4-PUBLIC-SDK`: import-safe public SDK and package export map.
- `P1-CORE-FOUNDATION`: `SessionIndexRepository`, Cursor path config, process runner flags, stream normalization, and identity model.
- `P2-ACTIVITY`: derived activity manager and activity signal provenance.
- Optional `P3-REPO-ANALYTICS` / `P3-FILE-INTELLIGENCE`: read-only `ai-tracking` enrichment for model-count completeness when available.

### Codex Reference Mapping

Reference repository root: `/g/gits/tacogips/cursor-cli-agent/codex-agent`

- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/tool-registry.ts`: reference generic registry and sorted listing.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/tool-versions.ts`: reference bounded subprocess version checks with structured errors.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/model-availability.ts`: reference structured auth/probe result shapes and CLI exit behavior.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/sdk/usage-stats.ts`: reference local aggregation, recent-day bucketing, cache behavior, and missing-source degradation.
- `/g/gits/tacogips/cursor-cli-agent/codex-agent/src/cli/index.ts`: reference `version` and `model check` CLI contracts.

Intentional divergences accepted by the design:

- Cursor auth is `unknown` by default because no stable local login-status API is available.
- model probing is opt-in and explicitly probe-derived because it may create local Cursor state or consume quota.
- usage stats aggregate repository-owned Cursor indexes and normalized usage events, not Codex rollout files.
- tool registry helpers are local SDK/CLI helpers, not Cursor MCP discovery.

---

## Modules

### 1. Tool Registry Types and SDK Helper

#### `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts`

**Status**: NOT_STARTED

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

- [ ] Define public registry types without exposing private managers.
- [ ] Implement name validation, registration, lookup, sorted list, and typed run helpers.
- [ ] Export through `P4-PUBLIC-SDK` SDK entrypoints.
- [ ] Add unit tests for duplicate registration, blank names, not-found errors, and async run behavior.

### 2. Version Introspection

#### `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts`

**Status**: NOT_STARTED

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

- [ ] Read package version from `package.json`.
- [ ] Probe `cursor-agent --version` with timeout and no shell.
- [ ] Include Git and Bun only when requested by options/flags.
- [ ] Return structured `unavailable` errors for missing commands, non-zero exits, empty stdout, and timeouts.
- [ ] Add tests with injectable command runner and timeout cases.

### 3. Conservative Model/Auth Availability

#### `src/cursor/model-availability.ts`, `src/types/model-availability.ts`

**Status**: NOT_STARTED

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

- [ ] Validate non-empty model names.
- [ ] Report default auth as `unknown` with `not_available` provenance.
- [ ] Report model reachability as `not_checked` unless explicit probe is requested.
- [ ] Implement bounded optional probe through Cursor process adapter or injectable command runner.
- [ ] Classify trust/auth-looking probe failures conservatively without claiming global auth state.
- [ ] Add CLI tests for default no-probe JSON, probe success, probe failure, timeout, and invalid model.

### 4. Usage Stats Types and Aggregator

#### `src/types/usage-stats.ts`, `src/usage/manager.ts`

**Status**: NOT_STARTED

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

- [ ] Aggregate session counts from `SessionIndexRepository`.
- [ ] Aggregate activity status counts from `ActivityManager`.
- [ ] Bucket recent daily activity by indexed session/update dates and activity signal dates.
- [ ] Include model counts from session records and optional `ai-tracking` enrichment when available.
- [ ] Include token totals only from repository-owned normalized usage events when that source exists.
- [ ] Return completeness notes instead of false zeroes for missing token or enrichment sources.
- [ ] Add tests for empty index, missing activity store, missing enrichment, recent-day bounds, and deterministic `now`.

### 5. CLI Commands

#### `src/cli/cli.ts`

**Status**: NOT_STARTED

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

- [ ] Add `tool list`, `tool show`, `tool run`, and `tool versions` dispatch.
- [ ] Add `model check --model <model> [--probe] [--json] [--timeout-ms <ms>]`.
- [ ] Add `usage stats [--recent-days <n>] [--json]`.
- [ ] Preserve existing `version`, `activity`, and `skill` behavior.
- [ ] Use existing exit code conventions for usage, not found, and Cursor/tool failures.
- [ ] Add CLI tests for human and JSON output.

### 6. SDK Facade Integration

#### `src/sdk/index.ts`, `src/sdk/helpers.ts`

**Status**: NOT_STARTED

```typescript
export interface ToolHelperSdk {
  readonly registry: ToolRegistrySdk;
  versions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
  checkModel(options: ModelAvailabilityOptions): Promise<ModelAvailabilityReport>;
  usageStats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
}
```

**Checklist**:

- [ ] Add helper facade to `CursorAgentSdk` once `P4-PUBLIC-SDK` is available.
- [ ] Support dependency injection for command runner, session repository, activity manager, and clock.
- [ ] Keep raw Cursor subprocess output out of public stable result shapes except summarized error/output fields.
- [ ] Export testing helpers for deterministic registry and command-runner mocks.

## Module Status

| Module | File Path | Status | Tests |
|---|---|---|---|
| Tool registry | `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts` | NOT_STARTED | planned |
| Version introspection | `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts` | NOT_STARTED | planned |
| Model availability | `src/cursor/model-availability.ts`, `src/types/model-availability.ts` | NOT_STARTED | planned |
| Usage stats | `src/types/usage-stats.ts`, `src/usage/manager.ts` | NOT_STARTED | planned |
| CLI commands | `src/cli/cli.ts` | NOT_STARTED | planned |
| SDK integration | `src/sdk/index.ts`, `src/sdk/helpers.ts` | NOT_STARTED | planned |

## Dependencies

| Feature | Depends On | Status |
|---|---|---|
| `P5-TOOL-REGISTRY` SDK exports | `P4-PUBLIC-SDK` | BLOCKED until public SDK entrypoints exist |
| Usage stats session counts | `P1-CORE-FOUNDATION` | Available |
| Usage stats activity counts | `P2-ACTIVITY` | Available |
| Optional model enrichment | `P3-REPO-ANALYTICS` / `P3-FILE-INTELLIGENCE` | Optional |
| CLI command dispatch | Existing `src/cli/cli.ts` | Available |

## Parallelizable Tasks

### TASK-001: Tool Registry Core

**Status**: NOT_STARTED
**Parallelizable**: Yes
**Deliverables**: `src/types/tool-registry.ts`, `src/sdk/tool-registry.ts`, tests

**Completion Criteria**:

- [ ] Public registry types and implementation exist.
- [ ] Registry tests pass.
- [ ] SDK export path follows `P4-PUBLIC-SDK`.

### TASK-002: Version Reader

**Status**: NOT_STARTED
**Parallelizable**: Yes
**Deliverables**: `src/cursor/tool-versions.ts`, `src/types/tool-versions.ts`, tests

**Completion Criteria**:

- [ ] Bounded no-shell subprocess version reads implemented.
- [ ] Missing binary, timeout, empty stdout, and non-zero exit are tested.
- [ ] Package version is included without subprocess probing.

### TASK-003: Model Availability Service

**Status**: NOT_STARTED
**Parallelizable**: Yes
**Deliverables**: `src/cursor/model-availability.ts`, `src/types/model-availability.ts`, tests

**Completion Criteria**:

- [ ] Default no-probe result reports auth `unknown` and model reachability `not_checked`.
- [ ] Explicit probe path is bounded and injectable.
- [ ] Trust/auth-looking failures are classified conservatively.

### TASK-004: Usage Stats Aggregator

**Status**: NOT_STARTED
**Parallelizable**: Yes
**Deliverables**: `src/types/usage-stats.ts`, `src/usage/manager.ts`, tests

**Completion Criteria**:

- [ ] Session, status, model, activity, and recent daily stats aggregate from local indexes.
- [ ] Missing optional sources produce completeness notes.
- [ ] Token totals are omitted or marked unknown until a repository-owned usage source exists.

### TASK-005: CLI Integration

**Status**: NOT_STARTED
**Parallelizable**: No (depends on TASK-001 through TASK-004)
**Deliverables**: `src/cli/cli.ts`, CLI tests

**Completion Criteria**:

- [ ] `tool`, `model check`, and `usage stats` commands are documented in usage text.
- [ ] JSON output mirrors SDK result contracts.
- [ ] Exit codes follow existing CLI conventions.

### TASK-006: SDK Facade Integration

**Status**: NOT_STARTED
**Parallelizable**: No (depends on TASK-001 through TASK-004 and `P4-PUBLIC-SDK`)
**Deliverables**: `src/sdk/helpers.ts`, `src/sdk/index.ts`, SDK tests

**Completion Criteria**:

- [ ] Helper facade is available from public SDK exports.
- [ ] Dependency injection supports deterministic tests.
- [ ] Import safety checks still pass.

## Completion Criteria

- [ ] Assigned design and implementation plan are accepted.
- [ ] All modules implemented with focused tests.
- [ ] `task typecheck` passes.
- [ ] `task test` passes.
- [ ] `task ci` passes.
- [ ] Manual non-probe smoke commands succeed.
- [ ] Probe smoke command is documented as optional and side-effect-aware.
- [ ] Cursor-managed files and databases remain read-only inputs.

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

## Open Questions

- Should `tool run` be included in the first CLI implementation or deferred to SDK-only usage?
- Should `model check --probe` require an explicit `--workspace` argument?
- Which optional binary versions should be included by default beyond package and `cursor-agent`?

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Planning only.
**Tasks In Progress**: None.
**Blockers**: Runtime implementation depends on `P4-PUBLIC-SDK` entrypoints for SDK exports.
**Notes**: Initial plan authored from codex-agent helper references and adapted to Cursor-safe local boundaries. No runtime code was implemented in this branch.
