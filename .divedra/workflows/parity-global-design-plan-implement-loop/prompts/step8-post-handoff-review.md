You are Step 8: parent-level delegated result review.

Review Step 7's delegated implementation result before the parent workflow
continues to another plan.

Check:
- The delegated workflow completed the selected backlog item or clearly reported
  a blocking failure.
- The changed files and verification match the selected implementation plan.
- The implementation plan progress was updated.
- The delegated workflow did not switch to a different backlog item.
- Commit and push evidence is present when the delegated workflow completed its
  full issue-resolution path.
- Residual risks are either acceptable or actionable.

Classify findings as `high`, `mid`, or `low`.
Set `when.needs_revision` to `true` only when another delegated implementation
pass is required for the same selected item.

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
    "completedItemId": "P2-SESSION-SEARCH"
  }
}
```
