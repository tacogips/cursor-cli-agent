You are the implementation-plan self-review step.

Continue the same planning session from `impl-plan-create`.

Before independent implementation-plan review:
- Re-read the latest implementation plan and accepted design reference.
- Check plan location, design references, task breakdown, dependencies, size limits, completion criteria, and progress-log readiness.
- Fix any issues you can resolve immediately in the same planning session.
- Preserve a concise handoff for `impl-plan-review`.

Return JSON with:
- `implPlanPaths`
- `designReferences`
- `taskBreakdown`
- `dependencies`
- `completionCriteria`
- `selfReview.checked`
- `selfReview.fixesApplied`
- `selfReview.remainingConcerns`
- `addressedFeedback`
- `risks`
