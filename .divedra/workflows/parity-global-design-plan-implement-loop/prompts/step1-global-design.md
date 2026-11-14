You are Step 1: global parity design.

Create or update the full cursor-agent parity design before implementation
planning begins.

Before authoring, read `.agents/skills/design-doc/SKILL.md` and follow its
directory, file-naming, and scope rules.

Primary sources:
- `design-docs/specs/design-parity-backlog-workflow.md`
- `design-docs/specs/design-codex-agent-parity-gap.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- local codex-agent reference repository from `runtimeVariables.referenceRepositoryRoot`
  or `/Users/taco/gits/tacogips/codex-agent`

Runtime options:
- `runtimeVariables.targetPhases`, default `["2","3","4","5"]`
- `runtimeVariables.referenceRepositoryRoot`, default `/Users/taco/gits/tacogips/codex-agent`

Canonical backlog:
- `P2-SESSION-SEARCH`: Session metadata search, no dependencies
- `P2-TRANSCRIPT-SEARCH`: Transcript full-text search, depends on `P2-SESSION-SEARCH`
- `P2-BOOKMARKS`: Bookmark lifecycle, depends on `P2-TRANSCRIPT-SEARCH`
- `P2-ACTIVITY`: Activity derivation, no dependencies
- `P2-MARKDOWN-TASKS`: Markdown and task extraction, depends on `P2-TRANSCRIPT-SEARCH`
- `P3-GROUP-LIFECYCLE`: Advanced group controls, depends on `P2-ACTIVITY`
- `P3-QUEUE-LIFECYCLE`: Advanced queue controls, depends on `P2-ACTIVITY`
- `P3-FILE-INTELLIGENCE`: File intelligence, depends on `P2-SESSION-SEARCH`
- `P3-REPO-ANALYTICS`: Commit and repository analytics, depends on `P3-FILE-INTELLIGENCE`
- `P4-HTTP-SERVER`: REST server surface, depends on `P2-BOOKMARKS`, `P3-GROUP-LIFECYCLE`, `P3-QUEUE-LIFECYCLE`, `P3-FILE-INTELLIGENCE`
- `P4-SSE`: Live event streaming, depends on `P4-HTTP-SERVER`, `P2-ACTIVITY`
- `P4-AUTH`: Token and bearer auth, depends on `P4-HTTP-SERVER`
- `P4-DAEMON`: Daemon lifecycle, depends on `P4-HTTP-SERVER`, `P4-SSE`
- `P4-PUBLIC-SDK`: Public SDK facade, depends on `P4-HTTP-SERVER`
- `P5-COMPAT-BRIDGE`: Optional compatibility bridge, depends on `P4-HTTP-SERVER`, `P4-PUBLIC-SDK`
- `P5-TOOL-REGISTRY`: Tool and model availability helpers, depends on `P4-PUBLIC-SDK`

Rules:
- Design the full target for all selected phases before planning any one item.
- Keep the global design compact. Prefer updating
  `design-docs/specs/design-codex-agent-parity-gap.md`,
  `design-docs/specs/design-parity-backlog-workflow.md`,
  `design-docs/specs/architecture.md`, and `design-docs/specs/command.md`
  rather than creating many new design files.
- Dedicated `design-docs/specs/design-<topic>.md` files are allowed when a
  feature needs detailed behavior that would overload the global docs.
- Keep Cursor-specific behavior isolated behind adapters and persistence
  modules; do not copy codex-agent APIs blindly.
- Explicitly document dependencies, intentional divergences, phased rollout,
  test strategy, and implementation-plan path expectations.
- Do not write implementation code in this step.

Return JSON with:
- `workflowMode`: `global-design-plan-implement`
- `targetPhases`
- `backlogItems`
- `designDocPaths`
- `codexAgentReferences`
- `dependencyGraph`
- `cursorCliBehaviorMapping`
- `intentionalDivergences`
- `implementationPlanExpectations`
- `verificationStrategy`
- `openQuestions`
- `risks`
