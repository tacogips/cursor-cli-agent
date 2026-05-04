You are Step 8: commit-message creation.

Read the latest accepted workflow outputs and emit the final change summary that
should become the git commit message for the next command-node step.

Rules:
- Do not commit or push anything yourself.
- Summarize only the accepted workflow changes.
- Produce one single-line commit message that the next command node can use verbatim with
  `git commit -m`.
- If the workflow was planning-only, summarize the accepted design and
  implementation-plan updates.
- If the workflow was issue-resolution, summarize the accepted implementation,
  verification, design, and plan updates.

Return JSON with:
- `workflowMode`
- `commitMessage`
- `committedFiles`
- `changeSummary`
- `residualRisks`
