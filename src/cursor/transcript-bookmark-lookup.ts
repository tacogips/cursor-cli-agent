import type { TranscriptSearchRole } from "../types/transcript-search";
import { streamTranscriptSearchLines } from "./transcript-reader";

export interface TranscriptBookmarkMessage {
  readonly messageId: string;
  readonly role: TranscriptSearchRole;
  readonly eventOffset: number;
  readonly rawText: string;
  readonly displayText: string;
}

export interface TranscriptBookmarkLookup {
  findMessage(
    transcriptPath: string,
    messageId: string,
  ): Promise<TranscriptBookmarkMessage | null>;
  findRange(
    transcriptPath: string,
    fromMessageId: string,
    toMessageId: string,
  ): Promise<readonly TranscriptBookmarkMessage[]>;
}

function messageIdFor(eventOffset: number, role: TranscriptSearchRole): string {
  return `event-${eventOffset}-${role}`;
}

function toBookmarkMessage(line: {
  readonly role: TranscriptSearchRole;
  readonly rawText: string;
  readonly text: string;
  readonly eventOffset: number;
}): TranscriptBookmarkMessage {
  return {
    messageId: messageIdFor(line.eventOffset, line.role),
    role: line.role,
    eventOffset: line.eventOffset,
    rawText: line.rawText,
    displayText: line.text,
  };
}

export function createTranscriptBookmarkLookup(): TranscriptBookmarkLookup {
  return {
    async findMessage(
      transcriptPath: string,
      messageId: string,
    ): Promise<TranscriptBookmarkMessage | null> {
      for await (const line of streamTranscriptSearchLines(transcriptPath)) {
        const message = toBookmarkMessage(line);
        if (message.messageId === messageId) {
          return message;
        }
      }
      return null;
    },

    async findRange(
      transcriptPath: string,
      fromMessageId: string,
      toMessageId: string,
    ): Promise<readonly TranscriptBookmarkMessage[]> {
      const messages: TranscriptBookmarkMessage[] = [];
      let collecting = false;
      for await (const line of streamTranscriptSearchLines(transcriptPath)) {
        const message = toBookmarkMessage(line);
        if (message.messageId === fromMessageId) {
          collecting = true;
        }
        if (collecting) {
          messages.push(message);
        }
        if (collecting && message.messageId === toMessageId) {
          return messages;
        }
      }
      return [];
    },
  };
}
