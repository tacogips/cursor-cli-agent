import type { AgentEvent } from "../types/agent-event";
import type { ActivitySignal } from "../types/activity";
export interface ActivitySignalClassifier {
    classifyStreamEvent(event: AgentEvent): ActivitySignal | null;
    classifyProcessResult(exitCode: number | null, stderr?: string, stdout?: string): ActivitySignal | null;
}
export declare function classifyTextSignal(text: string, source: "stderr" | "stdout"): ActivitySignal | null;
export declare function createActivitySignalClassifier(): ActivitySignalClassifier;
//# sourceMappingURL=activity-signals.d.ts.map