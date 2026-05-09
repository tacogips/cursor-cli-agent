# Parity Backlog Workflow Design

This document defines a project-local `divedra` workflow that keeps
`cursor-cli-agent` moving through the remaining parity backlog by selecting one
ready capability slice at a time and delegating that slice into
`design-and-implement-review-loop`.

## Overview

The repository already has:

- a parity roadmap in `design-docs/specs/design-codex-agent-parity-gap.md`
- a single-slice design/plan/implement workflow in
  `.divedra/workflows/design-and-implement-review-loop`
- a quality loop in `.divedra/workflows/recent-change-quality-loop`

What it did not have was a workflow that owns the remaining feature backlog and
keeps feeding ready items into the existing implementation loop until the
backlog is exhausted or paused by dependency or run-limit rules.

## Goals

- maintain a canonical backlog for the remaining phase-2 through phase-5 parity
  work
- derive the next ready implementation slice from repository design and plan
  state instead of relying on an ad hoc prompt
- delegate exactly one backlog item at a time into
  `design-and-implement-review-loop`
- re-scan the repository after each delegated run and continue until no ready
  item remains
- avoid duplicate ownership when an active implementation plan already covers a
  backlog item

## Non-Goals

- implementing feature code directly inside the backlog workflow
- bypassing design or implementation-plan review gates
- inventing backlog items that are not grounded in the parity-gap design
- forcing progress on items that are blocked by missing prerequisite slices

## Source Of Truth

The workflow must derive backlog state from these repository inputs, in this
order:

1. `design-docs/specs/design-parity-backlog-workflow.md`
2. `design-docs/specs/design-codex-agent-parity-gap.md`
3. `impl-plans/active/*.md`
4. `impl-plans/completed/*.md`
5. `impl-plans/PROGRESS.json`

If these sources drift, this document wins for backlog item identity and
ordering, while the active and completed plans provide the current execution
state.

## Canonical Backlog Item Model

Each backlog item is a logical implementation slice with these fields:

- `id`: stable backlog identifier such as `P2-SESSION-SEARCH`
- `phase`: one of `2`, `3`, `4`, or `5`
- `title`: short operator-facing name
- `targetFeatureArea`: concise feature-area label for delegated workflow input
- `requestedBehavior`: single-slice behavior contract for
  `design-and-implement-review-loop`
- `dependencyIds`: backlog items that must be completed first
- `sourceReferences`: design docs that justify the slice

Runtime state derived by the workflow:

- `status`: `completed`, `blocked`, `ready`, or `filtered`
- `blockingReason`: dependency or active-plan reason when blocked
- `completionEvidence`: accepted delegated workflow result or matching completed
  plan

## Canonical Backlog

The workflow must treat the following list as the default remaining parity
inventory.

| ID | Phase | Title | Target Feature Area | Depends On |
|---|---|---|---|---|
| `P2-SESSION-SEARCH` | 2 | Session metadata search | `session metadata search` | - |
| `P2-TRANSCRIPT-SEARCH` | 2 | Transcript full-text search | `transcript full-text search` | `P2-SESSION-SEARCH` |
| `P2-BOOKMARKS` | 2 | Bookmark lifecycle | `bookmarks` | `P2-TRANSCRIPT-SEARCH` |
| `P2-ACTIVITY` | 2 | Activity derivation | `activity tracking` | - |
| `P2-MARKDOWN-TASKS` | 2 | Markdown and task extraction | `markdown task extraction` | `P2-TRANSCRIPT-SEARCH` |
| `P3-GROUP-LIFECYCLE` | 3 | Advanced group controls | `advanced group lifecycle` | `P2-ACTIVITY` |
| `P3-QUEUE-LIFECYCLE` | 3 | Advanced queue controls | `advanced queue lifecycle` | `P2-ACTIVITY` |
| `P3-FILE-INTELLIGENCE` | 3 | File intelligence | `file intelligence` | `P2-SESSION-SEARCH` |
| `P3-REPO-ANALYTICS` | 3 | Commit and repository analytics | `repository analytics` | `P3-FILE-INTELLIGENCE` |
| `P4-HTTP-SERVER` | 4 | REST server surface | `http server` | `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE` |
| `P4-SSE` | 4 | Live event streaming | `server event streaming` | `P4-HTTP-SERVER`, `P2-ACTIVITY` |
| `P4-AUTH` | 4 | Token and bearer auth | `server auth` | `P4-HTTP-SERVER` |
| `P4-DAEMON` | 4 | Daemon lifecycle | `daemon mode` | `P4-HTTP-SERVER`, `P4-SSE` |
| `P4-PUBLIC-SDK` | 4 | Public SDK facade | `public sdk` | `P4-HTTP-SERVER` |
| `P5-COMPAT-BRIDGE` | 5 | Optional compatibility bridge | `compatibility bridge` | `P4-HTTP-SERVER`, `P4-PUBLIC-SDK` |
| `P5-TOOL-REGISTRY` | 5 | Tool and model availability helpers | `tool registry` | `P4-PUBLIC-SDK` |

