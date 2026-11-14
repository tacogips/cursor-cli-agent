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
const runtime = mailboxInput.runtimeVariables ?? input.variables ?? {};

function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  if (value && typeof value === "object") {
    visitor(value);
    for (const child of Object.values(value)) walk(child, visitor);
  }
}

let selectedPlan = null;
walk(mailboxInput, (value) => {
  if (selectedPlan === null && value.selectedPlan && typeof value.selectedPlan === "object") {
    selectedPlan = value.selectedPlan;
  }
});

if (selectedPlan === null) {
  selectedPlan = {};
}

const featureId = selectedPlan.featureId ?? selectedPlan.id ?? "unknown-feature";
const title = selectedPlan.title ?? selectedPlan.featureTitle ?? featureId;
const targetFeatureArea = selectedPlan.targetFeatureArea ?? title;
const requestedBehavior =
  selectedPlan.requestedBehavior ??
  `Implement the reviewed codex-agent-derived feature ${featureId}.`;
const referenceRepositoryRoot =
  runtime.referenceRepositoryRoot ??
  runtime?.workflowInput?.referenceRepositoryRoot ??
  "/Users/taco/gits/tacogips/codex-agent";
const preferredDesignDocPath =
  selectedPlan.designDocPath ?? selectedPlan.preferredDesignDocPath ?? null;
const preferredImplPlanPath =
  selectedPlan.implPlanPath ?? selectedPlan.preferredImplPlanPath ?? selectedPlan.planPath ?? null;

const workflowInput = {
  workflowId: "design-and-implement-review-loop",
  executionMode: "issue-resolution",
  issueReference: `codex-agent-concurrent-design-implement-loop#${featureId}`,
  issueTitle: `Implement ${featureId}: ${title}`,
  issueBody: `Implement the reviewed codex-agent-derived feature ${featureId}. Use the accepted design document and implementation plan as the source of truth, keep scope limited to this plan, update plan progress, verify the change, and run the delegated review/improve cycle until accepted.`,
  targetFeatureArea,
  requestedBehavior,
  referenceRepositoryRoot,
  ...(preferredDesignDocPath === null ? {} : { preferredDesignDocPath }),
  ...(preferredImplPlanPath === null ? {} : { preferredImplPlanPath }),
  codexAgentReferences: Array.isArray(selectedPlan.codexAgentReferences)
    ? selectedPlan.codexAgentReferences
    : [],
  reviewContext: {
    parentWorkflowId: "codex-agent-concurrent-design-implement-loop",
    selectedPlan,
    dependencyIds: Array.isArray(selectedPlan.dependencyIds)
      ? selectedPlan.dependencyIds
      : [],
  },
  fullImplementationRequested: true,
};

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      workflowInput,
      selectedPlan,
      handoffSummary: {
        decision: "delegate",
        delegatedWorkflowId: "design-and-implement-review-loop",
        selectedFeatureId: featureId,
        preferredDesignDocPath,
        preferredImplPlanPath,
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
