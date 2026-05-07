#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
input_path="${mailbox_dir}/inbox/input.json"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [inputPath, outputPath] = process.argv.slice(1);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const mailboxInput = input?.executionMailbox?.input ?? {};
const runtime = mailboxInput.runtimeVariables ?? input.variables ?? {};
const workflowExecutionId = input.workflowExecutionId ?? input.sessionId;

const items = [
  ["P2-SESSION-SEARCH", "2", "Session metadata search", "session metadata search", "Implement metadata search across indexed Cursor sessions.", [], "design-docs/specs/design-session-search.md", "impl-plans/active/session-search.md"],
  ["P2-TRANSCRIPT-SEARCH", "2", "Transcript full-text search", "transcript full-text search", "Implement transcript full-text search for indexed Cursor sessions.", ["P2-SESSION-SEARCH"], "design-docs/specs/design-transcript-search.md", "impl-plans/active/transcript-search.md"],
  ["P2-BOOKMARKS", "2", "Bookmark lifecycle", "bookmarks", "Implement bookmark create, list, update, and delete support.", ["P2-TRANSCRIPT-SEARCH"], "design-docs/specs/design-bookmarks.md", "impl-plans/active/bookmarks.md"],
  ["P2-ACTIVITY", "2", "Activity derivation", "activity tracking", "Implement activity derivation from indexed Cursor session state.", [], "design-docs/specs/design-activity.md", "impl-plans/active/activity.md"],
  ["P2-MARKDOWN-TASKS", "2", "Markdown and task extraction", "markdown task extraction", "Implement markdown task extraction from Cursor session content.", ["P2-TRANSCRIPT-SEARCH"], "design-docs/specs/design-markdown-tasks.md", "impl-plans/active/markdown-tasks.md"],
  ["P3-GROUP-LIFECYCLE", "3", "Advanced group controls", "advanced group lifecycle", "Implement advanced group lifecycle controls.", ["P2-ACTIVITY"], "design-docs/specs/design-group-lifecycle.md", "impl-plans/active/group-lifecycle.md"],
  ["P3-QUEUE-LIFECYCLE", "3", "Advanced queue controls", "advanced queue lifecycle", "Implement advanced queue lifecycle controls.", ["P2-ACTIVITY"], "design-docs/specs/design-queue-lifecycle.md", "impl-plans/active/queue-lifecycle.md"],
  ["P3-FILE-INTELLIGENCE", "3", "File intelligence", "file intelligence", "Implement file intelligence derived from Cursor sessions.", ["P2-SESSION-SEARCH"], "design-docs/specs/design-file-intelligence.md", "impl-plans/active/file-intelligence.md"],
  ["P3-REPO-ANALYTICS", "3", "Commit and repository analytics", "repository analytics", "Implement commit and repository analytics.", ["P3-FILE-INTELLIGENCE"], "design-docs/specs/design-repository-analytics.md", "impl-plans/active/repository-analytics.md"],
  ["P4-HTTP-SERVER", "4", "REST server surface", "http server", "Implement the REST server surface.", ["P2-BOOKMARKS", "P3-GROUP-LIFECYCLE", "P3-QUEUE-LIFECYCLE", "P3-FILE-INTELLIGENCE"], "design-docs/specs/design-http-server-core.md", "impl-plans/active/http-server-core.md"],
  ["P4-SSE", "4", "Live event streaming", "server event streaming", "Implement live server event streaming.", ["P4-HTTP-SERVER", "P2-ACTIVITY"], "design-docs/specs/design-server-event-streaming.md", "impl-plans/active/server-event-streaming.md"],
  ["P4-AUTH", "4", "Token and bearer auth", "server auth", "Implement token and bearer authentication.", ["P4-HTTP-SERVER"], "design-docs/specs/design-token-auth.md", "impl-plans/active/token-auth.md"],
  ["P4-DAEMON", "4", "Daemon lifecycle", "daemon mode", "Implement daemon lifecycle support.", ["P4-HTTP-SERVER", "P4-SSE"], "design-docs/specs/design-daemon-lifecycle.md", "impl-plans/active/daemon-lifecycle.md"],
  ["P4-PUBLIC-SDK", "4", "Public SDK facade", "public sdk", "Implement the public SDK facade.", ["P4-HTTP-SERVER"], "design-docs/specs/design-public-sdk.md", "impl-plans/active/public-sdk.md"],
  ["P5-COMPAT-BRIDGE", "5", "Optional compatibility bridge", "compatibility bridge", "Implement optional compatibility bridge helpers.", ["P4-HTTP-SERVER", "P4-PUBLIC-SDK"], "design-docs/specs/design-compat-bridge.md", "impl-plans/active/compat-bridge.md"],
  ["P5-TOOL-REGISTRY", "5", "Tool and model availability helpers", "tool registry", "Implement tool and model availability helpers.", ["P4-PUBLIC-SDK"], "design-docs/specs/design-tool-registry-model-helpers.md", "impl-plans/active/tool-registry-model-helpers.md"],
];

function asStringArray(value, fallback) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : fallback;
}

