#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
input_path="${mailbox_dir}/inbox/input.json"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [inputPath, outputPath] = process.argv.slice(1);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const mailboxInput = input?.executionMailbox?.input ?? input ?? {};
const runtime = mailboxInput.runtimeVariables ?? input.variables ?? {};
const workflowExecutionId = input.workflowExecutionId ?? input.sessionId;

function walk(value, visitor) {
  if (Array.isArray(value)) {
    visitor(value);
    for (const item of value) walk(item, visitor);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) walk(child, visitor);
  }
}

function normalizePlan(item) {
  if (!item || typeof item !== "object") return null;
  const featureId = item.featureId ?? item.id ?? item.backlogItemId ?? item.planId;
  const implPlanPath = item.implPlanPath ?? item.preferredImplPlanPath ?? item.planPath;
  if (typeof featureId !== "string" || typeof implPlanPath !== "string") return null;
  const activePlanStatus = readActivePlanStatus(implPlanPath);
  return {
    ...item,
    featureId,
    id: item.id ?? featureId,
    implPlanPath,
    designDocPath: item.designDocPath ?? item.preferredDesignDocPath ?? null,
    dependencyIds: Array.isArray(item.dependencyIds) ? item.dependencyIds : [],
    activePlanStatus,
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 999,
  };
}

function readActivePlanStatus(implPlanPath) {
  if (typeof implPlanPath !== "string" || !existsSync(implPlanPath)) return null;
  const text = readFileSync(implPlanPath, "utf8");
  const match = text.match(/\*\*Status\*\*:\s*([^\n]+)/);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

function latestStepPayloads(stepId) {
  return [
    ...(Array.isArray(mailboxInput.latestOutputs)
      ? mailboxInput.latestOutputs
          .filter((output) => output?.nodeId === stepId)
          .map((output) => output.payload)
      : []),
    ...(Array.isArray(mailboxInput.upstream)
      ? mailboxInput.upstream
          .filter((output) => output?.from === stepId)
          .map((output) => output.payload)
      : []),
  ].filter(Boolean);
}

function collectPlanArrays(root) {
  const candidates = [];
  walk(root, (array) => {
    const normalized = array.map(normalizePlan).filter(Boolean);
    if (normalized.length > 0) candidates.push(normalized);
  });
  return candidates.sort((a, b) => b.length - a.length)[0] ?? [];
}

function readCompletedFromSession() {
  const completed = new Set();
  if (typeof workflowExecutionId !== "string") return completed;
  const sessionPath = join(".divedra", "artifacts", "sessions", `${workflowExecutionId}.json`);
  if (!existsSync(sessionPath)) return completed;
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  for (const execution of Array.isArray(session.nodeExecutions) ? session.nodeExecutions : []) {
    if (execution?.nodeId !== "step6-post-implementation-review" || execution?.status !== "succeeded") continue;
    const outputFile = join(execution.artifactDir, "output.json");
    if (!existsSync(outputFile)) continue;
    const payload = JSON.parse(readFileSync(outputFile, "utf8"))?.payload ?? {};
    if (typeof payload.completedFeatureId === "string" && payload.completedFeatureId.length > 0) {
      completed.add(payload.completedFeatureId);
    }
    if (typeof payload.completedPlanPath === "string" && payload.completedPlanPath.length > 0) {
      completed.add(payload.completedPlanPath);
    }
  }
  return completed;
}

function readCompletedPlanText() {
  if (!existsSync("impl-plans/completed")) return [];
  return readdirSync("impl-plans/completed")
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(join("impl-plans/completed", name), "utf8"));
}

const maxItemsPerRun = Number(runtime.maxItemsPerRun ?? runtime?.workflowInput?.maxItemsPerRun ?? 999);
const completed = readCompletedFromSession();
const completedText = readCompletedPlanText();
for (const payload of latestStepPayloads("step1-decompose-codex-features")) {
  for (const item of Array.isArray(payload.excludedItems) ? payload.excludedItems : []) {
    if (item?.status === "completed") {
      if (typeof item.id === "string") completed.add(item.id);
      if (typeof item.implPlanPath === "string") completed.add(item.implPlanPath);
    }
  }
}

const step5Payloads = latestStepPayloads("step5-overall-design-plan-review");
const step1ExistingPlanItems = latestStepPayloads("step1-decompose-codex-features")
  .flatMap((payload) => (Array.isArray(payload.excludedItems) ? payload.excludedItems : []))
  .filter((item) => item?.status !== "completed" && typeof item?.implPlanPath === "string")
  .map((item) => ({
    ...item,
    featureId: item.id,
    dependencyIds: Array.isArray(item.dependencyIds) ? item.dependencyIds : [],
  }));
const plans = (step5Payloads.flatMap((payload) => [
  ...(Array.isArray(payload.readyImplementationPlans)
    ? payload.readyImplementationPlans
    : []),
  ...(Array.isArray(payload.blockedImplementationPlans)
    ? payload.blockedImplementationPlans
    : []),
]).map(normalizePlan).filter(Boolean).length > 0
  ? step5Payloads.flatMap((payload) => [
      ...(Array.isArray(payload.readyImplementationPlans)
        ? payload.readyImplementationPlans
        : []),
      ...(Array.isArray(payload.blockedImplementationPlans)
        ? payload.blockedImplementationPlans
        : []),
    ]).map(normalizePlan).filter(Boolean)
  : step1ExistingPlanItems.map(normalizePlan).filter(Boolean).length > 0
    ? step1ExistingPlanItems.map(normalizePlan).filter(Boolean)
    : collectPlanArrays(mailboxInput)
).sort((left, right) => left.priority - right.priority);
for (const plan of plans) {
  if (completedText.some((text) => text.includes(plan.featureId) || text.includes(plan.implPlanPath))) {
    completed.add(plan.featureId);
    completed.add(plan.implPlanPath);
  }
}

const processedItemsThisRun = Array.from(completed).filter((value) => value.startsWith("impl-plans/") === false).length;
const runLimitReached = processedItemsThisRun >= maxItemsPerRun;
const remaining = plans.filter((plan) =>
  !completed.has(plan.featureId) &&
  !completed.has(plan.implPlanPath) &&
  plan.activePlanStatus !== "completed" &&
  plan.status !== "completed"
);
const ready = remaining.filter((plan) =>
  plan.dependencyStatus === "ready" ||
  plan.status === "ready" ||
  plan.activePlanStatus === "ready" ||
  plan.activePlanStatus === "in progress" ||
  plan.dependencyIds.every((dependencyId) => completed.has(dependencyId)),
);
const blocked = remaining.filter((plan) => !ready.includes(plan));
const selectedPlan = runLimitReached ? null : (
  ready.find((plan) => plan.activePlanStatus === "in progress") ?? ready[0] ?? null
);

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      completionPassed: true,
      when: {
        needs_item: selectedPlan !== null,
      },
      payload: {
        selectedPlan,
        readyImplementationPlans: ready,
        blockedImplementationPlans: blocked,
        completedItemsThisRun: Array.from(completed),
        processedItemsThisRun,
        exitReason:
          selectedPlan !== null
            ? null
            : runLimitReached
              ? "Configured maxItemsPerRun reached."
              : "No ready implementation plan remains.",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
