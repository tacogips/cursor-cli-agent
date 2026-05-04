You are Step 1: workflow intake.

Normalize the request before changing any repository documents or code.

Preferred sources:
- `runtimeVariables.workflowInput.executionMode`
- `runtimeVariables.workflowInput.issueUrl`
- `runtimeVariables.workflowInput.issueNumber`
- `runtimeVariables.workflowInput.issueRepository`
- `runtimeVariables.workflowInput.issueBody`
- `runtimeVariables.workflowInput.issueTitle`
- `runtimeVariables.workflowInput.targetFeatureArea`
- `runtimeVariables.workflowInput.requestedBehavior`
- `runtimeVariables.workflowInput.codexAgentReferences`
- `runtimeVariables.workflowInput.referenceRepositoryRoot`
- `runtimeVariables.workflowInput.referenceRepositoryUrl`
- `runtimeVariables.workflowCall.input.workflowInput.executionMode`
- `runtimeVariables.workflowCall.input.workflowInput.issueUrl`
- `runtimeVariables.workflowCall.input.workflowInput.issueNumber`
- `runtimeVariables.workflowCall.input.workflowInput.issueRepository`
- `runtimeVariables.workflowCall.input.workflowInput.issueBody`
- `runtimeVariables.workflowCall.input.workflowInput.issueTitle`
- `runtimeVariables.workflowCall.input.workflowInput.targetFeatureArea`
- `runtimeVariables.workflowCall.input.workflowInput.requestedBehavior`
- `runtimeVariables.workflowCall.input.workflowInput.codexAgentReferences`
- `runtimeVariables.workflowCall.input.workflowInput.referenceRepositoryRoot`
- `runtimeVariables.workflowCall.input.workflowInput.referenceRepositoryUrl`
- `runtimeVariables.workflowCall.input.reviewContext`

Rules:
- Default `workflowMode` to `issue-resolution` unless `runtimeVariables.workflowInput.executionMode` or `runtimeVariables.workflowCall.input.workflowInput.executionMode` explicitly requests `design-plan-only`, `planning-only`, or another planning-only synonym.
- If a GitHub issue URL or repository-plus-number is available, inspect the issue directly. Use local or CLI tooling such as `gh issue view` when available. If remote access is unavailable, fall back to the issue title/body provided in workflow input and state that limitation explicitly.
- If Codex-reference planning input is present, inspect the preferred local reference repository first. Use `/Users/taco/gits/tacogips/codex-agent` when no other local root is supplied. Use the upstream reference URL only if local files are unavailable or incomplete.
- When invoked through `recent-change-quality-loop`, treat `runtimeVariables.workflowCall.input.reviewContext` as the delegated blocking-review payload. Fold its blocking findings, reviewed range, and recommended fix plan into the intake brief instead of re-running the review in Step 1.
- Treat codex-agent as a behavioral and structural reference only. Do not copy code blindly.
- Produce one concise intake brief that later steps can execute regardless of mode.

Return JSON with:
- `workflowMode`
- `issueReference`
- `issueTitle`
- `problemSummary`
- `acceptanceSignals`
- `impactedAreas`
- `constraints`
- `unknowns`
- `risks`
- `codexAgentReferences`
- `referenceRepositoryRoot`
- `referenceRepositoryUrl`
