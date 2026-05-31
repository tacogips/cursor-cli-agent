import type { SessionIndexRepository } from "../persistence/session-index";
import type { TranscriptSearchOptions, TranscriptSearchResult } from "../types/transcript-search";
export interface TranscriptSearchService {
    search(options: TranscriptSearchOptions): Promise<TranscriptSearchResult>;
}
export declare const DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS = 30000;
export declare function createTranscriptSearchService(repository: SessionIndexRepository): TranscriptSearchService;
//# sourceMappingURL=transcript-search.d.ts.map