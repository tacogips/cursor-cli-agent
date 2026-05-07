# Project Divedra Workflows

This repository ships project-local `divedra` workflows under `.divedra/workflows`.

These workflows are discovered automatically when commands are run from the
repository root because `divedra` treats `<project>/.divedra/workflows` as the
project catalog.

## Available Workflows

- `design-and-implement-review-loop`: issue intake, design-doc update, design self-review, design review, implementation-plan creation, implementation-plan self-review, implementation-plan review, optional implementation, implementation self-review, README and user-facing workflow-skill refresh on the implementation path, and final commit/push.
- `codex-agent-concurrent-design-implement-loop`: decompose codex-agent functionality, review the decomposition, create feature-local design docs and implementation plans through a concurrency-10 fanout into `codex-agent-feature-design-plan-loop`, review the whole design/plan batch, implement ready plans one by one through `design-and-implement-review-loop`, and finish with an overall review.
- `codex-agent-feature-design-plan-loop`: callable feature-local branch workflow used by `codex-agent-concurrent-design-implement-loop` to create and review one design-doc and implementation-plan pair.
- `parity-backlog-design-implement-loop`: derive the remaining Cursor-agent parity backlog from repository design and plan state, pick one ready slice at a time, delegate each slice into `design-and-implement-review-loop`, and continue until no ready item remains or the run limit is reached.
- `parity-global-design-plan-implement-loop`: update the full selected parity design first, review that design, create all selected implementation plans, review the plan batch, then delegate ready plans one by one into `design-and-implement-review-loop` with parent review after each delegated result.
- `recent-change-quality-loop`: review recent committed and uncommitted changes, hand blocking findings into `design-and-implement-review-loop`, then re-review until only low-severity risks remain.

## Root Commands

List available workflows from this repository:

```bash
task divedra-workflows
```

Validate the bundled design-and-implement workflow:

```bash
task divedra-design-loop-validate
```

Validate the bundled recent-change workflow:

```bash
task divedra-recent-change-validate
```

Validate the bundled parity-backlog workflow:

```bash
task divedra-parity-backlog-validate
```

Validate the bundled global parity design-plan workflow:

```bash
task divedra-global-parity-validate
```

Validate the bundled codex-agent concurrent design/implementation workflow:

```bash
task divedra-codex-concurrent-validate
```

Run any `divedra` command through the local submodule:

```bash
task divedra -- workflow list
task divedra -- workflow inspect design-and-implement-review-loop --output json
task divedra -- workflow usage --output json
```

Run the bundled planning and implementation workflow with its deterministic mock
scenario:

```bash
task divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Run the bundled recent-change workflow with its deterministic mock scenario:

```bash
task divedra -- workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

Run the bundled parity-backlog workflow with its deterministic mock scenario:

```bash
task divedra -- workflow run parity-backlog-design-implement-loop \
  --mock-scenario .divedra/workflows/parity-backlog-design-implement-loop/mock-scenario.json \
  --variables '{"targetPhases":["2"],"maxItemsPerRun":1}' \
  --output json
```

Run the bundled global parity design-plan workflow for phase 2 with at most one
delegated implementation:

```bash
task divedra-global-parity -- \
  --variables '{"targetPhases":["2"],"maxItemsPerRun":1}' \
  --output json
```

Run the bundled codex-agent concurrent design/implementation workflow with at
most one delegated implementation:

```bash
task divedra-codex-concurrent -- \
  --variables '{"referenceRepositoryRoot":"/Users/taco/gits/tacogips/codex-agent","maxItemsPerRun":1}' \
  --output json
```

For direct `nix` usage without `task`, the equivalent entry point is:

```bash
nix run ./divedra -- workflow list
```

## Implementation Refresh Contract

On the full implementation path, `design-and-implement-review-loop` Step 6
updates runtime behavior and tests, Step 7 performs the independent
implementation review, and Step 8 refreshes README and user-facing workflow
skill guidance before commit preparation.

For `P3-GROUP-LIFECYCLE`, that refresh covers Cursor-local `group pause`,
`group resume`, `group delete`, `group watch`, paused-run guards, and
activity-derived watch snapshots. For `P3-QUEUE-LIFECYCLE`, it covers
Cursor-local `queue pause`, `queue resume`, `queue delete`, `queue update`,
`queue move`, `queue mode`, `queue stop`, paused/stopped run guards,
cooperative stop between queue items, retained completed/failed items,
manual-mode skips, and queue progress summaries derived from repository-owned
queue state plus optional activity signals.
