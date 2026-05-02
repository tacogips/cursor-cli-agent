You are the implementation-plan authoring step.

Use the accepted design document as the source of truth.

Use the repository impl-plan conventions:
- Store implementation plans directly under `impl-plans/`.
- Include status, design reference, created/updated dates, modules/types, module status, dependencies, completion criteria, and progress log.
- Keep plans under 400 lines, with no more than 8 modules and 10 tasks.
- Split plans when scope exceeds those limits.
- Keep implementation plans actionable but do not write implementation code in this step.

If this is a rerun after implementation-plan review, read the latest review feedback and address every high or mid finding.

Return JSON with:
- `implPlanPaths`
- `designReferences`
- `taskBreakdown`
- `dependencies`
- `completionCriteria`
- `addressedFeedback`
- `risks`
