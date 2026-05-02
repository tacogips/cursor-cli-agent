# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate codex-impl-plan-review-loop --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run codex-impl-plan-review-loop \
  --workflow-root ./examples \
  --mock-scenario ./examples/codex-impl-plan-review-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "codex-impl-plan-review-loop",
  "workflowId": "codex-impl-plan-review-loop",
  "nodeExecutions": 8,
  "transitions": 7,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "changedFiles": [
    "src/example.ts",
    "src/example.test.ts",
    "impl-plans/active/example.md"
  ],
  "implementationSummary": "Step 1 implemented the task, incorporated Step 2 feedback, and updated the implementation plan.",
  "implPlanUpdates": [
    "TASK-001 implementation and tests marked complete"
  ],
  "verification": [
    "task test",
    "task typecheck"
  ],
  "reviewSummary": "Step 2 accepted the revised implementation with no high or mid findings.",
  "residualRisks": []
}
```
