import { type CursorAgentStreamingProcess, type CursorAgentEffort, type HeadlessRunOptions, type ResumeRunOptions } from "../cursor/process-runner";
import { type AgentEvent } from "../types/agent-event";
export type CursorAgentStreamMode = "event" | "normalized";
export type { CursorAgentEffort };
export interface CursorAgentRequest {
    readonly prompt?: string;
    readonly systemPrompt?: string;
    readonly sessionId?: string;
    readonly cwd?: string;
    readonly model?: string;
    readonly effort?: CursorAgentEffort;
    readonly mode?: "default" | "plan" | "ask";
    readonly streamMode?: CursorAgentStreamMode;
    readonly trust?: boolean;
    readonly force?: boolean;
    readonly yolo?: boolean;
    readonly sandbox?: "enabled" | "disabled";
    readonly approveMcps?: boolean;
}
export interface CursorAgentRunResult {
    readonly sessionId: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly events: readonly AgentEvent[];
}
export interface CursorRunningAgent {
    readonly sessionId: string;
    messages(): AsyncGenerator<AgentEvent, void, undefined>;
    waitForCompletion(): Promise<CursorAgentRunResult>;
    cancel(): Promise<void>;
    interrupt(): Promise<void>;
}
export interface AgentRunnerFacade {
    start(request: CursorAgentRequest): CursorRunningAgent;
    resume(request: CursorAgentRequest & {
        readonly sessionId: string;
    }): CursorRunningAgent;
}
type HeadlessStarter = (opts: HeadlessRunOptions, onLine: (line: string) => void) => CursorAgentStreamingProcess;
type ResumeStarter = (opts: ResumeRunOptions, onLine: (line: string) => void) => CursorAgentStreamingProcess;
interface AgentRunnerFactoryOptions {
    readonly cursorBinary?: string;
    readonly startHeadless?: HeadlessStarter;
    readonly startResume?: ResumeStarter;
}
export declare function createAgentRunnerFacade(options?: AgentRunnerFactoryOptions): AgentRunnerFacade;
//# sourceMappingURL=agent-runner.d.ts.map