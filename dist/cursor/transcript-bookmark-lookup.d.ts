import type { TranscriptSearchRole } from "../types/transcript-search";
export interface TranscriptBookmarkMessage {
    readonly messageId: string;
    readonly role: TranscriptSearchRole;
    readonly eventOffset: number;
    readonly rawText: string;
    readonly displayText: string;
}
export interface TranscriptBookmarkLookup {
    findMessage(transcriptPath: string, messageId: string): Promise<TranscriptBookmarkMessage | null>;
    findRange(transcriptPath: string, fromMessageId: string, toMessageId: string): Promise<readonly TranscriptBookmarkMessage[]>;
}
export declare function createTranscriptBookmarkLookup(): TranscriptBookmarkLookup;
//# sourceMappingURL=transcript-bookmark-lookup.d.ts.map