# Project Divedra Workflows

This repository ships project-local `divedra` workflows under `.divedra/workflows`.

These workflows are discovered automatically when commands are run from the
repository root because `divedra` treats `<project>/.divedra/workflows` as the
project catalog.

## Available Workflows

- `design-and-implement-review-loop`: issue intake, design-doc update, design review, implementation-plan creation, implementation-plan review, optional implementation, README and user-facing workflow-skill refresh on the implementation path, and final commit/push.
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

For direct `nix` usage without `task`, the equivalent entry point is:

```bash
nix run ./divedra -- workflow list
```
