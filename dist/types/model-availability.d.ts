import type { ToolAvailabilityStatus, ToolVersionCommandRunner, ToolVersionInfo } from "./tool-versions";
export interface AuthAvailabilityInfo {
    readonly status: ToolAvailabilityStatus;
    readonly detail: string;
    readonly provenance: "stable_api" | "probe" | "not_available";
}
export interface ModelReachabilityInfo {
    readonly status: ToolAvailabilityStatus;
    readonly probed: boolean;
    readonly output?: string;
    readonly error?: string;
}
export interface ModelAvailabilityReport {
    readonly model: string;
    readonly binary: ToolVersionInfo;
    readonly auth: AuthAvailabilityInfo;
    readonly modelReachability: ModelReachabilityInfo;
    readonly checkedAt: string;
}
export interface ModelAvailabilityOptions {
    readonly model: string;
    readonly probe?: boolean;
    readonly timeoutMs?: number;
    readonly cursorAgentBinary?: string;
    readonly workspace?: string;
    readonly now?: () => Date;
    readonly commandRunner?: ToolVersionCommandRunner;
    readonly cursorApiKey?: string;
    readonly cursorAuthToken?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
}
//# sourceMappingURL=model-availability.d.ts.map