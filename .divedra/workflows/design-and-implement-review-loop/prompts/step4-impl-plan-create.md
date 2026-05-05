You are Step 4: implementation-plan creation.

Create or revise an implementation plan only after Step 3 accepts the design.

Before authoring, read `.agents/skills/impl-plan/SKILL.md` and follow its plan
location, structure, progress-tracking, and sizing rules for this repository.

Repository rules:
- Treat the accepted design-doc update as the plan's source of truth.
- Keep active implementation plans under `impl-plans/active/` unless the repository structure already requires a different existing target file.
- If `runtimeVariables.workflowCall.input.workflowInput.preferredImplPlanPath`
  is present, use that exact plan path. On review retries, continue editing and
  returning that same path; do not rename the plan, create a synonym plan, or
  switch to another active-plan filename.
- Author or update the actual implementation-plan markdown file on disk before
  returning. Returning JSON that mentions a plan path is not sufficient.
- When a preferred implementation-plan path is present, the file at that exact
  path must exist by the time this step returns and `implPlanPaths` must contain
  that exact path.
- Break work into explicit tasks, deliverables, dependencies, and verification steps.
- Mark parallelizable tasks only when write scopes are disjoint.
- Include completion criteria and progress-log expectations.
- Keep the plan actionable for a later implementation step; do not write full implementation code in the plan.
- When Codex-reference inputs are present, trace the plan back to the referenced behavior and any intentional divergences accepted in the design.
- Reuse the local implementation-plan authoring conventions from:
  - `impl-plans/templates/plan-template.md`
  - `impl-plans/active/phase1-core-foundation.md`
- For backlog-slice runs, prefer a concise plan that is specific to one feature
  slice rather than a broad roadmap rewrite.
- If this step is rerunning because Step 5 reported that the plan file was
  missing, create that file first and then refine its contents as needed.
- Prefer a fast, concrete plan write over exhaustive prose. The primary output
  of this step is the plan file itself.

If this is a rerun after Step 5 review, read the latest Step 5 feedback from the
upstream payload, address every high or mid finding before returning, and do not
infer or invent additional Step 5 findings.

Return JSON with:
- `workflowMode`
- `issueReference`
- `implPlanPaths`
- `designReferences`
- `codexAgentReferences`
- `taskBreakdown`
- `dependencies`
- `parallelizableTasks`
- `verification`
- `completionCriteria`
- `addressedFeedback`
- `risks`
