# Repository-Owned Usage Event Persistence

This document defines the `P5-USAGE-EVENT-PERSISTENCE` slice for durable capture of normalized Cursor usage events from wrapper-started runs.

## Overview

`curort-cli-agent` can currently read Cursor transcripts and normalize live `cursor-agent --print --output-format stream-json` output, but Cursor transcripts do not reliably preserve token usage totals. Usage stats must therefore avoid reporting false zeroes or vague missing-source notes when this wrapper has already observed authoritative usage in a live stream.

This slice adds a repository-owned usage event store for normalized events captured from wrapper-started `session run`, `session resume`, `session continue`, `group run`, and `queue run` executions. The store is evidence, not a Cursor-managed source of truth: imported foreign transcripts can still have unknown usage, but wrapper-started runs should retain token totals after the process exits.

Included:

- normalized usage event domain type with session, workspace, model, token, timestamp, source, and provenance fields
- durable repository-owned JSON or SQLite-backed usage event persistence under `getDataDir()`
- adapter-facing extraction from normalized `AgentEvent` usage, not raw Cursor payload parsing in CLI or persistence
- usage stats aggregation that prefers persisted repository-owned events and clearly reports unknown coverage when evidence is absent
- tests for capture, deduplication, aggregation, corrupt store tolerance, and CLI-facing stats output

Excluded:

- mutation of `~/.cursor/projects/*/agent-transcripts/*.jsonl`, `worker.log`, or Cursor internal state
- cloud APIs, remote billing reconciliation, daemon supervision, server routes, or SDK exports
- attempting to infer exact tokens for historical sessions that were not started by this wrapper
- changing queue or group lifecycle semantics beyond recording usage for their wrapper-started child sessions

## Source Issue Mapping

- Feature ID: `P5-USAGE-EVENT-PERSISTENCE`
- Feature title: Repository-Owned Usage Event Persistence
- Target feature area: `usage-stats`
- Requested behavior: durable capture of normalized Cursor usage events from wrapper-started runs so usage stats can report token totals from repository-owned evidence instead of false zeroes or missing-source notes
- Dependencies: `P1-CORE-FOUNDATION`, `P2-ACTIVITY`

## Codex Reference Mapping

Reference repository root: `/Users/taco/gits/tacogips/codex-agent`.

Relevant files:

- `/Users/taco/gits/tacogips/codex-agent/src/sdk/usage-stats.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/usage-stats.test.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/process/manager.ts`

Reference behavior to preserve:

- aggregate token totals by model and recent day
- expose first/last computed dates and recent daily activity with empty days represented
- tolerate missing or malformed source files without failing the whole stats request
- normalize multiple usage shapes into one model/input/output/cache-read/cache-write contract
- handle repeated cumulative token events by converting them to positive deltas
- keep process streaming and usage aggregation testable with local fixtures

Intentional Cursor divergence:

- Codex scans durable rollout JSONL files; this project persists normalized Cursor usage events at capture time because Cursor transcripts may omit usage after process exit.
- Codex can derive stats for all rollout-backed sessions; this slice only claims token certainty for wrapper-started runs that emitted usage and were persisted.
- Cursor-specific payload parsing remains in `src/cursor/stream-normalizer.ts` or a sibling adapter helper; persistence stores only normalized usage event records.
- The stats response must distinguish `usageProvenance: "repository_usage_events"` (a usage event store is wired into aggregation) from `usageProvenance: "unavailable"` (no store was injected) instead of implying repository-owned token evidence or all-zero truth when neither applies.

## Usage Event Model

Each persisted record represents one normalized usage observation for a known Cursor session.

Required fields:

