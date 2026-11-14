export type CompatOperationKind = "query" | "mutation" | "subscription";
export type CompatCommandStatus = "supported" | "degraded" | "unsupported";

export type CompatPermissionIntent =
  | "none"
  | "server:read"
  | "session:read"
  | "session:create"
  | "session:cancel"
  | "group:read"
  | "group:write"
  | "group:run"
  | "queue:read"
  | "queue:write"
  | "queue:run"
  | "bookmark:read"
  | "bookmark:write"
  | "files:read"
  | "files:write";

export interface CompatLimitation {
  readonly code: string;
  readonly message: string;
  readonly cursorSpecific: boolean;
}

export interface CompatCommandCapability {
  readonly name: string;
  readonly kinds: readonly CompatOperationKind[];
  readonly status: CompatCommandStatus;
  readonly permission?: CompatPermissionIntent;
  readonly limitations: readonly CompatLimitation[];
}

export interface CompatCommandDecision {
  readonly ok: boolean;
  readonly capability?: CompatCommandCapability;
  readonly reason?: string;
}

const SESSION_CANCEL_LIMITATION: CompatLimitation = {
  code: "cursor-process-supervision-pending",
  message:
    "Cursor process cancellation requires daemon/process-supervisor state and may not be available for imported sessions.",
  cursorSpecific: true,
};

const BEST_EFFORT_STREAM_LIMITATION: CompatLimitation = {
  code: "cursor-stream-best-effort",
  message:
    "Cursor-local streams are derived from local files or progress snapshots and are not durable server-side event streams.",
  cursorSpecific: true,
};

const FILE_INTELLIGENCE_LIMITATION: CompatLimitation = {
  code: "cursor-ai-tracking-sparse",
  message:
    "File intelligence depends on Cursor ai-tracking availability and may be sparse.",
  cursorSpecific: true,
};

const SKILL_DISCOVERY_LIMITATION: CompatLimitation = {
  code: "cursor-skills-discovery-only",
  message: "Cursor-managed skills are discoverable but must not be mutated.",
  cursorSpecific: true,
};

const NO_CURSOR_PATCH_HISTORY: CompatLimitation = {
  code: "cursor-no-patch-history",
  message:
    "Cursor has no confirmed local source equivalent to Codex patch history.",
  cursorSpecific: true,
};

const LOCAL_OPERATOR_ONLY: CompatLimitation = {
  code: "local-operator-only",
  message:
    "Token lifecycle commands are local operator commands and are not exposed through the compatibility bridge.",
  cursorSpecific: false,
};

const SESSION_FORK_UNPROVEN: CompatLimitation = {
  code: "cursor-session-fork-unproven",
  message:
    "Cursor-local replay or fork behavior is not proven for this bridge.",
  cursorSpecific: true,
};

const capabilities = [
  {
    name: "version.get",
    kinds: ["query"],
    status: "supported",
    permission: "none",
    limitations: [],
  },
  {
    name: "session.list",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "session.show",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "session.search",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "session.searchTranscript",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "session.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: [],
  },
  {
    name: "session.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: [],
  },
  {
    name: "session.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: [],
  },
  {
    name: "session.cancel",
    kinds: ["mutation"],
    status: "degraded",
    permission: "session:cancel",
    limitations: [SESSION_CANCEL_LIMITATION],
  },
  {
    name: "session.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "session:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION],
  },
  {
    name: "session.fork",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "session:create",
    limitations: [SESSION_FORK_UNPROVEN],
  },
  {
    name: "group.list",
    kinds: ["query"],
    status: "supported",
    permission: "group:read",
    limitations: [],
  },
  {
    name: "group.show",
    kinds: ["query"],
    status: "supported",
    permission: "group:read",
    limitations: [],
  },
  {
    name: "group.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.remove",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.pause",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: [],
  },
  {
    name: "group.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:run",
    limitations: [],
  },
  {
    name: "group.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "group:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION],
  },
  {
    name: "queue.list",
    kinds: ["query"],
    status: "supported",
    permission: "queue:read",
    limitations: [],
  },
  {
    name: "queue.show",
    kinds: ["query"],
    status: "supported",
    permission: "queue:read",
    limitations: [],
  },
  {
    name: "queue.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.update",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.remove",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.move",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.mode",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.pause",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: [],
  },
  {
    name: "queue.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:run",
    limitations: [],
  },
  {
    name: "queue.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "queue:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION],
  },
  {
    name: "bookmark.list",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: [],
  },
  {
    name: "bookmark.get",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: [],
  },
  {
    name: "bookmark.search",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: [],
  },
  {
    name: "bookmark.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "bookmark:write",
    limitations: [],
  },
  {
    name: "bookmark.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "bookmark:write",
    limitations: [],
  },
  {
    name: "files.list",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION],
  },
  {
    name: "files.find",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION],
  },
  {
    name: "files.snapshots",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION],
  },
  {
    name: "files.deleted",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION],
  },
  {
    name: "files.patches",
    kinds: ["query"],
    status: "unsupported",
    permission: "files:read",
    limitations: [NO_CURSOR_PATCH_HISTORY],
  },
  {
    name: "files.rebuild",
    kinds: ["mutation"],
    status: "supported",
    permission: "files:write",
    limitations: [],
  },
  {
    name: "activity.list",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "activity.show",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: [],
  },
  {
    name: "activity.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "session:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION],
  },
  {
    name: "skill.list",
    kinds: ["query"],
    status: "degraded",
    permission: "server:read",
    limitations: [SKILL_DISCOVERY_LIMITATION],
  },
  {
    name: "token.create",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY],
  },
  {
    name: "token.list",
    kinds: ["query"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY],
  },
  {
    name: "token.revoke",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY],
  },
  {
    name: "token.rotate",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY],
  },
] as const satisfies readonly CompatCommandCapability[];

export const COMPAT_COMMAND_CAPABILITIES: readonly CompatCommandCapability[] =
  capabilities;

const CAPABILITY_BY_NAME: ReadonlyMap<string, CompatCommandCapability> =
  new Map(capabilities.map((capability) => [capability.name, capability]));

export function getCompatCommandCapability(
  name: string,
): CompatCommandCapability | undefined {
  return CAPABILITY_BY_NAME.get(name);
}

export function decideCompatCommand(
  name: string,
  kind: CompatOperationKind,
): CompatCommandDecision {
  const capability = getCompatCommandCapability(name);
  if (capability === undefined) {
    return { ok: false, reason: "unknown command" };
  }
  if (!capability.kinds.includes(kind)) {
    return {
      ok: false,
      capability,
      reason: `command ${name} does not support ${kind}`,
    };
  }
  if (capability.status === "unsupported") {
    return {
      ok: false,
      capability,
      reason: `command ${name} is unsupported in compatibility mode`,
    };
  }
  return { ok: true, capability };
}

export function preferredCompatOperationKind(
  name: string,
): CompatOperationKind | undefined {
  return getCompatCommandCapability(name)?.kinds[0];
}
