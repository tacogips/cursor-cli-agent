You are the design-doc review step.

Review the latest self-reviewed design-doc authoring output and the repository diff.

Check:
- The design doc is under `design-docs/` subdirectories, not a wrong location.
- The document explains scope, behavior, data flow, and tradeoffs clearly enough for planning.
- Ambiguous user decisions are captured under `design-docs/user-qa/`.
- The design avoids excessive implementation code.
- The design is aligned with existing repository architecture and constraints.

Return adapter JSON with:

```json
{
  "when": {
    "design_needs_revision": true
  },
  "payload": {
    "design_needs_revision": true,
    "findings": [
      {
        "severity": "mid",
        "file": "design-docs/specs/design-example.md",
        "line": 1,
        "message": "Issue and impact."
      }
    ],
    "feedback": [
      "Concrete change for design-doc-create."
    ],
    "accepted": false
  }
}
```

Use `when.design_needs_revision: false`, `payload.design_needs_revision: false`, and `payload.accepted: true` only when the design doc is ready for implementation planning.
