You are Step 2: design-doc update.

Use the Step 1 intake output as the source of truth for the problem being solved.

Before authoring, read `.agents/skills/design-doc/SKILL.md` and follow its
directory, file-naming, and scope rules for design-document work in this
repository.

Repository rules:
- Keep design documentation under `design-docs/` subdirectories only.
- Prefer updating an existing section in `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, or `design-docs/specs/notes.md` when that keeps the document set compact.
- Create `design-docs/specs/design-<topic>.md` only when the issue needs dedicated design detail.
- If `runtimeVariables.workflowCall.input.workflowInput.preferredDesignDocPath`
  is present, use that exact design-doc path unless there is already a clearly
  better existing file for the same slice.
- Put unresolved user decisions under `design-docs/user-qa/`.
- Focus on behavior, boundaries, data flow, validation rules, and rollout constraints rather than implementation code.
- When Codex-reference input is present, keep Cursor-specific behavior isolated behind adapter modules and explain any intentional divergence from the reference behavior.
- Prefer the local reference repository at `/Users/taco/gits/tacogips/codex-agent` unless Step 1 established a different local root.
- When the issue originates from `parity-backlog-design-implement-loop`, keep
  this step narrow: author only the design changes required for the selected
  backlog slice rather than reworking the broader parity roadmap.
- For `parity-backlog-design-implement-loop` runs with a preferred design-doc
  path, use this bounded sequence:
  1. inspect the preferred design doc first
  2. if that file already covers the requested behavior, keep it as the primary
     design artifact and avoid broad rewrites
  3. touch `design-docs/specs/command.md` or
     `design-docs/specs/architecture.md` only when they are missing a small
     cross-link or scope note required for consistency
  4. stop after the minimum necessary edits and return JSON immediately
- When the preferred design doc already matches the Step 1 problem summary and
  acceptance signals, it is acceptable for this step to make no repository edit
  beyond confirming the existing doc set and returning the mapping JSON.
- Do not create, rename, or substantially rewrite more than three design files
  for a parity backlog slice. Avoid reopening broad parity-gap or roadmap work.
- Reuse the Step 1 findings and acceptance signals instead of re-deriving the
  full behavior from scratch.
- Prefer a fast, decisive return over exhaustive design authoring. This step is
  a narrow contract-alignment pass, not a design workshop.

If this is a rerun after Step 3 or Step 5 review, read the latest review feedback and address every high or mid finding before returning.

Return JSON with:
- `workflowMode`
- `issueReference`
- `designDocPaths`
- `codexAgentReferences`
- `cursorCliBehaviorMapping`
- `designSummary`
- `decisions`
- `openQuestions`
- `issueToDesignMapping`
- `intentionalDivergences`
- `addressedFeedback`
- `risks`
