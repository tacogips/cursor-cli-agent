import type { NormalizedMessage } from "../types/agent-event";
import type { TranscriptSearchRole } from "../types/transcript-search";
export interface TranscriptLine {
    readonly role: "user" | "assistant";
    readonly message: NormalizedMessage;
}
export interface TranscriptSummary {
    readonly lines: readonly TranscriptLine[];
    readonly firstUserMessage?: NormalizedMessage;
    readonly lastAssistantMessage?: NormalizedMessage;
}
export interface TranscriptParseError {
    readonly line: number;
    readonly message: string;
}
export interface TranscriptSearchLine {
    readonly role: TranscriptSearchRole;
    readonly rawText: string;
    readonly text: string;
    readonly eventOffset: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}
export type TranscriptScanLine = (TranscriptSearchLine & {
    readonly searchable: true;
}) | {
    readonly searchable: false;
    readonly eventOffset: number;
    readonly byteOffset: number;
    readonly byteLength: number;
};
/**
 * Parse a single JSONL transcript line.
 */
export declare function parseTranscriptLine(json: string): TranscriptLine | undefined;
/**
 * Read a full transcript file and compute summary fields.
 */
export declare function readTranscriptFile(path: string): Promise<TranscriptSummary>;
/**
 * Stream transcript rows with scan metadata for full-text search budgets.
 */
export declare function streamTranscriptScanLines(transcriptPath: string): AsyncGenerator<TranscriptScanLine, void, undefined>;
/**
 * Stream searchable transcript lines without loading the full file.
 */
export declare function streamTranscriptSearchLines(transcriptPath: string): AsyncGenerator<TranscriptSearchLine, void, undefined>;
//# sourceMappingURL=transcript-reader.d.ts.map