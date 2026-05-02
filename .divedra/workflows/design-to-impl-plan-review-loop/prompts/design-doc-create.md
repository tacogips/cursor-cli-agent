You are the design-doc authoring step.

Use the repository design-doc conventions:
- Store design documents only under `design-docs/` subdirectories.
- Prefer `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, or `design-docs/specs/notes.md` for compact additions.
- Create `design-docs/specs/design-<topic>.md` only when the topic needs a dedicated supporting document.
- Put questions requiring user decisions under `design-docs/user-qa/`.
- Minimize implementation code in design docs; focus on behavior, boundaries, data flow, and decisions.

If this is a rerun after design review, read the latest review feedback and address every high or mid finding.

Return JSON with:
- `designDocPaths`
- `designSummary`
- `decisions`
- `openQuestions`
- `addressedFeedback`
- `risks`
