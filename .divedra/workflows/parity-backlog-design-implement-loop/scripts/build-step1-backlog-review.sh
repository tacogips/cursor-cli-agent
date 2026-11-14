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

const canonical = [
  ["P2-SESSION-SEARCH", "2", "Session metadata search", "session metadata search", "Implement metadata search across indexed Cursor sessions.", []],
  ["P2-TRANSCRIPT-SEARCH", "2", "Transcript full-text search", "transcript full-text search", "Implement transcript full-text search for indexed Cursor sessions.", ["P2-SESSION-SEARCH"]],
  ["P2-BOOKMARKS", "2", "Bookmark lifecycle", "bookmarks", "Implement bookmark create, list, update, and delete support.", ["P2-TRANSCRIPT-SEARCH"]],
  ["P2-ACTIVITY", "2", "Activity derivation", "activity tracking", "Implement activity derivation from indexed Cursor session state.", []],
  ["P2-MARKDOWN-TASKS", "2", "Markdown and task extraction", "markdown task extraction", "Implement markdown task extraction from Cursor session content.", ["P2-TRANSCRIPT-SEARCH"]],
  ["P3-GROUP-LIFECYCLE", "3", "Advanced group controls", "advanced group lifecycle", "Implement advanced group lifecycle controls.", ["P2-ACTIVITY"]],
  ["P3-QUEUE-LIFECYCLE", "3", "Advanced queue controls", "advanced queue lifecycle", "Implement advanced queue lifecycle controls.", ["P2-ACTIVITY"]],
  ["P3-FILE-INTELLIGENCE", "3", "File intelligence", "file intelligence", "Implement file intelligence derived from Cursor sessions.", ["P2-SESSION-SEARCH"]],
  ["P3-REPO-ANALYTICS", "3", "Commit and repository analytics", "repository analytics", "Implement commit and repository analytics.", ["P3-FILE-INTELLIGENCE"]],
  ["P4-HTTP-SERVER", "4", "REST server surface", "http server", "Implement the REST server surface.", ["P2-BOOKMARKS", "P3-GROUP-LIFECYCLE", "P3-QUEUE-LIFECYCLE", "P3-FILE-INTELLIGENCE"]],
  ["P4-SSE", "4", "Live event streaming", "server event streaming", "Implement live server event streaming.", ["P4-HTTP-SERVER", "P2-ACTIVITY"]],
  ["P4-AUTH", "4", "Token and bearer auth", "server auth", "Implement token and bearer authentication.", ["P4-HTTP-SERVER"]],
  ["P4-DAEMON", "4", "Daemon lifecycle", "daemon mode", "Implement daemon lifecycle support.", ["P4-HTTP-SERVER", "P4-SSE"]],
  ["P4-PUBLIC-SDK", "4", "Public SDK facade", "public sdk", "Implement the public SDK facade.", ["P4-HTTP-SERVER"]],
  ["P5-COMPAT-BRIDGE", "5", "Optional compatibility bridge", "compatibility bridge", "Implement optional compatibility bridge helpers.", ["P4-HTTP-SERVER", "P4-PUBLIC-SDK"]],
  ["P5-TOOL-REGISTRY", "5", "Tool and model availability helpers", "tool registry", "Implement tool and model availability helpers.", ["P4-PUBLIC-SDK"]],
];

const preferredPaths = {
  "P2-SESSION-SEARCH": ["design-docs/specs/design-session-search.md", "impl-plans/active/session-search.md"],
  "P2-TRANSCRIPT-SEARCH": ["design-docs/specs/design-transcript-search.md", "impl-plans/active/transcript-search.md"],
  "P2-BOOKMARKS": ["design-docs/specs/design-bookmarks.md", "impl-plans/active/bookmarks.md"],
  "P2-ACTIVITY": ["design-docs/specs/design-activity.md", "impl-plans/active/activity.md"],
  "P2-MARKDOWN-TASKS": ["design-docs/specs/design-markdown-tasks.md", "impl-plans/active/markdown-tasks.md"],
  "P3-GROUP-LIFECYCLE": ["design-docs/specs/design-group-lifecycle.md", "impl-plans/completed/group-lifecycle.md"],
  "P3-FILE-INTELLIGENCE": ["design-docs/specs/design-file-intelligence.md", "impl-plans/completed/file-intelligence.md"],
  "P4-HTTP-SERVER": ["design-docs/specs/design-http-server-core.md", "impl-plans/completed/http-server-core.md"],
  "P4-AUTH": ["design-docs/specs/design-token-auth.md", "impl-plans/completed/token-auth.md"],
  "P4-DAEMON": ["design-docs/specs/design-daemon-lifecycle.md", "impl-plans/completed/daemon-lifecycle.md"],
};

function asStringArray(value, fallback) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : fallback;
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function listMarkdownFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(path, name));
}

const targetPhases = asStringArray(runtime.targetPhases ?? runtime?.workflowInput?.targetPhases, ["2", "3", "4", "5"]);
const maxItemsPerRun = Number(runtime.maxItemsPerRun ?? runtime?.workflowInput?.maxItemsPerRun ?? 999);
const includePartialCapabilities = runtime.includePartialCapabilities ?? runtime?.workflowInput?.includePartialCapabilities ?? true;

