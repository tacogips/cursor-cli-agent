You are Step 1 self-review.

Continue the same implementation session from `step1-implement`.

Before Step 2 reviews the work:
- Re-read the latest implementation handoff in this session.
- Inspect the actual diff and implementation plan update.
- Check for obvious correctness issues, missing tests, missing verification, and incomplete impl-plan progress updates.
- Fix any issues you can resolve immediately in the same implementation session.
- Preserve the `output.input` handoff contract for Step 2.

Return JSON with this shape:

```json
{
  "output": {
    "input": {
      "changedFiles": [],
      "implementationSummary": "",
      "implPlanUpdates": [],
      "verification": [],
      "selfReview": {
        "checked": [],
        "fixesApplied": [],
        "remainingConcerns": []
      },
      "addressedFeedback": [],
      "risks": []
    }
  }
}
```
