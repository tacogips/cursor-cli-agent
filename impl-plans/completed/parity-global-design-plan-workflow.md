# Parity Global Design-Plan Workflow Implementation Plan

**Status**: Completed
**Created**: 2026-05-05
**Last Updated**: 2026-05-09
**Design Reference**: `design-docs/specs/design-parity-backlog-workflow.md#global-design-plan-implement-workflow`

## Goal

Add a project-local `divedra` workflow that first settles the full cursor-agent
parity design, reviews it, creates the full implementation-plan batch, reviews
that batch, and then delegates ready plans one at a time into
`design-and-implement-review-loop`.

## Scope

Included:

- workflow bundle under
  `.divedra/workflows/parity-global-design-plan-implement-loop`
- review gates after global design, batch planning, and each delegated
  implementation result
- deterministic ready-plan selection and child workflow handoff
- repository task and README entry points

Excluded:

- implementing individual parity capabilities in `src/`
- replacing `design-and-implement-review-loop` as the single-plan executor
- mutating completed-plan archives automatically

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow bundle | `.divedra/workflows/parity-global-design-plan-implement-loop/` | DONE | `task divedra-global-parity-validate` |
| Task entry points | `Taskfile.yml` | DONE | `task divedra-workflows` |
| Repository docs | `README.md`, `.divedra/README.md`, `design-docs/specs/design-parity-backlog-workflow.md` | DONE | manual review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Global workflow validation | local `./divedra` command-node envelope fix | SATISFIED |
| Delegated implementation | `design-and-implement-review-loop` | SATISFIED |

## Completion Criteria

- [x] workflow bundle validates with local `divedra`
- [x] workflow appears in `task divedra-workflows`
- [x] task entry points exist for validate and run
- [x] docs explain when to use this workflow instead of the one-item backlog loop
- [x] active parity implementation run status is reported before handoff

## Progress Log

### Session: 2026-05-05

**Tasks completed**: Created the initial
`parity-global-design-plan-implement-loop` bundle with global design review,
batch plan review, ready-plan selection, delegated implementation handoff, and
parent-level result review.

**Verification**: `task divedra-global-parity-validate` passed.
`task divedra-workflows` listed
`parity-global-design-plan-implement-loop` as a project workflow with
`never-run` status. Direct mailbox smoke tests of
`scripts/select-ready-plan.sh` and `scripts/build-handoff.sh` returned valid
command-node envelopes, including revision feedback preservation for reruns.

**Active run note**: The existing
`parity-backlog-design-implement-loop` session
`div-parity-backlog-design-implement-loop-1777946520-46bf288e` and child
`design-and-implement-review-loop` session
`div-design-and-implement-review-loop-1777946535-ebd48c8f` were still running
while this workflow was authored, so the new workflow was validated but not run.

### Session: 2026-05-09

**Tasks completed**: Confirmed plan completion criteria remain satisfied; no workflow bundle changes in this pass.

**Notes**: Batch implementation work proceeded on dependent feature plans (HTTP resources, docs) without altering the global workflow definition.