## Selection Rules

### Completed

An item is `completed` when at least one of these conditions is true:

- a delegated `design-and-implement-review-loop` result in the current run
  reports an accepted `issue-resolution` completion for that item
- a completed implementation plan or merged design/implementation evidence makes
  it clear that the capability already landed

### Blocked

An item is `blocked` when any dependency item is not yet completed.

An aligned active implementation plan for the same scope is not a blocker for
this workflow. It is implementation input for the delegated
`design-and-implement-review-loop`; the parent parity loop should keep the item
ready unless implementation evidence shows the capability has already landed.

### Ready

An item is `ready` only when:

- it matches the requested phase filter, if any
- it is not already completed
- it is not blocked
- it is the earliest slice by phase order and table order among the ready set

## Workflow Shape

The workflow bundle name is `parity-backlog-design-implement-loop`.

### Step 1: Backlog Review

Read the source-of-truth docs and plan files, compute the backlog state, count
already-completed items in the current run, and select the next ready slice.

### Step 2: Selection Gate

Exit when no ready slice remains or when the configured per-run limit has been
reached. Otherwise route to delegated handoff.

### Step 3: Delegated Handoff

Create a narrow `issue-resolution` request for
`design-and-implement-review-loop` using the selected backlog item's
`targetFeatureArea`, `requestedBehavior`, dependencies, and source references.

### Step 4: Post-Handoff Sync

Consume the delegated result, record accepted completion evidence for the current
run, and route back to Step 1 for another repository scan.

### Workflow Output

Publish the run summary:

- items completed in this run
- remaining ready items
- blocked items and reasons
- delegated workflow runs and commit evidence

## Global Design-Plan-Implement Workflow

The alternate workflow bundle name is
`parity-global-design-plan-implement-loop`.

This workflow is for larger parity catch-up runs where the efficient path is to
settle the complete target design and the complete implementation-plan batch
before any feature implementation starts.

### Step 1: Global Design

Create or update the global parity design for all selected phases. This step
must cover the canonical backlog, dependency graph, Cursor-specific adapter
boundaries, codex-agent references, intentional divergences, and expected
implementation-plan paths.

### Step 2: Global Design Review

Review Step 1 before implementation-plan creation. Blocking design findings
route back to Step 1.

### Step 3: Batch Implementation Plans

Create or update one active implementation plan per selected backlog item before
any delegated implementation begins. Plans must preserve dependency order and
identify parallelizable work only when write scopes are disjoint.

### Step 4: Batch Implementation-Plan Review

Review the complete plan batch before any feature handoff. Design-level blocking
findings route back to Step 1; plan-only blocking findings route back to Step 3.

### Step 5: Ready Plan Selection

Deterministically select the next ready plan from the reviewed batch. A plan is
eligible only when its active plan file exists, its dependencies are completed,
and the current run has not reached `maxItemsPerRun`.

### Step 6: Delegated Handoff

Package the selected plan as a single `issue-resolution` request for
`design-and-implement-review-loop`. This step does not implement locally.

### Step 7: Post-Handoff Sync

Summarize the delegated implementation result for the selected backlog item,
including changed files, plan updates, verification, commit evidence, and risks.

### Step 8: Parent Review

Review the delegated result before another item can be selected. Blocking
findings route another handoff for the same item; accepted results return to
Step 5.

## Runtime Inputs

Supported workflow input fields:

- `backlogSourceDoc`: optional override; defaults to
  `design-docs/specs/design-parity-backlog-workflow.md`
- `targetPhases`: optional subset of `["2", "3", "4", "5"]`
- `maxItemsPerRun`: optional integer; defaults to `999`
- `includePartialCapabilities`: optional boolean; defaults to `true`
- `referenceRepositoryRoot`: optional local Codex reference root; defaults to
  `/Users/taco/gits/tacogips/codex-agent`
- `referenceRepositoryUrl`: optional upstream reference URL

