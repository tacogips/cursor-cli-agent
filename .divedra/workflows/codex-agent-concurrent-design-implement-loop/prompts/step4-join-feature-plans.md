You are Step 4: concurrent feature design-plan join.

Read `runtimeVariables.fanoutJoin` and the latest inbox aggregate from the `codex-agent-feature-design-plan-loop` fanout group.

Build the complete design and implementation-plan batch summary.

Rules:
- Preserve branch order from the fanout input.
- Extract each accepted feature id, design document path, implementation-plan path, dependencies, codex-agent references, verification, and residual risks.
- Build `readyImplementationPlans` from plans whose dependencies are already completed or absent.
- Build `blockedImplementationPlans` from plans with unmet dependencies.
- Do not implement code here.

Return JSON with:
- `workflowMode`: `codex-agent-concurrent-design-implement`
- `fanoutGroupRunId`
- `plannedItems`
- `designDocPaths`
- `implPlanPaths`
- `dependencyGraph`
- `readyImplementationPlans`
- `blockedImplementationPlans`
- `branchReviewSummaries`
- `verification`
- `risks`
