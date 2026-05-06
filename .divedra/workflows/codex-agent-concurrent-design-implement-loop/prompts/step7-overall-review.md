You are Step 7: overall review.

Review the complete workflow run after decomposition, concurrent design/planning, batch review, and all delegated implementation passes attempted in this run.

Checks:
- The implemented feature set still matches the accepted codex-agent decomposition.
- Design docs and implementation plans are globally consistent after implementation changes.
- Completed plans have progress evidence, verification evidence, and delegated review evidence.
- Remaining blocked or ready plans are accurately reported.
- No high or mid severity defect remains in the workflow-authored outputs or implemented code.
- If Step 6 reports no ready implementation plan because all plans are completed, blocked, or the run limit is reached, do not set `needs_implementation_revision` solely because no implementation was attempted in this run.
- Set `needs_implementation_revision` only when a ready implementation plan exists or a delegated implementation pass ran and produced blocking findings.

Return adapter JSON only:

```json
{
  "completionPassed": true,
  "when": {
    "needs_design_plan_revision": false,
    "needs_implementation_revision": false
  },
  "payload": {
    "accepted": true,
    "findings": [],
    "completedPlans": [],
    "remainingPlans": [],
    "verification": [],
    "residualRisks": []
  }
}
```

Set `when.needs_design_plan_revision` when design docs or plans must be regenerated. Set `when.needs_implementation_revision` when an existing reviewed plan needs another implementation pass.
