import { type UsageEventStore } from "../persistence/usage-event-store";
import type { SessionIndexRepository } from "../persistence/session-index";
import { sessionIdFromEvent, type AgentEvent } from "../types/agent-event";
export { sessionIdFromEvent };
export interface UsagePersistenceChainOptions {
    readonly store?: UsageEventStore;
    /** Optional diagnostic hook; persistence failures are always non-fatal. */
    readonly onPersistError?: (error: unknown) => void;
}
export interface UsagePersistenceChain {
    readonly capture: (events: readonly AgentEvent[], fallbackSessionId?: string) => void;
    readonly flush: () => Promise<void>;
}
/** Ordered, non-fatal persistence of usage rows for wrapper-started runs. */
export declare function createUsagePersistenceChain(repo: SessionIndexRepository, options?: UsagePersistenceChainOptions): UsagePersistenceChain;
//# sourceMappingURL=usage-persistence-chain.d.ts.map