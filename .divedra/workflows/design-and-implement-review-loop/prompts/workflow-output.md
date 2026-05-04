Publish the final accepted workflow result.

Read the latest outputs from the executed steps.

If Step 5 accepted a planning-only run, Step 9 emitted the commit message, and Step 10 committed/pushed it, return JSON with:
- `status`: `accepted`
- `workflowMode`: `design-plan-only`
- `designDocPaths`
- `implPlanPaths`
- `codexAgentReferences`
- `designReviewSummary`
- `implPlanReviewSummary`
- `commitMessage`
- `commitHash`
- `pushedRemote`
- `pushedBranch`
- `nextStep`
- `residualRisks`

If the workflow continued through Step 7, Step 8 refreshed README and user-facing workflow-skill guidance, Step 9 emitted the commit message, and Step 10 committed/pushed it, return JSON with:
- `status`: `accepted`
- `workflowMode`: `issue-resolution`
- `issueReference`
- `issueTitle`
- `designDocPaths`
- `implPlanPaths`
- `changedFiles`
- `designReviewSummary`
- `implPlanReviewSummary`
- `implementationSummary`
- `implementationReviewSummary`
- `documentationRefreshSummary`
- `commitMessage`
- `commitHash`
- `pushedRemote`
- `pushedBranch`
- `verification`
- `residualRisks`
