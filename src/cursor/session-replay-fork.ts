import { randomUUID } from "node:crypto";

import type { ReplayForkStore } from "../persistence/session-replay-forks-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import { sessionIdFromEvent, type AgentEvent } from "../types/agent-event";
import type {
  ReplayForkBoundary,
  ReplayForkPlan,
  ReplayForkProvenance,
  ReplayForkRequest,
  ReplayForkResult,
} from "../types/session-replay-fork";
import {
  isTrustFailureMessage,
  runHeadlessStreaming,
  type HeadlessRunOptions,
} from "./process-runner";
import {
  REPLAY_FORK_LIMITATIONS,
  buildReplayForkPrompt,
} from "./replay-prompt";
import {
  scanReplayableTranscriptRows,
  sliceReplayableRowsForFork,
  type ReplaySliceErrorCode,
} from "./session-replay-slice";
import { StreamNormalizerState } from "./stream-normalizer";

export class SessionReplayForkError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "transcript_unavailable"
      | "slice_error"
      | "cursor_failed"
      | "trust_required",
    message: string,
    readonly sliceCode?: ReplaySliceErrorCode,
  ) {
    super(message);
    this.name = "SessionReplayForkError";
  }
}

export interface SessionReplayForkServiceDeps {
  readonly sessions: SessionIndexRepository;
  readonly store: ReplayForkStore;
  readonly runHeadless?: typeof runHeadlessStreaming;
  readonly now?: () => Date;
  readonly onNormalizedEvents?: (events: readonly AgentEvent[]) => void;
}

function sliceErrorMessage(code: ReplaySliceErrorCode): string {
  switch (code) {
    case "empty_slice":
      return "replay slice is empty";
    case "boundary_not_found":
      return "fork boundary message id not found in transcript";
    case "invalid_nth":
      return "fork --nth-message is out of range for replayable messages";
    case "conflicting_boundary":
      return "conflicting fork boundary selectors";
    default: {
      const _e: never = code;
      return _e;
    }
  }
}

function buildForkPoint(
  slice: readonly {
    messageId: string;
    eventOffset: number;
    role: "user" | "assistant";
  }[],
  request: ReplayForkRequest,
): ReplayForkBoundary {
  const last = slice[slice.length - 1];
  if (last === undefined) {
    throw new SessionReplayForkError("slice_error", "empty replay slice");
  }
  return {
    ...(request.throughMessageId !== undefined
      ? { messageId: request.throughMessageId }
      : {}),
    ...(request.nthMessage !== undefined
      ? { nthMessage: request.nthMessage }
      : {}),
    ...(request.throughMessageId === undefined &&
    request.nthMessage === undefined
      ? { nthMessage: slice.length }
      : {}),
    eventOffset: last.eventOffset,
    role: last.role,
    inclusive: true,
  };
}

function buildReplayPlan(
  sliceLen: number,
  omittedNonReplayable: number,
  omittedReplayableTail: number,
  promptPreview: string,
): ReplayForkPlan {
  const omittedMessageCount = omittedNonReplayable + omittedReplayableTail;
  return {
    messageCount: sliceLen,
    omittedMessageCount,
    truncated: omittedNonReplayable > 0 || omittedReplayableTail > 0,
    promptPreview,
  };
}

