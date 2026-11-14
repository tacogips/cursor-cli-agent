import type { SessionIndexRepository } from "../persistence/session-index";
import type { CursorSessionRecord } from "../types/session-record";
import type {
  TranscriptSearchHit,
  TranscriptSearchOptions,
  TranscriptSearchResult,
} from "../types/transcript-search";
import { streamTranscriptScanLines } from "./transcript-reader";

export interface TranscriptSearchService {
  search(options: TranscriptSearchOptions): Promise<TranscriptSearchResult>;
}

export const DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS = 30_000;

interface SearchBudget {
  readonly maxBytes?: number;
  readonly maxEvents?: number;
  readonly deadlineAt: number;
}

type TranscriptCandidate = CursorSessionRecord & {
  readonly transcriptPath: string;
};

function normalizeQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("query must not be empty");
  }
  return normalized;
}

function validatePositiveInteger(
  value: number | undefined,
  label: string,
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateOptions(options: TranscriptSearchOptions): void {
  validatePositiveInteger(options.limit, "limit");
  validatePositiveInteger(options.maxSessions, "maxSessions");
  validatePositiveInteger(options.maxBytes, "maxBytes");
  validatePositiveInteger(options.maxEvents, "maxEvents");
  validatePositiveInteger(options.timeoutMs, "timeoutMs");
  if (
    !Number.isInteger(options.offset) ||
    !Number.isFinite(options.offset) ||
    options.offset < 0
  ) {
    throw new Error("offset must be a non-negative integer");
  }
}

function excerptFor(text: string, normalizedQuery: string): string {
  const normalizedText = text.toLowerCase();
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) {
    return text.slice(0, 160);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + normalizedQuery.length + 60);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function messageIdFor(eventOffset: number, role: string): string {
  return `event-${eventOffset}-${role}`;
}

function toHit(
  record: TranscriptCandidate,
  role: TranscriptSearchHit["role"],
  text: string,
  normalizedQuery: string,
  eventOffset: number,
  byteOffset: number | undefined,
): TranscriptSearchHit {
  return {
    recordId: record.recordId,
    ...(record.localSessionId !== undefined
      ? { localSessionId: record.localSessionId }
      : {}),
    ...(record.cursorChatId !== undefined
      ? { cursorChatId: record.cursorChatId }
      : {}),
    transcriptPath: record.transcriptPath,
    messageId: messageIdFor(eventOffset, role),
    role,
    excerpt: excerptFor(text, normalizedQuery),
    eventOffset,
    ...(byteOffset !== undefined ? { byteOffset } : {}),
    provenance: "transcript",
  };
}

function withTranscriptPath(
  record: CursorSessionRecord | undefined,
): TranscriptCandidate | undefined {
  if (record?.transcriptPath === undefined) {
    return undefined;
  }
  return { ...record, transcriptPath: record.transcriptPath };
}

export function createTranscriptSearchService(
  repository: SessionIndexRepository,
): TranscriptSearchService {
  return {
    async search(
      options: TranscriptSearchOptions,
    ): Promise<TranscriptSearchResult> {
      validateOptions(options);
      const normalizedQuery = normalizeQuery(options.query);
      const timeoutMs =
        options.timeoutMs ?? DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS;
      const budget: SearchBudget = {
        ...(options.maxBytes !== undefined
          ? { maxBytes: options.maxBytes }
          : {}),
        ...(options.maxEvents !== undefined
          ? { maxEvents: options.maxEvents }
          : {}),
        deadlineAt: Date.now() + timeoutMs,
      };
      const candidates =
        options.sessionId === undefined
          ? repository.listTranscriptBackedSessions().flatMap((candidate) => {
              const transcriptCandidate = withTranscriptPath(candidate);
              return transcriptCandidate === undefined
                ? []
                : [transcriptCandidate];
            })
          : [
              withTranscriptPath(
                repository.resolveSessionKey(options.sessionId),
              ),
            ].flatMap((candidate) =>
              candidate === undefined ? [] : [candidate],
            );

      const allHits: TranscriptSearchHit[] = [];
      let scannedSessions = 0;
      let scannedBytes = 0;
      let scannedEvents = 0;
      let truncated = false;
      let timedOut = false;

      for (const candidate of candidates) {
        if (
          options.maxSessions !== undefined &&
          scannedSessions >= options.maxSessions
        ) {
          truncated = true;
          break;
        }
        if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
          truncated = true;
          break;
        }
        if (
          budget.maxEvents !== undefined &&
          scannedEvents >= budget.maxEvents
        ) {
          truncated = true;
          break;
        }
        if (Date.now() >= budget.deadlineAt) {
          timedOut = true;
          break;
        }

        scannedSessions += 1;
        for await (const line of streamTranscriptScanLines(
          candidate.transcriptPath,
        )) {
          if (
            budget.maxEvents !== undefined &&
            scannedEvents >= budget.maxEvents
          ) {
            truncated = true;
            break;
          }
          if (
            budget.maxBytes !== undefined &&
            scannedBytes >= budget.maxBytes
          ) {
            truncated = true;
            break;
          }
          if (Date.now() >= budget.deadlineAt) {
            timedOut = true;
            break;
          }

          if (
            budget.maxBytes !== undefined &&
            scannedBytes + line.byteLength > budget.maxBytes
          ) {
            truncated = true;
            break;
          }
          scannedEvents += 1;
          scannedBytes += line.byteLength;

          if (!line.searchable) {
            continue;
          }

          if (options.role !== undefined && line.role !== options.role) {
            continue;
          }
          if (!line.text.toLowerCase().includes(normalizedQuery)) {
            continue;
          }
          allHits.push(
            toHit(
              candidate,
              line.role,
              line.text,
              normalizedQuery,
              line.eventOffset,
              line.byteOffset,
            ),
          );
        }

        if (truncated || timedOut) {
          break;
        }
      }

      return {
        query: options.query,
        hits: allHits.slice(options.offset, options.offset + options.limit),
        total: allHits.length,
        offset: options.offset,
        limit: options.limit,
        scannedSessions,
        scannedBytes,
        scannedEvents,
        truncated,
        timedOut,
      };
    },
  };
}
