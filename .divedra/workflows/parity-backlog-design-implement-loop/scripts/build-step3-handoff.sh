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
const upstream =
  input?.upstream ??
  input?.executionMailbox?.input?.upstream ??
  [];
if (!Array.isArray(upstream) || upstream.length === 0) {
  throw new Error("step3-handoff requires at least one upstream payload");
}

const latestPayload = upstream[upstream.length - 1]?.output?.payload ?? {};
const selectionPayload =
  [...upstream]
    .reverse()
    .map((entry) => entry?.output?.payload ?? {})
    .find((payload) => {
      const candidate =
        payload.nextItem ??
        payload.backlogItem ??
        payload.selectedBacklogItem ??
        null;
      return candidate !== null && typeof candidate === "object";
    }) ?? {};
const nextItem =
  selectionPayload.nextItem ??
  selectionPayload.backlogItem ??
  selectionPayload.selectedBacklogItem ??
  null;

if (nextItem === null || typeof nextItem !== "object") {
  throw new Error("step3-handoff could not find nextItem in upstream payload");
}

const runtimeVariables =
  input?.runtimeVariables ??
  input?.variables ??
  {};
const defaultReferenceRoot = "/Users/taco/gits/tacogips/codex-agent";
const delegatedBase =
  latestPayload.delegatedWorkflowInput ??
  nextItem.delegatedWorkflowInput ??
  {};

const canonicalBacklogItemId =
  typeof nextItem.id === "string" ? nextItem.id : "UNKNOWN-BACKLOG-ITEM";
const title =
  typeof nextItem.title === "string" && nextItem.title.length > 0
    ? nextItem.title
    : canonicalBacklogItemId;
const targetFeatureArea =
  typeof delegatedBase.targetFeatureArea === "string" &&
  delegatedBase.targetFeatureArea.length > 0
    ? delegatedBase.targetFeatureArea
    : typeof nextItem.targetFeatureArea === "string" &&
        nextItem.targetFeatureArea.length > 0
      ? nextItem.targetFeatureArea
      : title;
const requestedBehavior =
  typeof delegatedBase.requestedBehavior === "string" &&
  delegatedBase.requestedBehavior.length > 0
    ? delegatedBase.requestedBehavior
    : typeof nextItem.requestedBehavior === "string" &&
        nextItem.requestedBehavior.length > 0
      ? nextItem.requestedBehavior
      : `Implement parity backlog item ${canonicalBacklogItemId}.`;

const referenceRepositoryRoot =
  typeof delegatedBase.referenceRepositoryRoot === "string" &&
  delegatedBase.referenceRepositoryRoot.length > 0
    ? delegatedBase.referenceRepositoryRoot
    : typeof runtimeVariables.referenceRepositoryRoot === "string" &&
        runtimeVariables.referenceRepositoryRoot.length > 0
      ? runtimeVariables.referenceRepositoryRoot
      : defaultReferenceRoot;

const defaultSourceReferences = [
  "design-docs/specs/design-parity-backlog-workflow.md",
  "design-docs/specs/design-codex-agent-parity-gap.md",
];

const delegatedReviewContext =
  delegatedBase.reviewContext &&
  typeof delegatedBase.reviewContext === "object" &&
  !Array.isArray(delegatedBase.reviewContext)
    ? delegatedBase.reviewContext
    : {};

const sourceReferences = Array.from(
  new Set(
    [
      ...(Array.isArray(nextItem.sourceReferences) ? nextItem.sourceReferences : []),
      ...(Array.isArray(delegatedReviewContext.sourceReferences)
        ? delegatedReviewContext.sourceReferences
        : []),
      ...defaultSourceReferences,
    ].filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
  ),
);

const dependencyIds = Array.isArray(nextItem.dependencyIds)
  ? nextItem.dependencyIds.filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
  : [];

const unsatisfiedDependencies = Array.isArray(nextItem?.dependencyState?.unsatisfied)
  ? nextItem.dependencyState.unsatisfied.filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
  : [];