const sessionPath = workflowExecutionId === undefined ? undefined : join(".divedra", "artifacts", "sessions", `${workflowExecutionId}.json`);
const session = sessionPath !== undefined && existsSync(sessionPath)
  ? JSON.parse(readFileSync(sessionPath, "utf8"))
  : {};

const completedThisRun = new Set();
for (const execution of Array.isArray(session.nodeExecutions) ? session.nodeExecutions : []) {
  if (execution?.nodeId !== "step4-post-handoff" || execution?.status !== "succeeded") {
    continue;
  }
  const outputFile = join(execution.artifactDir, "output.json");
  if (!existsSync(outputFile)) {
    continue;
  }
  const payload = JSON.parse(readFileSync(outputFile, "utf8"))?.payload ?? {};
  if (typeof payload.completedItemId === "string") {
    completedThisRun.add(payload.completedItemId);
  }
}

const completedPlanTexts = listMarkdownFiles("impl-plans/completed").map(readTextIfExists);
const activePlanEntries = listMarkdownFiles("impl-plans/active").map((path) => ({
  path,
  text: readTextIfExists(path),
}));

function hasCompletedEvidence(id) {
  return completedThisRun.has(id) || completedPlanTexts.some((text) => text.includes(id));
}

function matchingActivePlans(id, title, targetFeatureArea) {
  const needles = [id, title, targetFeatureArea].map((value) => value.toLowerCase());
  return activePlanEntries
    .filter((entry) => {
      const text = entry.text.toLowerCase();
      return needles.some((needle) => needle.length > 0 && text.includes(needle));
    })
    .map((entry) => entry.path);
}

const completedIds = new Set(canonical.filter(([id]) => hasCompletedEvidence(id)).map(([id]) => id));
const backlogItems = [];

for (const [id, phase, title, targetFeatureArea, requestedBehavior, dependencyIds] of canonical) {
  const sourceReferences = [
    "design-docs/specs/design-parity-backlog-workflow.md",
    "design-docs/specs/design-codex-agent-parity-gap.md",
    ...matchingActivePlans(id, title, targetFeatureArea),
  ];
  const [preferredDesignDocPath, preferredImplPlanPath] = preferredPaths[id] ?? [];
  if (preferredDesignDocPath !== undefined) {
    sourceReferences.push(preferredDesignDocPath);
  }
  if (preferredImplPlanPath !== undefined) {
    sourceReferences.push(preferredImplPlanPath);
  }

  const filtered = !targetPhases.includes(phase);
  const unmetDependencyIds = dependencyIds.filter((dependencyId) => !completedIds.has(dependencyId));
  const completed = completedIds.has(id);
  const status = filtered
    ? "filtered"
    : completed
      ? "completed"
      : unmetDependencyIds.length > 0
        ? "blocked"
        : "ready";

  backlogItems.push({
    id,
    phase,
    title,
    targetFeatureArea,
    requestedBehavior,
    dependencyIds,
    sourceReferences: Array.from(new Set(sourceReferences)),
    status,
    blockingReason: unmetDependencyIds.length > 0 ? `Waiting on ${unmetDependencyIds.join(", ")}` : null,
    dependencyState: {
      satisfied: dependencyIds.filter((dependencyId) => completedIds.has(dependencyId)),
      unsatisfied: unmetDependencyIds,
    },
    delegatedWorkflowInput: {
      workflowId: "design-and-implement-review-loop",
      executionMode: "issue-resolution",
      issueTitle: `Implement ${id}: ${title}`,
      targetFeatureArea,
      requestedBehavior,
      ...(preferredDesignDocPath === undefined ? {} : { preferredDesignDocPath }),
      ...(preferredImplPlanPath === undefined ? {} : { preferredImplPlanPath }),
      reviewContext: {
        backlogItem: id,
        remainingDependencies: unmetDependencyIds,
        sourceReferences: Array.from(new Set(sourceReferences)),
      },
    },
  });
}

const completedItems = backlogItems.filter((item) => item.status === "completed");
const blockedItems = backlogItems.filter((item) => item.status === "blocked");
const readyItems = backlogItems.filter((item) => item.status === "ready");
const processedItemsThisRun = completedThisRun.size;
const runLimitReached = processedItemsThisRun >= maxItemsPerRun;

const output = {
  backlogSourceDoc: String(runtime.backlogSourceDoc ?? runtime?.workflowInput?.backlogSourceDoc ?? "design-docs/specs/design-parity-backlog-workflow.md"),
  targetPhases,
  maxItemsPerRun,
  includePartialCapabilities,
  backlogItems,
  completedItems,
  blockedItems,
  readyItems,
  nextItem: runLimitReached ? null : (readyItems[0] ?? null),
  processedItemsThisRun,
  completedItemsThisRun: Array.from(completedThisRun),
  runLimitReached,
  selectionNotes: [
    "Backlog selection was computed deterministically by command node.",
    "Aligned active plans are treated as implementation input, not blockers.",
  ],
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
' "$input_path" "$output_path"
