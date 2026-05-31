import type { TranscriptSearchRole } from "../types/transcript-search";
export declare function parsePositiveInteger(url: {
    readonly searchParams: URLSearchParams;
}, name: string, defaultValue: number): number;
export declare function parseOptionalPositiveInteger(url: {
    readonly searchParams: URLSearchParams;
}, name: string): number | undefined;
export declare function parseNonNegativeInteger(url: {
    readonly searchParams: URLSearchParams;
}, name: string, defaultValue: number): number;
export declare function parseRequiredString(url: {
    readonly searchParams: URLSearchParams;
}, name: string): string;
export declare function parseOptionalString(url: {
    readonly searchParams: URLSearchParams;
}, name: string): string | undefined;
export declare function parseTranscriptRole(url: {
    readonly searchParams: URLSearchParams;
}): TranscriptSearchRole | undefined;
export declare function parseReplayMode(url: {
    readonly searchParams: URLSearchParams;
}, name: string, defaultValue: "latest" | "none"): "latest" | "none";
//# sourceMappingURL=request.d.ts.map