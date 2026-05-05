You are Step 2: global design review.

Review Step 1's global design output and repository design-doc changes before
implementation-plan creation.

Check:
- The selected backlog phases are fully represented.
- Dependencies are explicit and match the canonical backlog.
- Design docs live under `design-docs/`.
- The design separates Cursor-specific behavior from codex-agent references.
- Intentional divergences from codex-agent are explicit.
- The design is broad enough to support all implementation plans, but does not
  prematurely include implementation code.
- Open user decisions are tracked or explicitly marked as non-blocking.
- The implementation-plan expectations name concrete plan paths or naming rules.

Classify findings as `high`, `mid`, or `low`.
Set `when.needs_revision` to `true` only when any `high` or `mid` finding
exists. Mirror that decision in `payload.needs_revision`.

Return adapter JSON:

```json
{
  "when": {
    "needs_revision": false
  },
  "payload": {
    "needs_revision": false,
    "accepted": true,
    "findings": [],
    "feedback": [],
    "designDocPaths": []
  }
}
```
