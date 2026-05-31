import type { SessionIndexRepository } from "../persistence/session-index";
import type { MarkdownTaskExtractionResult } from "../types/markdown-task";
export interface TranscriptMarkdownTaskOptions {
    readonly sessionId: string;
    readonly messageId?: string;
    readonly checked?: boolean;
}
export interface TranscriptMarkdownTaskExtractor {
    extract(options: TranscriptMarkdownTaskOptions): Promise<MarkdownTaskExtractionResult>;
}
export declare class MarkdownTaskNotFoundError extends Error {
    constructor(message: string);
}
export declare function createTranscriptMarkdownTaskExtractor(repository: SessionIndexRepository): TranscriptMarkdownTaskExtractor;
//# sourceMappingURL=transcript-tasks.d.ts.map