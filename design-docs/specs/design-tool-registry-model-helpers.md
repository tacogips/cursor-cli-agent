# Tool Registry, Model Helpers, and Usage Stats

This document defines the Phase 5 `P5-TOOL-REGISTRY` slice for Cursor-safe tool registry helpers, version introspection, conservative model/auth availability checks, and usage/activity statistics derived from local indexes.

## Overview

The feature provides scriptable and SDK-facing helper APIs around the local `curort-cli-agent` runtime. It mirrors useful `codex-agent` helper concepts while adapting them to Cursor's local boundaries: `cursor-agent` subprocesses, repository-owned state, local transcript indexes, activity signals, optional `ai-tracking` enrichment, and import-safe public SDK exports.

Included:

- generic SDK tool registry and typed registered-tool contracts
- tool/version introspection for package, `cursor-agent`, Bun, Git, and configured helper binaries
- conservative model/auth availability checks with explicit `available`, `unavailable`, `unknown`, and `not_checked` states
- usage and activity stats from repository-owned session, activity, and optional usage indexes
- CLI commands and SDK exports for the above helpers
- tests for registry behavior, subprocess failures/timeouts, degraded availability, stats aggregation, and JSON output

Excluded:

- runtime implementation in this design branch
- mutation of Cursor-managed transcript files, `ai-tracking`, or internal skill directories
- remote model catalog discovery or undocumented Cursor API calls
- treating a successful model probe as a durable authorization guarantee
- live transcript content scanning for aggregate stats
- replacing existing `activity`, `skill`, or package `version` commands

## User-Facing Contract

Proposed commands:

```bash
curort-cli-agent tool list [--json]
curort-cli-agent tool show <name> [--json]
curort-cli-agent tool run <name> --input <json|path> [--json]
curort-cli-agent tool versions [--include-git] [--include-bun] [--json] [--timeout-ms <ms>]
curort-cli-agent model check --model <model> [--probe] [--json] [--timeout-ms <ms>]
curort-cli-agent usage stats [--recent-days <n>] [--json]
```

Rules:

- `tool list` and `tool show` expose registered local helper tools, not Cursor MCP tools.
- `tool run` accepts structured JSON input and returns the registered tool output or a not-found/usage error.
- `tool versions` always includes package metadata and attempts bounded `--version` subprocess reads for configured tools.
- `model check` without `--probe` reports binary availability and `unknown` auth/model reachability when Cursor lacks stable local evidence.
- `model check --probe` may spawn `cursor-agent` with a bounded prompt and must mark the result as probe-derived, not guaranteed.
- `usage stats` refreshes/imports known sessions through the existing repository-owned index and aggregates only local indexed evidence.

All JSON responses must include provenance and degraded-state fields when data sources are missing or intentionally skipped.

## SDK Contract

This feature depends on `P4-PUBLIC-SDK` for import-safe exports. The helper facade extends the public SDK without exposing raw Cursor payloads:

```typescript
export interface ToolRegistrySdk {
  list(): readonly ToolSummary[];
  get(name: string): RegisteredTool<unknown, unknown> | null;
  run<TInput, TOutput>(
    name: string,
    input: TInput,
    context?: ToolContext,
  ): Promise<TOutput>;
}

export interface ToolHelperSdk {
  readonly registry: ToolRegistrySdk;
  versions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
  checkModel(options: ModelAvailabilityOptions): Promise<ModelAvailabilityReport>;
  usageStats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
}
```

The registry is intentionally generic and local. It is useful for public SDK consumers, CLI helper composition, and tests, but it must not bypass existing domain managers or persistence boundaries.

## Data Sources

Primary repository-owned sources:

- `SessionIndexRepository` for local session identity, status, workspace, model, created/updated timestamps, and transcript paths.
- `ActivityManager` and `activity-signals.json` for derived activity status and signal provenance.
- Future repository-owned usage store for normalized `AgentEvent.usage` captured during wrapper-started runs.
- Package metadata from `package.json`.

Read-only Cursor sources:

- `cursor-agent --version` when the binary is available.
- Optional `~/.cursor/ai-tracking/ai-code-tracking.db` enrichment through adapter modules only.
- Transcript file metadata as imported by the session index, not direct aggregate transcript scanning.

Optional subprocess sources:

- `git --version` and `bun --version` only when requested or configured.
- bounded model probe only when the caller explicitly sets `--probe` or equivalent SDK option.

## Availability Model

Availability must distinguish evidence from inference:

- `available`: stable local evidence or successful bounded probe exists.
- `unavailable`: stable local evidence or subprocess failure proves absence/failure.
- `unknown`: Cursor has no stable local API for the requested fact.
- `not_checked`: caller disabled an optional probe or source.

Auth checks:

