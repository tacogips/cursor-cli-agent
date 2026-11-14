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
const fanoutJoin = mailboxInput.runtimeVariables?.fanoutJoin ?? {};
const results = Array.isArray(fanoutJoin.results) ? fanoutJoin.results : [];

function readBranchPayload(result) {
  const outputPath = result?.outputRef?.artifactDir === undefined
    ? null
    : `${result.outputRef.artifactDir}/output.json`;
  if (outputPath === null || !existsSync(outputPath)) return {};
  return JSON.parse(readFileSync(outputPath, "utf8"))?.payload ?? {};
}

function firstPath(value, fallback) {
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (typeof value === "string") return value;
  return fallback ?? null;
}

const plannedItems = results.map((result) => {
  const item = result.item ?? {};
  const payload = readBranchPayload(result);
  const featureId = payload.featureId ?? item.id ?? `branch-${result.branchIndex}`;
  const designDocPath = firstPath(payload.designDocPaths, item.designDocPath);
  const implPlanPath = firstPath(payload.implPlanPaths, item.implPlanPath);
  const dependencyIds = Array.isArray(payload.dependencyIds)
    ? payload.dependencyIds
    : Array.isArray(item.dependencyIds)
      ? item.dependencyIds
      : [];
  return {
    branchIndex: result.branchIndex,
    featureId,
    title: payload.featureTitle ?? item.title ?? featureId,
    targetFeatureArea: payload.targetFeatureArea ?? item.targetFeatureArea ?? null,
    requestedBehavior: payload.requestedBehavior ?? item.requestedBehavior ?? null,
    accepted: payload.accepted === true,
    status: payload.status ?? result.status ?? null,
    designDocPath,
    implPlanPath,
    dependencyIds,
    codexAgentReferences: payload.codexAgentReferences ?? item.codexAgentReferences ?? [],
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 999,
    reviewDecision: payload.accepted === true ? "accepted" : "revision_required",
    reviewSummary: payload.reviewSummary ?? null,
    residualRisks: payload.residualRisks ?? [],
  };
});

const featureIds = new Set(plannedItems.map((item) => item.featureId));
const dependencyGraph = Object.fromEntries(
  plannedItems.map((item) => [item.featureId, item.dependencyIds]),
);
const designDocPaths = Object.fromEntries(
  plannedItems.map((item) => [item.featureId, item.designDocPath]).filter((entry) => entry[1] !== null),
);
const implPlanPaths = Object.fromEntries(
  plannedItems.map((item) => [item.featureId, item.implPlanPath]).filter((entry) => entry[1] !== null),
);
const acceptedPlans = plannedItems
  .filter((item) => item.accepted && item.implPlanPath !== null)
  .map((item) => ({
    featureId: item.featureId,
    id: item.featureId,
    title: item.title,
    targetFeatureArea: item.targetFeatureArea,
    requestedBehavior: item.requestedBehavior,
    designDocPath: item.designDocPath,
    implPlanPath: item.implPlanPath,
    dependencyIds: item.dependencyIds,
    codexAgentReferences: item.codexAgentReferences,
    priority: item.priority,
    dependencyStatus: item.dependencyIds.some((dependencyId) => featureIds.has(dependencyId))
      ? "blocked"
      : "ready",
  }));
const readyImplementationPlans = acceptedPlans.filter((plan) => plan.dependencyStatus === "ready");
const blockedImplementationPlans = [
  ...acceptedPlans.filter((plan) => plan.dependencyStatus !== "ready"),
  ...plannedItems
    .filter((item) => !item.accepted && item.implPlanPath !== null)
    .map((item) => ({
      featureId: item.featureId,
      id: item.featureId,
      title: item.title,
      designDocPath: item.designDocPath,
      implPlanPath: item.implPlanPath,
      dependencyIds: item.dependencyIds,
      priority: item.priority,
      dependencyStatus: "blocked",
      blockReason: "branch_review_not_accepted",
    })),
];

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      workflowMode: "codex-agent-concurrent-design-implement",
      fanoutGroupRunId: fanoutJoin.fanoutGroupRunId ?? null,
      plannedItems,
      designDocPaths,
      implPlanPaths,
      dependencyGraph,
      readyImplementationPlans,
      blockedImplementationPlans,
      branchReviewSummaries: plannedItems.map((item) => ({
        featureId: item.featureId,
        accepted: item.accepted,
        reviewDecision: item.reviewDecision,
        findings: item.reviewSummary?.findings ?? [],
      })),
      verification: {
        branchCount: plannedItems.length,
        acceptedCount: plannedItems.filter((item) => item.accepted).length,
      },
      risks: plannedItems
        .filter((item) => !item.accepted)
        .map((item) => `${item.featureId} branch review is not accepted.`),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
