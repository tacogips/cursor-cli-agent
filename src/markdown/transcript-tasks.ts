import { streamTranscriptSearchLines } from "../cursor/transcript-reader";
import type { SessionIndexRepository } from "../persistence/session-index";
import type { MarkdownSection, MarkdownTask } from "../types/markdown-task";
import type { CursorSessionRecord } from "../types/session-record";
import type { MarkdownTaskExtractionResult } from "../types/markdown-task";
import { parseMarkdownTasks } from "./parser";

export interface TranscriptMarkdownTaskOptions {
  readonly sessionId: string;
  readonly messageId?: string;
  readonly checked?: boolean;
}

export interface TranscriptMarkdownTaskExtractor {
  extract(
    options: TranscriptMarkdownTaskOptions,
  ): Promise<MarkdownTaskExtractionResult>;
}

export class MarkdownTaskNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownTaskNotFoundError";
  }
}

function canonicalSessionId(record: CursorSessionRecord): string {
  return record.localSessionId ?? record.cursorChatId ?? record.recordId;
}

function messageIdFor(eventOffset: number, role: string): string {
  return `event-${eventOffset}-${role}`;
}

function emptyResult(
  record: CursorSessionRecord,
  options: TranscriptMarkdownTaskOptions,
): MarkdownTaskExtractionResult {
  return {
    recordId: record.recordId,
    ...(record.localSessionId !== undefined
      ? { localSessionId: record.localSessionId }
      : {}),
    ...(record.cursorChatId !== undefined
      ? { cursorChatId: record.cursorChatId }
      : {}),
    sessionId: canonicalSessionId(record),
    ...(record.transcriptPath !== undefined
      ? { transcriptPath: record.transcriptPath }
      : {}),
    ...(options.messageId !== undefined
      ? { messageId: options.messageId }
      : {}),
    sections: [],
    tasks: [],
    totalTasks: 0,
    provenance: "transcript",
  };
}

export function createTranscriptMarkdownTaskExtractor(
  repository: SessionIndexRepository,
): TranscriptMarkdownTaskExtractor {
  return {
    async extract(
      options: TranscriptMarkdownTaskOptions,
    ): Promise<MarkdownTaskExtractionResult> {
      const record = repository.resolveSessionKey(options.sessionId);
      if (record === undefined) {
        throw new MarkdownTaskNotFoundError("session not found");
      }
      if (
        record.identityState === "chat_only" ||
        record.transcriptPath === undefined
      ) {
        return emptyResult(record, options);
      }

      const sections: MarkdownSection[] = [];
      const tasks: MarkdownTask[] = [];

      for await (const line of streamTranscriptSearchLines(
        record.transcriptPath,
      )) {
        if (line.role !== "assistant") {
          continue;
        }

        const messageId = messageIdFor(line.eventOffset, line.role);
        if (
          options.messageId !== undefined &&
          messageId !== options.messageId
        ) {
          continue;
        }

        const parsed = parseMarkdownTasks({
          recordId: record.recordId,
          ...(record.localSessionId !== undefined
            ? { localSessionId: record.localSessionId }
            : {}),
          ...(record.cursorChatId !== undefined
            ? { cursorChatId: record.cursorChatId }
            : {}),
          transcriptPath: record.transcriptPath,
          messageId,
          eventOffset: line.eventOffset,
          ...(line.byteOffset !== undefined
            ? { byteOffset: line.byteOffset }
            : {}),
          markdown: line.text,
        });
        sections.push(...parsed.sections);
        tasks.push(...parsed.tasks);
      }

      const filteredTasks =
        options.checked === undefined
          ? tasks
          : tasks.filter((task) => task.checked === options.checked);

      return {
        recordId: record.recordId,
        ...(record.localSessionId !== undefined
          ? { localSessionId: record.localSessionId }
          : {}),
        ...(record.cursorChatId !== undefined
          ? { cursorChatId: record.cursorChatId }
          : {}),
        transcriptPath: record.transcriptPath,
        sessionId: canonicalSessionId(record),
        ...(options.messageId !== undefined
          ? { messageId: options.messageId }
          : {}),
        sections,
        tasks: filteredTasks,
        totalTasks: filteredTasks.length,
        provenance: "transcript",
      };
    },
  };
}
