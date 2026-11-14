You are Step 2: parity backlog selection gate.

Read the latest Step 1 output. Decide whether the workflow should delegate the
next backlog item or exit.

Rules:
- Set `needs_item` to true only when:
  - `nextItem` is present
  - `runLimitReached` is false
- Set `needs_item` to false when:
  - `nextItem` is null
  - or `runLimitReached` is true
- Mirror the routing decision in both `when.needs_item` and
  `payload.needs_item`.
- Do not invent backlog items that Step 1 did not report.

Return adapter JSON:

```json
{
  "when": {
    "needs_item": true
  },
  "payload": {
    "needs_item": true,
    "decision": "delegate",
    "nextItem": {
      "id": "P2-SESSION-SEARCH"
    },
    "processedItemsThisRun": 0,
    "remainingReadyCount": 3,
    "exitReason": null
  }
}
```

When exiting because no ready item remains, use:
- `when.needs_item: false`
- `payload.decision: "exit"`
- `payload.exitReason: "No ready backlog item remains."`

When exiting because the run limit has been reached, use:
- `when.needs_item: false`
- `payload.decision: "exit"`
- `payload.exitReason: "Configured maxItemsPerRun reached."`
