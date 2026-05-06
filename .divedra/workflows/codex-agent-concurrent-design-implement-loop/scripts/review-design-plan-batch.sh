#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
input_path="${mailbox_dir}/inbox/input.json"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(1);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const mailboxInput = input?.executionMailbox?.input ?? input ?? {};

function latestStepPayload(stepId) {
  const payloads = [];
  if (Array.isArray(mailboxInput.latestOutputs)) {
    for (const output of mailboxInput.latestOutputs) {
      if (output?.nodeId === stepId && output.payload && typeof output.payload === "object") {
        payloads.push(output.payload);
      }
    }
  }
  if (Array.isArray(mailboxInput.upstream)) {
    for (const output of mailboxInput.upstream) {
      if (output?.from === stepId && output.payload && typeof output.payload === "object") {
        payloads.push(output.payload);
      }
    }
  }
  return payloads.at(-1) ?? null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePathMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value).filter((entry) => typeof entry === "string");
  }
  return asArray(value).filter((entry) => typeof entry === "string");
}

const step4 = latestStepPayload("step4-join-feature-plans") ?? {};
const plannedItems = asArray(step4.plannedItems);
const designDocPaths = normalizePathMap(step4.designDocPaths);
const implPlanPaths = normalizePathMap(step4.implPlanPaths);
const findings = [];

if (plannedItems.length === 0) {
  findings.push({
    severity: "high",
    code: "empty_batch",
    message: "Step 4 did not provide plannedItems, so implementation cannot start.",
  });
}

for (const item of plannedItems) {
  const featureId = typeof item?.featureId === "string" ? item.featureId : "unknown-feature";
  if (item?.accepted !== true) {
    findings.push({
      severity: "mid",
      code: "branch_not_accepted",
      featureId,
      designDocPath: item?.designDocPath ?? null,
      implPlanPath: item?.implPlanPath ?? null,
      reviewDecision: item?.reviewDecision ?? null,
      message: `${featureId} branch review has not accepted its design/implementation-plan output.`,
    });
  }
}

for (const path of designDocPaths) {
  if (!existsSync(path)) {
    findings.push({
      severity: "high",
      code: "missing_design_doc",
      path,
      message: `Design document does not exist: ${path}`,
    });
  }
}

for (const path of implPlanPaths) {
  if (!existsSync(path)) {
    findings.push({
      severity: "high",
      code: "missing_impl_plan",
      path,
      message: `Implementation plan does not exist: ${path}`,
    });
  }
}

const needsRevision = findings.some((finding) => finding.severity === "high" || finding.severity === "mid");
const readyImplementationPlans = needsRevision ? [] : asArray(step4.readyImplementationPlans);
const blockedImplementationPlans = needsRevision
  ? [
      ...asArray(step4.readyImplementationPlans),
      ...asArray(step4.blockedImplementationPlans),
    ]
  : asArray(step4.blockedImplementationPlans);

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      completionPassed: true,
      when: {
        needs_design_plan_revision: needsRevision,
      },
      payload: {
        accepted: !needsRevision,
        plannedItems,
        readyImplementationPlans,
        blockedImplementationPlans,
        findings,
        feedback: needsRevision
          ? [
              "Rerun the feature design/plan fanout and require every branch review to accept before Step 6 implementation selection.",
            ]
          : [],
        reviewedDesignDocPaths: designDocPaths,
        reviewedImplPlanPaths: implPlanPaths,
        residualRisks: asArray(step4.risks),
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
