import type { AgentEvent } from "../types/agent-event";
import type { CursorAgentRunResult, CursorAgentSdk, CursorRunningAgent } from "./types";
export interface MockCursorRunningAgentOptions {
    readonly sessionId: string;
    readonly events?: readonly AgentEvent[];
    readonly result?: CursorAgentRunResult;
    readonly autoComplete?: boolean;
}
export declare function createMockAgentEventStream(events?: readonly AgentEvent[]): AsyncGenerator<AgentEvent, void, undefined>;
export declare function createMockCursorRunningAgent(options: MockCursorRunningAgentOptions): CursorRunningAgent;
export declare function createMockCursorAgentSdk(input?: Partial<CursorAgentSdk>): CursorAgentSdk;
//# sourceMappingURL=testing.d.ts.map