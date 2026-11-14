import type {
  CursorSessionRecord,
  SessionMode,
  SessionStatus,
} from "./session-record";

export interface SessionSearchFilters {
  readonly workspace?: string;
  readonly model?: string;
  readonly mode?: SessionMode;
  readonly status?: SessionStatus;
}

export interface SessionSearchOptions {
  readonly query: string;
  readonly filters?: SessionSearchFilters;
  readonly limit: number;
  readonly offset: number;
}

export interface SessionSearchHit extends CursorSessionRecord {
  readonly matchFields: readonly string[];
  readonly provenance: "index";
}

export interface SessionSearchResult {
  readonly query: string;
  readonly filters: SessionSearchFilters;
  readonly sessions: readonly SessionSearchHit[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly provenance: "index";
}
