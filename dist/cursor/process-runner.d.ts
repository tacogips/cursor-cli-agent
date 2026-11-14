import { spawn as nodeSpawn } from "node:child_process";
type CursorAgentSpawn = typeof nodeSpawn;
export declare function setCursorAgentSpawnForTesting(spawn: CursorAgentSpawn): () => void;
export interface PromptImageArgv {
    readonly flag: string;
    readonly paths: readonly string[];
}
export interface HeadlessRunOptions {
    readonly workspace: string;
    readonly prompt: string;
    readonly systemPrompt?: string;
    readonly cursorBinary?: string;
    readonly model?: string;
    readonly effort?: CursorAgentEffort;
    readonly mode?: "default" | "plan" | "ask";
    readonly trust?: boolean;
    readonly force?: boolean;
    readonly yolo?: boolean;
    readonly streamPartialOutput?: boolean;
    /** Matches `cursor-agent --sandbox <enabled|disabled>`. */
    readonly sandbox?: "enabled" | "disabled";
    readonly approveMcps?: boolean;
    /** `true` emits `--worktree` with generated name; a string sets the worktree name. */
    readonly worktree?: true | string;
    readonly worktreeBase?: string;
    readonly skipWorktreeSetup?: boolean;
    /** Repeated `<flag> <path>` fragments appended before worktree passthrough tokens. */
    readonly promptImages?: PromptImageArgv;
    readonly cursorApiKey?: string;
    readonly cursorAuthToken?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
}
export type CursorAgentEffort = "low" | "medium" | "high" | "xhigh";
export type CursorAgentExit = {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
};
export interface CursorAgentStreamingProcess {
    readonly done: Promise<CursorAgentExit>;
    readonly pid?: number;
    cancel(): Promise<void>;
    interrupt(): Promise<void>;
}
export declare function resolveModelForEffort(model: string | undefined, effort: CursorAgentEffort | undefined): string | undefined;
export interface CreateChatOptions {
    readonly cursorApiKey?: string;
    readonly cursorAuthToken?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
}
/**
 * Run `cursor-agent create-chat` and return the chat id from stdout.
 */
export declare function createChat(workspace: string, opts?: CreateChatOptions): Promise<{
    chatId: string;
    stderr: string;
}>;
/**
 * Run a headless session and invoke `onLine` for each stdout line (NDJSON stream).
 */
export declare function runHeadlessStreaming(opts: HeadlessRunOptions, onLine: (line: string) => void): Promise<CursorAgentExit>;
export declare function startHeadlessStreaming(opts: HeadlessRunOptions, onLine: (line: string) => void): CursorAgentStreamingProcess;
export interface ResumeRunOptions extends Omit<HeadlessRunOptions, "prompt"> {
    readonly sessionOrChatId: string;
    readonly prompt?: string;
}
export declare function resumeStreaming(opts: ResumeRunOptions, onLine: (line: string) => void): Promise<CursorAgentExit>;
export declare function startResumeStreaming(opts: ResumeRunOptions, onLine: (line: string) => void): CursorAgentStreamingProcess;
export declare function isTrustFailureMessage(text: string): boolean;
export {};
//# sourceMappingURL=process-runner.d.ts.map