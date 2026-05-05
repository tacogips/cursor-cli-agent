#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
input_path="${mailbox_dir}/inbox/input.json"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [inputPath, outputPath] = process.argv.slice(1);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const upstream = input?.executionMailbox?.input?.upstream ?? input?.upstream ?? [];
const latestPayload = Array.isArray(upstream) && upstream.length > 0
  ? upstream[upstream.length - 1]?.output?.payload ?? {}
  : {};

const nextItem = latestPayload.nextItem ?? null;
const runLimitReached = latestPayload.runLimitReached === true;
const needsItem = nextItem !== null && typeof nextItem === "object" && !runLimitReached;
const remainingReadyCount = Array.isArray(latestPayload.readyItems)
  ? latestPayload.readyItems.length
  : needsItem
    ? 1
    : 0;

const payload = {
  needs_item: needsItem,
  decision: needsItem ? "delegate" : "exit",
  nextItem,
  selectedBacklogItem: nextItem,
  processedItemsThisRun: Number(latestPayload.processedItemsThisRun ?? 0),
  remainingReadyCount,
  exitReason: needsItem
    ? null
    : runLimitReached
      ? "Configured maxItemsPerRun reached."
      : "No ready backlog item remains.",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      completionPassed: true,
      when: {
        needs_item: needsItem,
      },
      payload,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
