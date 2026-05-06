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

function latestPayload(nodeId) {
  const values = [];
  if (Array.isArray(mailboxInput.latestOutputs)) {
    for (const output of mailboxInput.latestOutputs) {
      if (output?.nodeId === nodeId && output.payload && typeof output.payload === "object") {
        values.push(output.payload);
      }
    }
  }
  if (Array.isArray(mailboxInput.upstream)) {
    for (const output of mailboxInput.upstream) {
      if (output?.from === nodeId && output.payload && typeof output.payload === "object") {
        values.push(output.payload);
      }
    }
  }
  return values.at(-1) ?? {};
}

const author = latestPayload("step3-feature-design-plan");
const review = latestPayload("step3-feature-design-plan-review");
const feature = mailboxInput.runtimeVariables?.feature ?? mailboxInput.runtimeVariables?.fanout?.item ?? {};
const featureId = review.featureId ?? author.featureId ?? feature.id ?? "unknown-feature";
const accepted = review.accepted === true;

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      status: accepted ? "accepted" : "rejected",
      workflowMode: "codex-agent-concurrent-design-plan",
      featureId,
      featureTitle: author.featureTitle ?? feature.title ?? featureId,
      targetFeatureArea: author.targetFeatureArea ?? feature.targetFeatureArea ?? null,
      requestedBehavior: author.requestedBehavior ?? feature.requestedBehavior ?? null,
      accepted,
      designDocPaths:
        author.designDocPaths ??
        review.reviewedDesignDocPaths ??
        (typeof feature.designDocPath === "string" ? [feature.designDocPath] : []),
      implPlanPaths:
        author.implPlanPaths ??
        review.reviewedImplPlanPaths ??
        (typeof feature.implPlanPath === "string" ? [feature.implPlanPath] : []),
      dependencyIds: author.dependencyIds ?? feature.dependencyIds ?? [],
      codexAgentReferences: author.codexAgentReferences ?? feature.codexAgentReferences ?? [],
      reviewSummary: {
        accepted,
        findings: review.findings ?? [],
        feedback: review.feedback ?? [],
      },
      verification: author.verification ?? [],
      residualRisks: [
        ...(Array.isArray(author.risks) ? author.risks : []),
        ...(Array.isArray(review.residualRisks) ? review.residualRisks : []),
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
