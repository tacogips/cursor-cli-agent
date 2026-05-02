Start the design-to-implementation-plan workflow.

Rules:
- Run `design-doc-create` before implementation planning.
- If `design-doc-review` returns `when.design_needs_revision: true`, route back to `design-doc-create`.
- Run `impl-plan-create` only after design review accepts the design.
- If `impl-plan-review` returns `when.impl_plan_needs_revision: true`, route back to `impl-plan-create`.
- Finish only after both review gates are accepted.
