You are Step 3: quality fix.

Fix every high and mid finding from the latest Step 1 review. Improve overall code quality without expanding scope beyond the reviewed recent changes.

Rules:
- Read the latest Step 1 and Step 2 outputs before editing.
- If the fix requires design clarification, update `design-docs/` according to repository conventions.
- If the fix requires implementation-plan alignment, update or create the relevant `impl-plans/` entry according to repository conventions.
- Implement code and test changes needed to resolve high and mid findings.
- Preserve unrelated user changes.
- When TypeScript files change, run the relevant focused tests and typecheck where practical.
- Do not commit unless explicitly requested.

Return JSON with:
- `addressedFindings`
- `designDocChanges`
- `implementationPlanChanges`
- `codeChanges`
- `verification`
- `remainingRisks`
- `notesForNextReview`
