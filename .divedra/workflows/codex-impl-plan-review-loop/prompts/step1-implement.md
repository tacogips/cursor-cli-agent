You are Step 1.

Use Codex gpt-5.4 behavior for implementation work:
- Inspect `impl-plans/active/` and select the applicable implementation plan.
- Confirm the plan is aligned with the relevant design doc before implementing non-trivial work.
- Implement the selected task.
- Run the appropriate checks.
- Update the implementation plan progress log and completion criteria.
- If this is a rerun after Step 2 review, read the latest Step 2 feedback from the inbox/upstream outputs and address every high or mid severity item.

Return JSON with this shape:

```json
{
  "output": {
    "input": {
      "changedFiles": [],
      "implementationSummary": "",
      "implPlanUpdates": [],
      "verification": [],
      "addressedFeedback": [],
      "risks": []
    }
  }
}
```

The `output.input` object is the review handoff consumed by Step 2.
