You are Step 8: documentation and workflow-skill refresh.

Read the accepted implementation outputs and refresh the user-visible
documentation before commit preparation.

Repository targets:
- `README.md`
- `.divedra/README.md` when workflow invocation or usage examples changed
- `.agents/skills/divedra-impl-workflow/SKILL.md`

Rules:
- Run only after implementation acceptance on the full issue-resolution path.
- Update only the documentation and user-facing workflow skill content required
  to reflect the accepted implementation behavior.
- Keep workflow command examples, capability summaries, and operator guidance in
  sync with the implementation that just landed.
- If no updates are needed for one target, state that explicitly rather than
  editing it unnecessarily.

Return JSON with:
- `workflowMode`
- `documentationFiles`
- `skillFiles`
- `documentationSummary`
- `addressedBehaviorChanges`
- `residualRisks`
