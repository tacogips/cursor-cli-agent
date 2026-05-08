import { createUsageEventExtractor } from "../cursor/usage-events";
import {
  createUsageEventStore,
  type UsageEventStore,
} from "../persistence/usage-event-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import { sessionIdFromEvent, type AgentEvent } from "../types/agent-event";
import type { UsageEventRecord } from "../types/usage-event";

export { sessionIdFromEvent };

export interface UsagePersistenceChainOptions {
  readonly store?: UsageEventStore;
  /** Optional diagnostic hook; persistence failures are always non-fatal. */
  readonly onPersistError?: (error: unknown) => void;
}

export interface UsagePersistenceChain {
  readonly capture: (
    events: readonly AgentEvent[],
    fallbackSessionId?: string,
  ) => void;
  readonly flush: () => Promise<void>;
}

/** Ordered, non-fatal persistence of usage rows for wrapper-started runs. */
export function createUsagePersistenceChain(
  repo: SessionIndexRepository,
  options?: UsagePersistenceChainOptions,
): UsagePersistenceChain {
  const store = options?.store ?? createUsageEventStore();
  const onPersistError = options?.onPersistError;
  const extractor = createUsageEventExtractor();
  const streamModels = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();

  const capture = (
    events: readonly AgentEvent[],
    fallbackSessionId?: string,
  ): void => {
    const observedAt = new Date().toISOString();
    for (const event of events) {
      if (event.type === "session.started" && event.model !== undefined) {
        streamModels.set(event.sessionId, event.model);
      }
    }
    const pendingRows: UsageEventRecord[] = [];
    for (const event of events) {
      if (event.type !== "session.completed") {
        continue;
      }
      const sid = sessionIdFromEvent(event) ?? fallbackSessionId;
      if (sid === undefined) {
        continue;
      }
      const rec = repo.resolveSessionKey(sid);
      const streamModel = streamModels.get(sid);
      const row = extractor.fromAgentEvent(event, {
        sessionId: sid,
        observedAt,
        ...(rec?.recordId !== undefined ? { recordId: rec.recordId } : {}),
        ...(rec?.cursorChatId !== undefined
          ? { cursorChatId: rec.cursorChatId }
          : {}),
        ...(rec?.workspacePath !== undefined
          ? { workspacePath: rec.workspacePath }
          : {}),
        ...(rec?.workspaceSlug !== undefined
          ? { workspaceSlug: rec.workspaceSlug }
          : {}),
        ...(streamModel !== undefined
          ? { model: streamModel }
          : rec?.model !== undefined
            ? { model: rec.model }
            : {}),
      });
      if (row === null) {
        streamModels.delete(sid);
        continue;
      }
      pendingRows.push(row);
      streamModels.delete(sid);
    }
    if (pendingRows.length > 0) {
      chain = chain.then(() =>
        store.upsertEvents(pendingRows).catch((error: unknown) => {
          try {
            onPersistError?.(error);
          } catch {
            // Diagnostic hooks must not override non-fatal persistence behavior.
          }
        }),
      );
    }
  };

  return {
    capture,
    flush: async (): Promise<void> => {
      // Serial queue: await the tail, then repeat if capture() extended chain meanwhile.
      for (;;) {
        const pending = chain;
        await pending;
        if (pending === chain) {
          break;
        }
      }
      streamModels.clear();
    },
  };
}
