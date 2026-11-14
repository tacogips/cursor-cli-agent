import type { ToolCommandRunOptions, ToolCommandRunResult, ToolVersionInfo, ToolVersionOptions, ToolVersionReport } from "../types/tool-versions";
export declare function defaultToolCommandRunner(command: string, args: readonly string[], options: ToolCommandRunOptions): Promise<ToolCommandRunResult>;
export declare function readToolVersion(name: string, command: string, options?: ToolVersionOptions): Promise<ToolVersionInfo>;
export declare function getToolVersions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
//# sourceMappingURL=tool-versions.d.ts.map