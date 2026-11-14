import type { AgentEvent } from "../types/agent-event";
export declare class StreamNormalizerState {
    private readonly lastAssistantBySession;
    private readonly partialAssistantTextBySession;
    /**
     * Convert one `stream-json` line into normalized events.
     */
    processLine(line: string): readonly AgentEvent[];
}
//# sourceMappingURL=stream-normalizer.d.ts.map