- Cursor does not currently provide a stable equivalent to `codex login status`.
- Default auth result is `unknown` with a note that no stable local auth-status API is available.
- A failed model probe may classify obvious authentication, trust, or billing text only through normalized stderr/stdout pattern helpers; otherwise it remains a probe failure with raw text summarized, not a global auth claim.

Model checks:

- A non-empty model string can be validated syntactically.
- A successful explicit probe marks that model as `available` for the current binary, workspace, environment, and timestamp.
- A skipped probe returns `not_checked` for model reachability.

## Usage and Activity Stats

Stats are local and best-effort:

- total indexed sessions
- status counts by session status and activity status
- first and last indexed session dates
- recent daily activity by session creation/update dates and activity signal dates
- model counts from indexed session records and optional `ai-tracking` conversation summaries
- token usage only from repository-owned normalized usage events when available
- degraded provenance when a source is missing, unreadable, or not implemented yet

The stats service must not claim zero token usage when no token source exists. It should report `unknown` or omit token totals with a completeness note.

## Codex Reference Mapping

Reference repository root for this workflow run: `/g/gits/tacogips/codex-agent`.
The supplied preferred root `/g/gits/tacogips/cursor-cli-agent/codex-agent`
exists as a placeholder but contains no files, so implementation planning should
use the fallback root above for behavioral reference.

Relevant files:

- `/g/gits/tacogips/codex-agent/src/sdk/tool-registry.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/tool-versions.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/model-availability.ts`
- `/g/gits/tacogips/codex-agent/src/sdk/usage-stats.ts`
- `/g/gits/tacogips/codex-agent/src/cli/index.ts`

Reference behavior to preserve:

- simple typed tool registration and sorted listing
- version checks are bounded subprocess probes that return structured errors instead of throwing for missing tools
- model checks return structured auth/probe details and non-zero CLI exit for unavailable results
- usage stats cache briefly and degrade gracefully when local sources are missing
- CLI JSON output mirrors SDK result shapes

Intentional Cursor divergences:

- `cursor-agent` replaces `codex` as the primary binary, but package `version` remains the authoritative wrapper version.
- Cursor has no stable local auth-status command, so auth is `unknown` by default rather than inferred.
- model probing is opt-in because it can create local Cursor session state, consume model quota, or require workspace trust.
- usage/activity stats derive from repository-owned indexes and normalized events, not Codex rollout files.
- session identity preserves `recordId`, `localSessionId`, `cursorChatId`, and `identityState`.

## Dependency Map

| Capability | Required Dependency | Reason |
|---|---|---|
| Public SDK exports | `P4-PUBLIC-SDK` | Helper APIs must attach to import-safe package exports. |
| Session stats | `P1-CORE-FOUNDATION` | Uses session index, paths, transcript import, and Cursor identity model. |
| Activity stats | `P2-ACTIVITY` | Uses derived activity manager and signal provenance. |
| Model metadata | `P1-CORE-FOUNDATION` | Reuses process-runner flags, stream normalizer, and trust failure helpers. |
| Optional model counts | `P3-FILE-INTELLIGENCE` / `P3-REPO-ANALYTICS` | Reuses read-only `ai-tracking` adapter enrichment where available. |

## Verification

Implementation should be verified with:

```bash
task typecheck
task test
task ci
bun run src/main.ts tool versions --json
bun run src/main.ts model check --model test-model --json
bun run src/main.ts usage stats --json
```

Probe-specific smoke checks must be manual and opt-in:

```bash
bun run src/main.ts model check --model <known-model> --probe --json --timeout-ms 30000
```

## Risks

- Cursor auth and model availability may change without a stable local command contract.
- Explicit model probes can create local session state or consume quota, so default behavior must stay non-probing.
- Aggregated token usage will be incomplete until wrapper-started runs persist normalized usage events.
- `ai-tracking` schema details are private and must remain optional read-only enrichment.
- Public SDK helper exports depend on `P4-PUBLIC-SDK` entrypoint decisions.

## Open Questions

Pending user-facing rollout decisions are tracked in
`design-docs/user-qa/pending-tool-registry-model-helpers.md`.

Default decisions for Step 4 planning until the user overrides them:

- Ship `tool run` in the first CLI release with strict structured JSON input,
  registered-tool lookup only, and no Cursor MCP discovery.
- Do not require a dedicated workspace flag for `model check --probe`; keep
  probe mode explicitly opt-in, bounded, and provenance-marked.
- Include only package metadata and `cursor-agent` in default version output;
  keep Bun and Git behind their explicit include flags and do not add other
  optional binaries by default.

## References

- `design-docs/specs/design-public-sdk.md`
- `design-docs/specs/design-activity.md`
- `design-docs/specs/design-repository-analytics.md`
