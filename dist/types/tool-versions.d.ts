export type ToolAvailabilityStatus = "available" | "unavailable" | "unknown" | "not_checked";
export interface ToolVersionInfo {
    readonly name: string;
    readonly command?: string;
    readonly version: string | null;
    readonly status: ToolAvailabilityStatus;
    readonly error?: string;
    readonly checkedAt: string;
}
export interface ToolVersionReport {
    readonly packageVersion: string;
    readonly tools: readonly ToolVersionInfo[];
    readonly checkedAt: string;
}
export interface ToolVersionOptions {
    readonly timeoutMs?: number;
    readonly includeGit?: boolean;
    readonly includeBun?: boolean;
    readonly cursorAgentBinary?: string;
    readonly gitBinary?: string;
    readonly bunBinary?: string;
    readonly now?: () => Date;
    readonly commandRunner?: ToolVersionCommandRunner;
}
export interface ToolCommandRunOptions {
    readonly timeoutMs: number;
    readonly cwd?: string;
}
export interface ToolCommandRunResult {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly error?: string;
}
export type ToolVersionCommandRunner = (command: string, args: readonly string[], options: ToolCommandRunOptions) => Promise<ToolCommandRunResult>;
//# sourceMappingURL=tool-versions.d.ts.map