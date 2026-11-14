/**
 * Optional enrichment from Cursor's local ai-code-tracking SQLite DB.
 * Joins to sessions via conversationId (matches localSessionId / transcript id).
 */

export interface AiConversationSummary {
  readonly title?: string;
  readonly tldr?: string;
  readonly overview?: string;
  readonly summaryBullets?: string;
  readonly model?: string;
  readonly mode?: string;
  readonly updatedAt?: number;
}

export interface AiCodeTouchRow {
  readonly fileName?: string;
  readonly fileExtension?: string;
  readonly model?: string;
  readonly timestamp?: number;
}

export interface AiDeletedFileRow {
  readonly gitPath: string;
  readonly deletedAt: number;
  readonly model?: string;
}

export interface AiTrackedFileRef {
  readonly gitPath: string;
  readonly content?: string;
  readonly contentBytes: number;
  readonly fileExtension?: string;
  readonly model?: string;
  readonly createdAt: number;
}

export interface AiConversationEnrichment {
  readonly conversationId: string;
  readonly summary?: AiConversationSummary;
  readonly codeTouches: readonly AiCodeTouchRow[];
  readonly deletedFiles: readonly AiDeletedFileRow[];
  readonly trackedFiles: readonly AiTrackedFileRef[];
}
