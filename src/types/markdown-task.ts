export interface MarkdownSection {
  readonly messageId: string;
  readonly heading: string;
  readonly level: number;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface MarkdownTask {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath: string;
  readonly messageId: string;
  readonly role: "assistant";
  readonly sectionHeading?: string;
  readonly text: string;
  readonly checked: boolean;
  readonly lineNumber: number;
  readonly eventOffset: number;
  readonly byteOffset?: number;
  readonly provenance: "transcript";
}

export interface MarkdownTaskExtractionResult {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath?: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly sections: readonly MarkdownSection[];
  readonly tasks: readonly MarkdownTask[];
  readonly totalTasks: number;
  readonly provenance: "transcript";
}