const preferredDesignDocPath =
  typeof delegatedBase.preferredDesignDocPath === "string" &&
  delegatedBase.preferredDesignDocPath.length > 0
    ? delegatedBase.preferredDesignDocPath
    : canonicalBacklogItemId === "P2-SESSION-SEARCH"
      ? "design-docs/specs/design-session-search.md"
      : undefined;

const preferredImplPlanPath =
  typeof delegatedBase.preferredImplPlanPath === "string" &&
  delegatedBase.preferredImplPlanPath.length > 0
    ? delegatedBase.preferredImplPlanPath
    : canonicalBacklogItemId === "P2-SESSION-SEARCH"
      ? "impl-plans/active/session-search.md"
      : undefined;

if (
  preferredDesignDocPath !== undefined &&
  !sourceReferences.includes(preferredDesignDocPath)
) {
  sourceReferences.push(preferredDesignDocPath);
}

const defaultCodexAgentReferencesByItem = {
  "P2-SESSION-SEARCH": [
    "src/session/search.ts",
    "src/session/search.test.ts",
    "src/session/sqlite.ts",
    "src/session/index.ts",
    "src/types/session.ts",
    "src/server/handlers/sessions.ts",
    "design-docs/specs/design-codex-session-management.md",
    "impl-plans/completed/issue17-public-export-session-search.md",
  ],
  "P2-TRANSCRIPT-SEARCH": [
    "src/session/search.ts",
    "src/session/search.test.ts",
    "src/session/index.ts",
    "src/types/session.ts",
    "impl-plans/completed/issue16-transcript-search.md",
    "design-docs/specs/design-codex-session-management.md",
  ],
  "P2-BOOKMARKS": [
    "src/bookmark/index.ts",
    "src/bookmark/types.ts",
    "src/bookmark/repository.ts",
    "src/bookmark/manager.ts",
    "src/bookmark/manager.test.ts",
  ],
  "P2-ACTIVITY": [
    "src/activity/index.ts",
    "src/activity/types.ts",
    "src/activity/manager.ts",
    "src/activity/manager.test.ts",
    "src/session/index.ts",
  ],
  "P2-MARKDOWN-TASKS": [
    "src/markdown/index.ts",
    "src/markdown/types.ts",
    "src/markdown/parser.ts",
    "src/markdown/parser.test.ts",
  ],
  "P3-FILE-INTELLIGENCE": [
    "src/file-changes/index.ts",
    "src/file-changes/types.ts",
    "src/file-changes/extractor.ts",
    "src/file-changes/extractor.test.ts",
    "src/file-changes/service.ts",
    "src/file-changes/service.test.ts",
    "src/server/handlers/files.ts",
  ],
};

function qualifyReferencePath(referenceRoot, relativePath) {
  const normalizedRoot = referenceRoot.replace(/\/+$/, "");
  return `${normalizedRoot}/${relativePath}`;
}

function deriveCodexAgentReferences(backlogItemId, referenceRoot) {
  const mapped = defaultCodexAgentReferencesByItem[backlogItemId];
  if (Array.isArray(mapped) && mapped.length > 0) {
    return mapped.map((relativePath) =>
      qualifyReferencePath(referenceRoot, relativePath),
    );
  }
  return [
    qualifyReferencePath(referenceRoot, "src/session/index.ts"),
    qualifyReferencePath(referenceRoot, "src/session/sqlite.ts"),
    qualifyReferencePath(referenceRoot, "src/types/session.ts"),
    qualifyReferencePath(
      referenceRoot,
      "design-docs/specs/design-codex-session-management.md",
    ),
  ];
}

const codexAgentReferences = Array.isArray(delegatedBase.codexAgentReferences) &&
  delegatedBase.codexAgentReferences.length > 0
  ? delegatedBase.codexAgentReferences
  : deriveCodexAgentReferences(canonicalBacklogItemId, referenceRepositoryRoot);

