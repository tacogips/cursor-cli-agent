# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
nix run ./divedra -- workflow validate recent-change-quality-loop
```

Expected result: the workflow is valid.

## Run

Command:

```bash
nix run ./divedra -- workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "recent-change-quality-loop",
  "workflowId": "recent-change-quality-loop",
  "nodeExecutions": 7,
  "transitions": 6,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "hours": 24,
  "reviewedRange": "HEAD~2..HEAD plus working tree",
  "finalFindings": [],
  "fixIterations": 1,
  "changedFiles": [
    "README.md",
    "Taskfile.yml",
    ".divedra/workflows/recent-change-quality-loop/workflow.json"
  ],
  "verification": [
    "task typecheck",
    "task test"
  ],
  "residualLowRisks": [
    "A follow-up documentation polish pass could tighten examples further."
  ],
  "operatorNotes": [
    "The blocking review finding was resolved in one fix loop."
  ]
}
```
