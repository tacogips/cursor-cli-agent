#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
input_path="${mailbox_dir}/inbox/input.json"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(1);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const mailboxInput = input?.executionMailbox?.input ?? input ?? {};

function latestReviewPayload() {
  const values = [];
  if (Array.isArray(mailboxInput.latestOutputs)) {
    for (const output of mailboxInput.latestOutputs) {
      if (output?.nodeId === "step3-feature-design-plan-review" && output.payload) {
        values.push(output.payload);
      }
    }
  }
  if (Array.isArray(mailboxInput.upstream)) {
    for (const output of mailboxInput.upstream) {
      if (output?.from === "step3-feature-design-plan-review" && output.payload) {
        values.push(output.payload);
      }
    }
  }
  return values.at(-1) ?? {};
}

const review = latestReviewPayload();
const revisionFlags = review.revisionFlags && typeof review.revisionFlags === "object"
  ? review.revisionFlags
  : {};
const findings = Array.isArray(review.findings) ? review.findings : [];
const accepted = review.accepted === true;
const needsDesignRevision =
  revisionFlags.needs_design_revision === true ||
  findings.some((finding) => finding?.revisionTarget === "design");
const needsRevision =
  revisionFlags.needs_revision === true ||
  accepted !== true ||
  findings.some((finding) => finding?.revisionTarget === "implementation-plan");

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      completionPassed: true,
      when: {
        needs_design_revision: needsDesignRevision,
        needs_revision: needsRevision,
      },
      payload: {
        ...review,
        accepted,
        needs_design_revision: needsDesignRevision,
        needs_revision: needsRevision,
        findings,
        feedback: review.feedback ?? [],
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