## Expected Delegated Input Contract

Each delegated run into `design-and-implement-review-loop` must use
`executionMode: "issue-resolution"` and include:

- an item-specific `issueTitle`
- item-specific `targetFeatureArea`
- a precise `requestedBehavior`
- `reviewContext.backlogItem`
- `reviewContext.remainingDependencies`
- `reviewContext.sourceReferences`

This keeps the child workflow bounded to a single slice while preserving the
larger parity-program context.

For `parity-global-design-plan-implement-loop`, Step 6 must include this
reviewed global-design context in every delegated input:

```json
{
  "executionMode": "issue-resolution",
  "issueTitle": "<backlog-id>: <title>",
  "targetFeatureArea": "<targetFeatureArea>",
  "requestedBehavior": "<single backlog item behavior>",
  "reviewContext": {
    "workflowMode": "global-design-plan-implement",
    "backlogItem": "<backlog-id>",
    "designDocPath": "design-docs/specs/design-<topic>.md",
    "implementationPlanPath": "impl-plans/active/<topic>.md",
    "remainingDependencies": [],
    "sourceReferences": [],
    "codexAgentReferences": []
  }
}
```

The child workflow must not broaden the scope beyond the selected backlog item.
If it finds a missing design or plan dependency, it should return a blocking
finding instead of implementing adjacent backlog items.

## Global Workflow Plan Path Expectations

Step 3 must create or update exactly one active implementation plan per selected
backlog item, using the path below unless a review-approved rename is recorded.

| Backlog ID | Active implementation plan | Design doc |
|---|---|---|
| `P2-SESSION-SEARCH` | `impl-plans/active/session-search.md` | `design-docs/specs/design-session-search.md` |
| `P2-TRANSCRIPT-SEARCH` | `impl-plans/active/transcript-search.md` | `design-docs/specs/design-transcript-search.md` |
| `P2-BOOKMARKS` | `impl-plans/active/bookmarks.md` | `design-docs/specs/design-bookmarks.md` |
| `P2-ACTIVITY` | `impl-plans/active/activity.md` | `design-docs/specs/design-activity.md` |
| `P2-MARKDOWN-TASKS` | `impl-plans/active/markdown-tasks.md` | `design-docs/specs/design-markdown-tasks.md` |
| `P3-GROUP-LIFECYCLE` | `impl-plans/completed/group-lifecycle.md` | `design-docs/specs/design-group-lifecycle.md` |
| `P3-QUEUE-LIFECYCLE` | `impl-plans/active/queue-lifecycle.md` | `design-docs/specs/design-queue-lifecycle.md` |
| `P3-FILE-INTELLIGENCE` | `impl-plans/completed/file-intelligence.md` | `design-docs/specs/design-file-intelligence.md` |
| `P3-REPO-ANALYTICS` | `impl-plans/active/repository-analytics.md` | `design-docs/specs/design-repository-analytics.md` |
| `P4-HTTP-SERVER` | `impl-plans/completed/http-server-core.md` | `design-docs/specs/design-http-server-core.md` |
| `P4-SSE` | `impl-plans/active/server-event-streaming.md` | `design-docs/specs/design-server-event-streaming.md` |
| `P4-AUTH` | `impl-plans/completed/token-auth.md` | `design-docs/specs/design-token-auth.md` |
| `P4-DAEMON` | `impl-plans/completed/daemon-lifecycle.md` | `design-docs/specs/design-daemon-lifecycle.md` |
| `P4-PUBLIC-SDK` | `impl-plans/active/public-sdk.md` | `design-docs/specs/design-public-sdk.md` |
| `P5-COMPAT-BRIDGE` | `impl-plans/active/compat-bridge.md` | `design-docs/specs/design-compat-bridge.md` |
| `P5-TOOL-REGISTRY` | `impl-plans/active/tool-registry-model-helpers.md` | `design-docs/specs/design-tool-registry-model-helpers.md` |

## Operational Notes

- The backlog workflow is an orchestrator, not an implementation surface.
- It should be safe to re-run because it recomputes backlog state from repository
  files and the accepted delegated outputs in the current session.
- The one-item backlog workflow is optimized for incremental progress when
  designs and plans can be produced slice-by-slice.
- The global workflow is optimized for throughput when all selected designs and
  plans should be reviewed up front before implementation starts.

## References

- `design-docs/specs/design-codex-agent-parity-gap.md`
- `.divedra/workflows/design-and-implement-review-loop`
- `.divedra/workflows/recent-change-quality-loop`
