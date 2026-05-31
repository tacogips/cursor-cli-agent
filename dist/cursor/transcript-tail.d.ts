import { type TranscriptLine } from "./transcript-reader";
export interface TranscriptTailOptions {
    readonly startOffset?: number;
    readonly pollMs?: number;
    readonly signal: AbortSignal;
}
export interface TranscriptTailEvent {
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly line: TranscriptLine;
}
export declare function tailTranscript(transcriptPath: string, options: TranscriptTailOptions): AsyncGenerator<TranscriptTailEvent, void, undefined>;
//# sourceMappingURL=transcript-tail.d.ts.map