function completedFromSession() {
  const completed = new Set();
  if (workflowExecutionId === undefined) {
    return completed;
  }
  const sessionPath = join(".divedra", "artifacts", "sessions", `${workflowExecutionId}.json`);
  if (!existsSync(sessionPath)) {
    return completed;
  }
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  for (const execution of Array.isArray(session.nodeExecutions) ? session.nodeExecutions : []) {
    if (execution?.nodeId !== "step7-post-handoff" || execution?.status !== "succeeded") {
      continue;
    }
    const outputFile = join(execution.artifactDir, "output.json");
    if (!existsSync(outputFile)) {
      continue;
    }
    const payload = JSON.parse(readFileSync(outputFile, "utf8"))?.payload ?? {};
    if (typeof payload.completedItemId === "string") {
      completed.add(payload.completedItemId);
    }
  }
  return completed;
}

function completedFromPlan(itemId, planPath) {
  if (!existsSync(planPath)) {
    return false;
  }
  const text = readFileSync(planPath, "utf8");
  return text.includes(itemId) && /\*\*Status\*\*:\s*Completed/i.test(text);
}

function listCompletedPlanText() {
  if (!existsSync("impl-plans/completed")) {
    return [];
  }
  return readdirSync("impl-plans/completed")
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(join("impl-plans/completed", name), "utf8"));
}

const targetPhases = asStringArray(runtime.targetPhases ?? runtime?.workflowInput?.targetPhases, ["2", "3", "4", "5"]);
const maxItemsPerRun = Number(runtime.maxItemsPerRun ?? runtime?.workflowInput?.maxItemsPerRun ?? 999);
const completedRunItems = completedFromSession();
const completedPlanTexts = listCompletedPlanText();

const completedIds = new Set();
for (const [id, , , , , , , planPath] of items) {
  if (
    completedRunItems.has(id) ||
    completedFromPlan(id, planPath) ||
    completedPlanTexts.some((text) => text.includes(id))
  ) {
    completedIds.add(id);
  }
}

const backlogItems = items
  .filter(([, phase]) => targetPhases.includes(phase))
  .map(([id, phase, title, targetFeatureArea, requestedBehavior, dependencyIds, preferredDesignDocPath, preferredImplPlanPath]) => {
    const dependencyState = {
      satisfied: dependencyIds.filter((dependencyId) => completedIds.has(dependencyId)),
      unsatisfied: dependencyIds.filter((dependencyId) => !completedIds.has(dependencyId)),
    };
    const planExists = existsSync(preferredImplPlanPath);
    const completed = completedIds.has(id);
    const status = completed
      ? "completed"
      : !planExists
        ? "blocked"
        : dependencyState.unsatisfied.length > 0
          ? "blocked"
          : "ready";
    return {
      id,
      phase,
      title,
      targetFeatureArea,
      requestedBehavior,
      dependencyIds,
      preferredDesignDocPath,
      preferredImplPlanPath,
      sourceReferences: [
        "design-docs/specs/design-parity-backlog-workflow.md",
        "design-docs/specs/design-codex-agent-parity-gap.md",
        preferredDesignDocPath,
        preferredImplPlanPath,
      ],
      status,
      blockingReason: completed
        ? null
        : !planExists
          ? `Missing implementation plan ${preferredImplPlanPath}`
          : dependencyState.unsatisfied.length > 0
            ? `Waiting on ${dependencyState.unsatisfied.join(", ")}`
            : null,
      dependencyState,
      delegatedWorkflowInput: {
        workflowId: "design-and-implement-review-loop",
        executionMode: "issue-resolution",
        issueReference: `parity-global-design-plan-implement-loop#${id}`,
        issueTitle: `Implement ${id}: ${title}`,
        targetFeatureArea,
        requestedBehavior,
        preferredDesignDocPath,
        preferredImplPlanPath,
        reviewContext: {
          backlogItem: id,
          remainingDependencies: dependencyState.unsatisfied,
          sourceReferences: [
            "design-docs/specs/design-parity-backlog-workflow.md",
            "design-docs/specs/design-codex-agent-parity-gap.md",
            preferredDesignDocPath,
            preferredImplPlanPath,
          ],
        },
      },
    };
  });

const readyItems = backlogItems.filter((item) => item.status === "ready");
const blockedItems = backlogItems.filter((item) => item.status === "blocked");
const completedItems = backlogItems.filter((item) => item.status === "completed");
const processedItemsThisRun = completedRunItems.size;
const runLimitReached = processedItemsThisRun >= maxItemsPerRun;
const nextItem = runLimitReached ? null : (readyItems[0] ?? null);
const needsItem = nextItem !== null;

const payload = {
  needs_item: needsItem,
  decision: needsItem ? "delegate" : "exit",
  nextItem,
  selectedBacklogItem: nextItem,
  processedItemsThisRun,
  completedItemsThisRun: Array.from(completedRunItems),
  completedItems,
  readyItems,
  blockedItems,
  remainingReadyCount: readyItems.length,
  exitReason: needsItem
    ? null
    : runLimitReached
      ? "Configured maxItemsPerRun reached."
      : "No ready implementation plan remains.",
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
