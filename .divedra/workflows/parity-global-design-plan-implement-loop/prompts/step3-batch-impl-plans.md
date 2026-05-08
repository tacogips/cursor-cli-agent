You are Step 3: batch implementation-plan creation.

Create all implementation plans for the selected parity backlog before
implementation begins.

Before authoring, read `.agents/skills/impl-plan/SKILL.md` and follow its plan
location, structure, progress-tracking, and sizing rules for this repository.

Use Step 1 and Step 2 as the accepted global design contract.

Rules:
- Create or update one active implementation plan per selected backlog item.
- Store active plans under `impl-plans/active/`.
- Do not implement code in this step.
- Each plan must include design references, deliverables, dependencies,
  completion criteria, verification, and a progress log.
- Plans must be sized so each implementation task can be delegated separately.
- Mark parallelizable tasks only when write scopes are disjoint.
- Preserve the canonical dependency order across plans.
- If a plan already exists for a backlog item, update it in place and keep its
  progress history.
- The selected phases default to `2`, `3`, `4`, and `5`.

Preferred plan paths:
- `P2-SESSION-SEARCH`: `impl-plans/active/session-search.md`
- `P2-TRANSCRIPT-SEARCH`: `impl-plans/active/transcript-search.md`
- `P2-BOOKMARKS`: `impl-plans/active/bookmarks.md`
- `P2-ACTIVITY`: `impl-plans/active/activity.md`
- `P2-MARKDOWN-TASKS`: `impl-plans/active/markdown-tasks.md`
- `P3-GROUP-LIFECYCLE`: `impl-plans/completed/group-lifecycle.md`
- `P3-QUEUE-LIFECYCLE`: `impl-plans/active/queue-lifecycle.md`
- `P3-FILE-INTELLIGENCE`: `impl-plans/completed/file-intelligence.md`
- `P3-REPO-ANALYTICS`: `impl-plans/active/repository-analytics.md`
- `P4-HTTP-SERVER`: `impl-plans/completed/http-server-core.md`
- `P4-SSE`: `impl-plans/active/server-event-streaming.md`
- `P4-AUTH`: `impl-plans/completed/token-auth.md`
- `P4-DAEMON`: `impl-plans/completed/daemon-lifecycle.md`
- `P4-PUBLIC-SDK`: `impl-plans/active/public-sdk.md`
- `P5-COMPAT-BRIDGE`: `impl-plans/active/compat-bridge.md`
- `P5-TOOL-REGISTRY`: `impl-plans/active/tool-registry-model-helpers.md`

Return JSON with:
- `workflowMode`: `global-design-plan-implement`
- `targetPhases`
- `implPlanPaths`
- `backlogPlanMap`
- `dependencyGraph`
- `parallelizationGroups`
- `verificationByPlan`
- `createdPlans`
- `updatedPlans`
- `deferredPlans`
- `risks`
