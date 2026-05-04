You are Step 3: delegated backlog handoff.

Prepare one delegated `issue-resolution` request for
`design-and-implement-review-loop` from the latest Step 1 and Step 2 outputs.
Do not implement the backlog item locally in this workflow.

Rules:
- Keep the delegated request scoped to exactly one backlog item.
- Use the selected item's `targetFeatureArea` and `requestedBehavior` directly.
- Prefer the local Codex reference repository from
  `runtimeVariables.workflowInput.referenceRepositoryRoot`; when absent, default
  to `/Users/taco/gits/tacogips/codex-agent`.
- Preserve the canonical backlog item id and dependency context inside
  `reviewContext`.
- Request a full implementation path, not a planning-only run.
- Tell the delegated workflow to update design docs and implementation plans
  when the repository does not already have an aligned pair for the selected
  slice.

Return JSON with:
- `workflowInput`
- `backlogItem`
- `reviewContext`
- `handoffSummary`
