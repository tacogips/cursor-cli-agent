# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
nix run ./divedra -- workflow validate parity-backlog-design-implement-loop
```

Expected result: the workflow is valid.

## Run

Command:

```bash
nix run ./divedra -- workflow run parity-backlog-design-implement-loop \
  --mock-scenario .divedra/workflows/parity-backlog-design-implement-loop/mock-scenario.json \
  --variables '{"targetPhases":["2"],"maxItemsPerRun":1}' \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "parity-backlog-design-implement-loop",
  "workflowId": "parity-backlog-design-implement-loop",
  "nodeExecutions": 26,
  "transitions": 24,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "backlogSourceDoc": "design-docs/specs/design-parity-backlog-workflow.md",
  "processedItemsThisRun": 1,
  "completedItemsThisRun": [
    {
      "id": "P2-SESSION-SEARCH",
      "title": "Session metadata search"
    }
  ],
  "remainingReadyItems": [],
  "blockedItems": [],
  "exitReason": "Configured maxItemsPerRun reached.",
  "delegatedWorkflowRuns": [
    {
      "workflowId": "design-and-implement-review-loop",
      "itemId": "P2-SESSION-SEARCH",
      "commitHash": "1234567890abcdef1234567890abcdef12345678"
    }
  ],
  "changedFiles": [
    "src/cli/cli.ts",
    "src/persistence/session-index-repository.ts",
    "src/cli/cli.test.ts",
    "impl-plans/active/session-search.md"
  ],
  "verification": [
    "task test",
    "task typecheck"
  ],
  "residualRisks": [],
  "operatorNotes": [
    "Re-run the workflow to continue with the next ready phase-2 backlog item."
  ]
}
```
