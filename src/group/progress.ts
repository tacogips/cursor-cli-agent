import type { SessionActivity } from "../types/activity";
import type {
  GroupProgressSnapshot,
  GroupProgressTotals,
  GroupRecord,
  GroupRunRecord,
  GroupRunWorkspaceRecord,
  GroupRunWorkspaceStatus,
} from "../types/group";

export interface GroupProgressDependencies {
  readonly getActivity: (sessionId: string) => Promise<SessionActivity | null>;
  readonly now: () => string;
}

const EMPTY_TOTALS: GroupProgressTotals = {
  pending: 0,
  running: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  unknown: 0,
};

function activityStatusToWorkspaceStatus(
  activity: SessionActivity | null,
  persisted: GroupRunWorkspaceStatus,
): GroupRunWorkspaceStatus {
  if (activity === null) {
    return persisted;
  }
  switch (activity.status) {
    case "running":
      return "running";
    case "waiting_trust":
    case "waiting_input":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return persisted === "pending" ? "unknown" : persisted;
  }
}

function workspaceSessionId(
  workspace: GroupRunWorkspaceRecord,
): string | undefined {
  return workspace.localSessionId ?? workspace.cursorChatId;
}

function countTotals(
  workspaces: readonly GroupRunWorkspaceRecord[],
): GroupProgressTotals {
  const totals: GroupProgressTotals = { ...EMPTY_TOTALS };
  for (const workspace of workspaces) {
    totals[workspace.status] += 1;
  }
  return totals;
}

async function deriveWorkspace(
  workspace: GroupRunWorkspaceRecord,
  deps: GroupProgressDependencies,
): Promise<GroupRunWorkspaceRecord> {
  const sessionId = workspaceSessionId(workspace);
  const activity =
    sessionId !== undefined ? await deps.getActivity(sessionId) : null;
  const status = activityStatusToWorkspaceStatus(activity, workspace.status);
  return {
    ...workspace,
    status,
    updatedAt: activity?.updatedAt ?? workspace.updatedAt,
  };
}

export async function deriveGroupProgressSnapshot(
  group: GroupRecord,
  deps: GroupProgressDependencies,
): Promise<GroupProgressSnapshot> {
  const run = group.lastRun;
  if (run === undefined) {
    return {
      group,
      totals: { ...EMPTY_TOTALS },
      provenance: "group-store+activity",
      updatedAt: deps.now(),
    };
  }

  const workspaces = await Promise.all(
    run.workspaces.map((workspace) => deriveWorkspace(workspace, deps)),
  );
  const derivedRun: GroupRunRecord = {
    ...run,
    workspaces,
    updatedAt:
      workspaces
        .map((workspace) => workspace.updatedAt)
        .sort()
        .at(-1) ?? run.updatedAt,
  };
  return {
    group: {
      ...group,
      lastRun: derivedRun,
    },
    run: derivedRun,
    totals: countTotals(workspaces),
    provenance: "group-store+activity",
    updatedAt: derivedRun.updatedAt,
  };
}