- `eventId`: stable repository-owned id used for idempotent writes
- `sessionId`: Cursor `localSessionId` from normalized events
- `recordId`: repository-owned session record id when resolvable
- `cursorChatId`: Cursor chat id when resolvable
- `workspacePath` and `workspaceSlug`: workspace evidence available at capture time
- `model`: model id from stream initialization or usage payload, or `unknown`
- `observedAt`: ISO timestamp when the usage event was observed
- `source`: normalized event source, initially `stream_result`
- token fields: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`
- `provenance`: always `repository_usage_events`

Rules:

- Token fields are non-negative integers.
- `totalTokens` is stored explicitly as the observed total when present, otherwise as the sum of component token fields.
- Missing component fields default to zero only inside a persisted event that has at least one positive token value.
- Events with no positive token evidence are ignored and must not create zero-token records.
- Duplicate event ids are idempotent; a retry or duplicate normalized event must not double count.
- The store may keep raw payload hashes or source sequence ids for deduplication, but not raw Cursor payloads.

## Capture Flow

1. `CursorStreamNormalizer` continues to emit `session.completed` with optional normalized `usage`.
2. A usage extractor converts the normalized completion event plus current session context into a `UsageEvent`.
3. CLI wrapper flows enqueue usage persistence beside the existing activity signal write chain.
4. Session identity enrichment resolves `recordId`, `cursorChatId`, `workspacePath`, `workspaceSlug`, and model from the session index and stream start event cache when available.
5. The usage store writes the event atomically under repository-owned state.
6. Capture failure is reported as a non-fatal warning in verbose/debug paths only; it must not change Cursor process exit status.

Wrapper flows that must capture usage:

- `session run`
- `session resume`
- `session continue`
- `group run`
- `queue run`

## Aggregation Flow

Usage stats should aggregate from the repository-owned usage event store, joined with session index metadata when available.

Stats output should include:

- total sessions with usage evidence
- total input, output, cache-read, cache-write, and total tokens
- model usage totals
- recent daily activity with `tokensByModel`
- evidence coverage counts for sessions with usage, sessions without usage, and wrapper-started sessions without usage events
- provenance and caveat fields that explain whether totals are complete for repository-owned evidence only

Aggregation rules:

- Use `observedAt` for daily buckets unless a future implementation stores a stronger completed-at timestamp.
- Sort daily buckets deterministically by date.
- Group by `model`, with `unknown` allowed only when no reliable model evidence exists.
- Do not scan Cursor transcripts for token totals unless a future adapter can prove a stable token field.
- When no usage event store is available to the aggregator, return empty token totals with `usageProvenance: "unavailable"` and a completeness note that persisted wrapper captures are omitted.
- When a store is wired but contains no matching events (including a missing on-disk file recovered as empty), return empty token totals with `usageProvenance: "repository_usage_events"` and explicit coverage counts, not a false claim that all sessions used zero tokens.
- When a wired store's `listEvents` rejects for a given aggregation run (unexpected failure path or non-default store implementations), omit evidence for that run: empty token totals, zeroed coverage counts, an explicit completeness note, and retain `usageProvenance: "repository_usage_events"` so JSON does not claim repository evidence was absent altogether.

## CLI Contract

The exact command shape may reuse the existing usage stats entrypoint if present, or add a focused top-level command in the usage-stats area.

Recommended command:

```bash
curort-cli-agent usage stats [--workspace <path>] [--session <id>] [--recent-days <n>] [--json]
```

Behavior:

- `--workspace` filters by resolved workspace path or workspace slug.
- `--session` filters by `localSessionId`, `cursorChatId`, or `recordId`.
- `--recent-days` controls daily activity range and must be a positive integer.
- `--json` emits stable structured totals, model usage, daily activity, coverage, and provenance.
- Human output should never show token totals as complete when coverage is partial or absent.

## Persistence Boundary

The usage store is repository-owned state under `getDataDir()` and must be isolated from Cursor-owned directories. A JSON store is acceptable for the first slice if it follows the existing atomic write pattern used by `activity-store`; SQLite is also acceptable if it reuses `state.db` safely.

Required persistence behavior:

- atomic writes
- missing store returns an empty event set
- corrupt store returns an empty event set or a recoverable warning, not a crash
- deterministic ordering by `observedAt`, then `eventId`
- append/upsert by `eventId` for idempotence
- pruning is optional and out of scope unless storage growth becomes a real issue

## Dependencies

`P1-CORE-FOUNDATION` must provide:

- normalized `AgentEvent` stream output
- session index repository
- Cursor process runner flows for session, group, and queue execution
- `getDataDir()` repository-owned state path helpers

`P2-ACTIVITY` must provide:

- established wrapper-run signal capture pattern
- write-chain style non-blocking persistence from stream/process observations
- clear separation between normalized events, CLI orchestration, and repository-owned cache files

## Rollout Constraints

- Do not implement runtime code in this design branch.
- Keep raw Cursor stream or transcript payload knowledge inside `src/cursor/`.
- Do not write to `~/.cursor/skills-cursor/`, Cursor transcripts, worker logs, or Cursor `ai-tracking` databases.
- Preserve existing command exit behavior when usage persistence fails.
- Use project automation for implementation verification: `task typecheck`, `task test`, and `task ci`.

## Open Questions

None blocking for this slice. Exact CLI naming can be aligned with any existing usage-stats command during implementation, provided the JSON contract preserves coverage and provenance.

## References

- `impl-plans/completed/usage-event-persistence.md`
- `design-docs/specs/design-activity.md`
- `design-docs/specs/architecture.md`
- `design-docs/references/README.md`
