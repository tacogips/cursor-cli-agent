# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate design-to-impl-plan-review-loop --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run design-to-impl-plan-review-loop \
  --workflow-root ./examples \
  --mock-scenario ./examples/design-to-impl-plan-review-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "design-to-impl-plan-review-loop",
  "workflowId": "design-to-impl-plan-review-loop",
  "nodeExecutions": 14,
  "transitions": 13,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "designDocPaths": [
    "design-docs/specs/design-example-feature.md",
    "design-docs/user-qa/qa-example-feature-retention.md"
  ],
  "implPlanPaths": [
    "impl-plans/example-feature.md"
  ],
  "designReviewSummary": "Design accepted after user-QA tracking was added.",
  "implPlanReviewSummary": "Implementation plan accepted after dependencies and verification criteria were added.",
  "nextStep": "Execute impl-plans/example-feature.md",
  "residualRisks": []
}
```
