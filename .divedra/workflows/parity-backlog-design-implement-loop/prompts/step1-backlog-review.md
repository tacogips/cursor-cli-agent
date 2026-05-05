You are Step 1: parity backlog review.

Review the repository state and compute the next ready parity backlog item.

Primary sources:
- `runtimeVariables.workflowInput.backlogSourceDoc`
- `design-docs/specs/design-parity-backlog-workflow.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `impl-plans/active/*.md`
- `impl-plans/completed/*.md`
- `impl-plans/PROGRESS.json`

Runtime options:
- `runtimeVariables.workflowInput.targetPhases`
- `runtimeVariables.workflowInput.maxItemsPerRun`
- `runtimeVariables.workflowInput.includePartialCapabilities`

Rules:
- Default `backlogSourceDoc` to
  `design-docs/specs/design-parity-backlog-workflow.md` when no override is
  supplied.
- Default `targetPhases` to phases `2`, `3`, `4`, and `5`.
- Default `maxItemsPerRun` to `999`.
- Default `includePartialCapabilities` to `true`.
- Work from the canonical backlog ids and ordering in
  `design-docs/specs/design-parity-backlog-workflow.md`. Do not invent new
  backlog items.
- Prefer a narrow repository scan:
  1. read `design-docs/specs/design-parity-backlog-workflow.md`
  2. read `design-docs/specs/design-codex-agent-parity-gap.md`
  3. read `impl-plans/active/*.md`
  4. read `impl-plans/PROGRESS.json`
  5. inspect `impl-plans/completed/*.md` only if completion state is still
     ambiguous after the previous files
- Read any prior Step 4 outputs from the current workflow run and treat those
  item ids as completed for this run even if the repository scan has not yet
  been reinterpreted perfectly.
- Treat an item as `completed` when repository evidence or a prior Step 4 output
  shows that the item landed.
- Treat an item as `blocked` when any dependency is incomplete.
- Do not block an item merely because an active implementation plan already
  owns the same scope. For this workflow, an aligned active plan is input for
  the delegated implementation workflow. Include the plan path in
  `nextItem.sourceReferences` and keep the item `ready` unless repository
  evidence shows the capability already landed.
- Treat an item as `ready` only when it is in scope, not completed, not blocked,
  and earliest by phase order then canonical table order.
- If the only active plans are the phase-1 foundation plan and this backlog
  workflow plan, then the default first ready item is `P2-SESSION-SEARCH`.
- When `includePartialCapabilities` is false, exclude explicitly partial
  capability slices from the ready set and report them as filtered.
- Count the number of accepted Step 4 delegated completions in this run and set
  `runLimitReached` to true only when that count is greater than or equal to
  `maxItemsPerRun`.
- Prefer a fast, decisive result over exhaustive repository archaeology. This
  step is a selector, not a full audit.

Return JSON with:
- `backlogSourceDoc`
- `targetPhases`
- `maxItemsPerRun`
- `includePartialCapabilities`
- `backlogItems`
- `completedItems`
- `blockedItems`
- `readyItems`
- `nextItem`
- `processedItemsThisRun`
- `runLimitReached`
- `selectionNotes`

Backlog item shape:

```json
{
  "id": "P2-SESSION-SEARCH",
  "phase": "2",
  "title": "Session metadata search",
  "targetFeatureArea": "session metadata search",
  "requestedBehavior": "Implement metadata search across indexed Cursor sessions.",
  "dependencyIds": [],
  "sourceReferences": [
    "design-docs/specs/design-parity-backlog-workflow.md",
    "design-docs/specs/design-codex-agent-parity-gap.md"
  ],
  "status": "ready",
  "blockingReason": null
}
```
