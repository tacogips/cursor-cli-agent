You are Step 1: codex-agent feature decomposition.

Analyze the local codex-agent reference repository and decompose its relevant functionality into feature-local work items for this repository.

Inputs:
- `runtimeVariables.referenceRepositoryRoot`, default `/Users/taco/gits/tacogips/codex-agent`
- `runtimeVariables.targetAreas`, optional list of areas to include
- `runtimeVariables.maxFeatures`, optional maximum feature count
- `runtimeVariables.maxItemsPerRun`, optional implementation-loop limit; this must not limit decomposition
- Existing repository design docs and implementation plans

Primary local sources:
- `/Users/taco/gits/tacogips/codex-agent`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `impl-plans/active/`
- `impl-plans/completed/`

Rules:
- Decompose by coherent user-visible or architectural capability, not by arbitrary files.
- Each feature item must have disjoint design and implementation-plan output paths.
- Include dependencies explicitly so implementation can run one plan at a time in dependency order.
- Keep each feature small enough for one focused implementation cycle.
- Mark features already completed or out of scope rather than duplicating them.
- Return the complete remaining design/implementation-plan work set before any implementation starts.
- Do not return only the next or highest-priority item. If no `targetAreas` or `maxFeatures` filter is provided, scan all relevant codex-agent capabilities and existing parity docs/plans, then include every remaining feature-local candidate.
- Treat `maxItemsPerRun` only as the later serial implementation limit. It must not reduce `payload.featureItems`.
- If an existing design doc or implementation plan already covers a capability, include it only when it still needs design/plan refresh; otherwise list it in `excludedItems` with the reason.
- When returning fewer than three candidate feature items without an explicit `targetAreas` or `maxFeatures` filter, include a concrete justification in `payload.risks` explaining why the remaining codex-agent parity surface is that small.
- Do not create design docs, implementation plans, or code in this step.

Return adapter JSON only:

```json
{
  "completionPassed": true,
  "when": {
    "has_feature_items": true
  },
  "payload": {
    "workflowMode": "codex-agent-concurrent-design-implement",
    "referenceRepositoryRoot": "/Users/taco/gits/tacogips/codex-agent",
    "featureItems": [
      {
        "id": "FEATURE-ID",
        "title": "Feature title",
        "targetFeatureArea": "area",
        "requestedBehavior": "behavior to implement",
        "codexAgentReferences": [],
        "designDocPath": "design-docs/specs/design-feature-id.md",
        "implPlanPath": "impl-plans/active/feature-id.md",
        "dependencyIds": [],
        "priority": 1,
        "status": "candidate"
      }
    ],
    "excludedItems": [],
    "dependencyGraph": {},
    "risks": []
  }
}
```

Set `when.has_feature_items` to false only when no feature-local design and planning work should run.
