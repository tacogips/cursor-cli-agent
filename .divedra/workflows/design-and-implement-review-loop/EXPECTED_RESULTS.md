# Expected Results

Stable assertions for deterministic verification with the bundled mock scenarios.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
nix run ./divedra -- workflow validate design-and-implement-review-loop
```

Expected result: the workflow is valid.

## Run

Issue-resolution command:

```bash
nix run ./divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "design-and-implement-review-loop",
  "workflowId": "design-and-implement-review-loop",
  "nodeExecutions": 15,
  "transitions": 14,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "workflowMode": "issue-resolution",
  "issueReference": "tacogips/cursor-agent#123",
  "issueTitle": "Persist workflow review findings across reruns",
  "designDocPaths": [
    "design-docs/specs/design-workflow-review-findings.md",
    "design-docs/user-qa/qa-review-finding-retention.md"
  ],
  "implPlanPaths": [
    "impl-plans/active/workflow-review-findings.md"
  ],
  "changedFiles": [
    "src/workflow/review-findings.ts",
    "src/workflow/review-findings.test.ts",
    "impl-plans/active/workflow-review-findings.md"
  ],
  "designReviewSummary": "Design accepted after the unresolved retention decision was moved into user QA.",
  "implPlanReviewSummary": "Implementation plan accepted after explicit persistence migration and regression verification tasks were added.",
  "implementationSummary": "Step 6 implemented the approved plan, addressed Step 7 feedback, and updated implementation-plan progress.",
  "implementationReviewSummary": "Implementation accepted with no remaining high or mid findings.",
  "verification": [
    "task test",
    "task typecheck"
  ],
  "residualRisks": []
}
```

Planning-only command:

```bash
nix run ./divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario-planning-only.json \
  --output json
```

Expected planning-only run summary:

```json
{
  "status": "completed",
  "workflowName": "design-and-implement-review-loop",
  "workflowId": "design-and-implement-review-loop",
  "nodeExecutions": 11,
  "transitions": 10,
  "exitCode": 0
}
```

Expected planning-only final output payload:

```json
{
  "status": "accepted",
  "workflowMode": "design-plan-only",
  "designDocPaths": [
    "design-docs/specs/design-codex-reference-session-history.md"
  ],
  "implPlanPaths": [
    "impl-plans/active/codex-reference-session-history.md"
  ],
  "codexAgentReferences": [
    "/Users/taco/gits/tacogips/codex-agent/src/session",
    "/Users/taco/gits/tacogips/codex-agent/src/cli"
  ],
  "designReviewSummary": "Design accepted after Cursor adapter boundaries and codex-agent divergence were clarified.",
  "implPlanReviewSummary": "Implementation plan and design consistency review accepted after transcript edge-case tasks were added.",
  "nextStep": "Run a full issue-resolution execution for impl-plans/active/codex-reference-session-history.md when implementation is approved.",
  "residualRisks": []
}
```
