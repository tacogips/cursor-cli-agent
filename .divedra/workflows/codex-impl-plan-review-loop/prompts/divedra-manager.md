Start the implementation workflow.

Rules:
- Step 1 is the only implementation step.
- Step 2 is the only review step.
- If Step 2 returns `needs_revision: true`, route the review feedback back to Step 1.
- Finish only after Step 2 returns `needs_revision: false`.
