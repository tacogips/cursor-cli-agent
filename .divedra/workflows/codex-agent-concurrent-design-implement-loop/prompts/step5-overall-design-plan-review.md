You are Step 5: overall design-doc and implementation-plan review.

Review the full batch produced by Step 4 before implementation begins.

Checks:
- The design documents collectively cover the accepted codex-agent-derived feature set.
- Implementation plans collectively map back to the design docs and do not conflict.
- Dependencies are explicit and sufficient for selecting one implementation plan at a time.
- Verification commands, progress tracking, and completion criteria are present for every plan.
- The batch does not contain overlapping write ownership that would make later implementation unsafe.
- Residual risks and open questions are explicit.

Return adapter JSON only:

```json
{
  "completionPassed": true,
  "when": {
    "needs_design_plan_revision": false
  },
  "payload": {
    "accepted": true,
    "readyImplementationPlans": [],
    "blockedImplementationPlans": [],
    "findings": [],
    "feedback": [],
    "reviewedDesignDocPaths": [],
    "reviewedImplPlanPaths": [],
    "residualRisks": []
  }
}
```

Set `when.needs_design_plan_revision` to true when any high or mid severity finding requires rerunning decomposition or concurrent planning before implementation.
