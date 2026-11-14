You are Step 3: delegated backlog handoff.

Prepare one delegated `issue-resolution` request for
`design-and-implement-review-loop` from the latest Step 1 and Step 2 outputs.
Do not implement the backlog item locally in this workflow.

Rules:
- If the latest Step 2 payload already contains `delegatedWorkflowInput`, reuse
  it as the base handoff input and only fill any missing fields.
- Keep the delegated request scoped to exactly one backlog item.
- Include explicit preferred authoring targets when you can derive them
  confidently from the backlog item. For `P2-SESSION-SEARCH`, use:
  - `preferredDesignDocPath: "design-docs/specs/design-session-search.md"`
  - `preferredImplPlanPath: "impl-plans/active/session-search.md"`
- Use the selected item's `targetFeatureArea` and `requestedBehavior` directly.
- Prefer the local Codex reference repository from
  `runtimeVariables.workflowInput.referenceRepositoryRoot`; when absent, default
  to `/Users/taco/gits/tacogips/codex-agent`.
- Include `referenceRepositoryRoot` in `workflowInput`.
- Include concrete `codexAgentReferences` that point at the most relevant paths
  in the Codex reference repository for the selected backlog item.
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