export async function executeSessionReplayFork(
  request: ReplayForkRequest,
  headlessBase: Omit<HeadlessRunOptions, "prompt">,
  deps: SessionReplayForkServiceDeps,
): Promise<ReplayForkResult> {
  const run = deps.runHeadless ?? runHeadlessStreaming;
  const now = deps.now ?? (() => new Date());
  const repo = deps.sessions;

  const source = repo.resolveSessionKey(request.sourceSessionId);
  if (source === undefined) {
    throw new SessionReplayForkError("not_found", "session not found");
  }

  if (
    source.identityState === "chat_only" ||
    source.transcriptPath === undefined
  ) {
    throw new SessionReplayForkError(
      "transcript_unavailable",
      "source session has no materialized transcript to replay",
    );
  }

  const scan = await scanReplayableTranscriptRows(source.transcriptPath);
  const boundary =
    request.throughMessageId !== undefined
      ? { throughMessageId: request.throughMessageId }
      : request.nthMessage !== undefined
        ? { nthMessage: request.nthMessage }
        : undefined;
  const sliced = sliceReplayableRowsForFork(scan, boundary);
  if ("error" in sliced) {
    throw new SessionReplayForkError(
      "slice_error",
      sliceErrorMessage(sliced.error),
      sliced.error,
    );
  }

  const { fullPrompt, promptPreview, promptHash } = buildReplayForkPrompt(
    source,
    sliced.slice,
    request.continuationPrompt,
    {
      omittedNonReplayableCount: sliced.omittedNonReplayableCount,
      omittedReplayableTailCount: sliced.omittedReplayableTailCount,
    },
  );

  const forkPoint = buildForkPoint(sliced.slice, request);
  const replay = buildReplayPlan(
    sliced.slice.length,
    sliced.omittedNonReplayableCount,
    sliced.omittedReplayableTailCount,
    promptPreview,
  );

  const warnings: string[] = [];
  if (sliced.omittedNonReplayableCount > 0) {
    warnings.push(
      `Omitted ${sliced.omittedNonReplayableCount} non-replayable transcript row(s).`,
    );
  }
  if (sliced.omittedReplayableTailCount > 0) {
    warnings.push(
      `Excluded ${sliced.omittedReplayableTailCount} replayable message(s) after the fork boundary.`,
    );
  }

  const replayForkId = randomUUID();
  const createdAt = now().toISOString();
  let provenance: ReplayForkProvenance = {
    replayForkId,
    sourceRecordId: source.recordId,
    ...(source.localSessionId !== undefined
      ? { sourceLocalSessionId: source.localSessionId }
      : {}),
    ...(source.cursorChatId !== undefined
      ? { sourceCursorChatId: source.cursorChatId }
      : {}),
    promptHash,
    createdAt,
    semantics: "replay_not_native_fork",
  };

  const limitations = [...REPLAY_FORK_LIMITATIONS];

  if (request.dryRun) {
    return {
      mode: "best_effort_replay",
      sourceSession: source,
      forkPoint,
      replay,
      provenance,
      limitations,
      warnings,
    };
  }

  const norm = new StreamNormalizerState();
  let lastStreamSessionId: string | undefined;
  const exit = await run({ ...headlessBase, prompt: fullPrompt }, (line) => {
    for (const event of norm.processLine(line)) {
      deps.onNormalizedEvents?.([event]);
      const sid = sessionIdFromEvent(event);
      if (sid !== undefined) {
        lastStreamSessionId = sid;
      }
    }
  });

  if (isTrustFailureMessage(exit.stderr)) {
    throw new SessionReplayForkError(
      "trust_required",
      exit.stderr.trim().length > 0
        ? exit.stderr.trim()
        : "cursor-agent trust approval required",
    );
  }

  if (exit.code !== 0 && exit.code !== null) {
    throw new SessionReplayForkError(
      "cursor_failed",
      exit.stderr.trim().length > 0
        ? exit.stderr.trim()
        : `cursor-agent exited with code ${exit.code}`,
    );
  }

  let newRecord: ReturnType<typeof repo.resolveSessionKey> | undefined;
  try {
    await repo.importTranscriptsFromFilesystem();
    const newSid = lastStreamSessionId;
    newRecord =
      newSid !== undefined ? repo.resolveSessionKey(newSid) : undefined;

    provenance = {
      ...provenance,
      ...(newRecord?.recordId !== undefined
        ? { newRecordId: newRecord.recordId }
        : {}),
      ...(newRecord?.localSessionId !== undefined
        ? { newLocalSessionId: newRecord.localSessionId }
        : {}),
    };

    if (newRecord?.recordId === undefined) {
      warnings.push(
        "Could not link a new session record after replay run; provenance may lack new session ids.",
      );
    }
  } catch {
    warnings.push(
      "Failed to import transcripts after replay run; provenance may lack new session ids.",
    );
  }

  await deps.store.record(provenance);

  return {
    mode: "best_effort_replay",
    sourceSession: source,
    forkPoint,
    replay,
    ...(newRecord !== undefined ? { newSession: newRecord } : {}),
    provenance,
    limitations,
    warnings,
  };
}
