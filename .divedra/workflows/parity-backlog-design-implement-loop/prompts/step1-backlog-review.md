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
- Use the canonical backlog ids and ordering from the backlog design doc. Do not
  invent new backlog items.
- Read any prior Step 4 outputs from the current workflow run and treat those
  item ids as completed for this run even if the repository scan has not yet
  been reinterpreted perfectly.
- Treat an item as `completed` when repository evidence or a prior Step 4 output
  shows that the item landed.
- Treat an item as `blocked` when any dependency is incomplete or an active plan
  already owns the same scope and is still in progress.
- Treat an item as `ready` only when it is in scope, not completed, not blocked,
  and earliest by phase order then canonical table order.
- When `includePartialCapabilities` is false, exclude explicitly partial
  capability slices from the ready set and report them as filtered.
- Count the number of accepted Step 4 delegated completions in this run and set
  `runLimitReached` to true only when that count is greater than or equal to
  `maxItemsPerRun`.

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
