# Parity Backlog Workflow Implementation Plan

**Status**: Completed
**Created**: 2026-05-04
**Design References**:

- `design-docs/specs/design-parity-backlog-workflow.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`

## Goal

Add a project-local `divedra` workflow that continuously selects the next ready
parity slice for `curort-cli-agent` and delegates that slice into
`design-and-implement-review-loop` until the ready backlog is exhausted.

## Scope

### Included

- canonical backlog design for remaining phase-2 through phase-5 capabilities
- workflow bundle under `.divedra/workflows/parity-backlog-design-implement-loop`
- delegated handoff into `design-and-implement-review-loop`
- repository docs and task entry points for discovery and validation
- deterministic mock scenario and expected-results documentation

### Excluded

- implementing any individual parity capability in `src/`
- replacing `design-and-implement-review-loop` as the single-slice executor
- automatic backlog mutation outside the repository design and plan files

## Work Breakdown

### TASK-001: Backlog Design And Inventory

Deliverables:

- design doc for the backlog orchestrator
- canonical backlog item list with stable IDs and dependency ordering
- notes cross-reference in the design index

Completion criteria:

- backlog item IDs are explicit and stable
- phase ordering and dependency rules are documented
- delegated workflow input contract is documented

### TASK-002: Workflow Bundle

Deliverables:

- `.divedra/workflows/parity-backlog-design-implement-loop/workflow.json`
- node definitions
- prompts for backlog review, selection, handoff, resume, and output

Completion criteria:

- workflow loops through delegated item execution
- workflow exits cleanly when no ready item remains
- workflow reports blocked items and delegated completion evidence

### TASK-003: Operator Entry Points

Deliverables:

- `Taskfile.yml` commands for validation and direct execution
- `README.md` and `.divedra/README.md` workflow inventory updates

Completion criteria:

- workflow is discoverable from repository-facing docs
- task entry points match the workflow id

### TASK-004: Deterministic Validation Fixtures

Deliverables:

- bundled mock scenario
- expected-results document

Completion criteria:

- workflow bundle validates with local `divedra`
- mock scenario documents a delegated single-item completion cycle

## Verification

- `task divedra-parity-backlog-validate`
- `task divedra-workflows`

## Risks

1. backlog-state detection is heuristic because existing plan naming may drift
2. some parity slices may still need to split further once real implementation
   begins
3. phase-4 and phase-5 slices are large enough that delegated runs may create
   additional child plans rather than finish in one pass

## Progress Log

### Session: 2026-05-04

**Tasks completed**: Added `design-parity-backlog-workflow.md`, defined the
canonical phase-2 through phase-5 backlog list, created the
`parity-backlog-design-implement-loop` workflow bundle, added docs and task
entry points, and added deterministic mock/expected-results files.

**Verification**: `task divedra-parity-backlog-validate` passed and
`task divedra-workflows` lists `parity-backlog-design-implement-loop` from the
project catalog.

**Status note**: This slice is complete and archived under `completed/` with the
rest of the finished implementation plans.
