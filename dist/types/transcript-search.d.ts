export type TranscriptSearchRole = "user" | "assistant" | "system" | "tool";
export interface TranscriptSearchOptions {
    readonly query: string;
    readonly sessionId?: string;
    readonly role?: TranscriptSearchRole;
    readonly limit: number;
    readonly offset: number;
    readonly maxSessions?: number;
    readonly maxBytes?: number;
    readonly maxEvents?: number;
    readonly timeoutMs?: number;
}
export interface TranscriptSearchHit {
    readonly recordId: string;
    readonly localSessionId?: string;
    readonly cursorChatId?: string;
    readonly transcriptPath: string;
    readonly messageId: string;
    readonly role: TranscriptSearchRole;
    readonly excerpt: string;
    readonly eventOffset: number;
    readonly byteOffset?: number;
    readonly provenance: "transcript";
}
export interface TranscriptSearchResult {
    readonly query: string;
    readonly hits: readonly TranscriptSearchHit[];
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
    readonly scannedSessions: number;
    readonly scannedBytes: number;
    readonly scannedEvents: number;
    readonly truncated: boolean;
    readonly timedOut: boolean;
}
//# sourceMappingURL=transcript-search.d.ts.map