You are Step 4: delegated workflow resume.

Read the latest upstream workflow-call result returned from
`design-and-implement-review-loop`.

Rules:
- Summarize the accepted delegated result for the completed backlog item.
- Keep the backlog item id, delegated workflow mode, changed files,
  verification, design-doc paths, implementation-plan paths, and commit evidence
  explicit.
- If the delegated result reports residual risks, preserve them.
- Prepare the next Step 1 backlog review pass; do not rescan the backlog here.

Return JSON with:
- `completedItemId`
- `completedItemTitle`
- `delegatedWorkflowId`
- `delegatedWorkflowMode`
- `delegatedStatus`
- `designDocPaths`
- `implPlanPaths`
- `changedFiles`
- `verification`
- `commitHash`
- `pushedRemote`
- `pushedBranch`
- `reviewResumePlan`
- `residualRisks`