const issueTitle =
  typeof delegatedBase.issueTitle === "string" && delegatedBase.issueTitle.length > 0
    ? delegatedBase.issueTitle
    : `Implement cursor-agent parity backlog item ${canonicalBacklogItemId}: ${title}`;

const issueReference =
  typeof delegatedBase.issueReference === "string" &&
  delegatedBase.issueReference.length > 0
    ? delegatedBase.issueReference
    : `parity-backlog-design-implement-loop#${canonicalBacklogItemId}`;

const issueBody =
  typeof delegatedBase.issueBody === "string" && delegatedBase.issueBody.length > 0
    ? delegatedBase.issueBody
    : `Implement the approved parity backlog slice for ${targetFeatureArea}. Update design docs and implementation plans when the repository does not already have an aligned pair for this slice, then implement the accepted behavior, verify it, and complete the delegated commit and push flow.`;

const childReviewContext = {
  canonicalBacklogItemId,
  dependencyIds,
  dependencyState: unsatisfiedDependencies.length === 0 ? "ready" : "blocked",
  unmetDependencyIds: unsatisfiedDependencies,
  sourceReferences,
  parentReviewFeedback:
    latestPayload.needs_revision === true
      ? {
          findings: Array.isArray(latestPayload.findings)
            ? latestPayload.findings
            : [],
          feedback: Array.isArray(latestPayload.feedback)
            ? latestPayload.feedback
            : [],
        }
      : null,
};

const workflowInput = {
  workflowId: "design-and-implement-review-loop",
  executionMode:
    typeof delegatedBase.executionMode === "string" &&
    delegatedBase.executionMode.length > 0
      ? delegatedBase.executionMode
      : "issue-resolution",
  issueReference,
  issueTitle,
  issueBody,
  targetFeatureArea,
  requestedBehavior,
  referenceRepositoryRoot,
  ...(preferredDesignDocPath === undefined
    ? {}
    : { preferredDesignDocPath }),
  ...(preferredImplPlanPath === undefined ? {} : { preferredImplPlanPath }),
  codexAgentReferences,
  reviewContext: childReviewContext,
  fullImplementationRequested: true,
};

const backlogItem = {
  ...nextItem,
  targetFeatureArea,
  requestedBehavior,
  dependencyIds,
  ...(Array.isArray(nextItem.sourceReferences) ? {} : { sourceReferences }),
};

const reviewContext = {
  backlogItem: {
    id: canonicalBacklogItemId,
    phase: nextItem.phase ?? null,
    title,
  },
  dependencyContext: {
    dependencyIds,
    remainingDependencies: unsatisfiedDependencies,
    unmetDependencyIds: unsatisfiedDependencies,
    state: unsatisfiedDependencies.length === 0 ? "ready" : "blocked",
  },
  changedFiles: [],
  verification: {
    localHandoffChecks: [
      preferredDesignDocPath === undefined
        ? "No explicit preferred design doc path was required for this backlog item."
        : `Preferred design doc path: ${preferredDesignDocPath}`,
      preferredImplPlanPath === undefined
        ? "No explicit preferred implementation plan path was required for this backlog item."
        : `Preferred implementation plan path: ${preferredImplPlanPath}`,
      "Delegated workflow input was prepared deterministically from Step 2 output.",
    ],
    delegatedVerificationRequested: ["task test", "task typecheck"],
  },
  exitReasons: [
    "Prepared one delegated issue-resolution request.",
    "No local implementation performed in step3-handoff.",
  ],
};

const handoffSummary = {
  decision: "delegate",
  delegatedWorkflowId: "design-and-implement-review-loop",
  selectedBacklogItemId: canonicalBacklogItemId,
  scope: "exactly one backlog item",
  changedFiles: [],
  exitReason: "Handoff prepared deterministically from Step 2 output.",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      workflowInput,
      backlogItem,
      reviewContext,
      handoffSummary,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
' "$input_path" "$output_path"
