/**
 * Durable session record stored in the local index.
 */

export type IdentityState = "chat_only" | "transcript_only" | "linked";

export type SessionSource =
  | "create-chat"
  | "headless"
  | "interactive"
  | "unknown";

export type SessionMode = "default" | "plan" | "ask";

export type SessionStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "unknown";

export interface CursorSessionRecord {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly identityState: IdentityState;
  readonly workspaceSlug: string;
  readonly workspacePath?: string;
  readonly transcriptPath?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly materializedAt?: string;
  readonly source: SessionSource;
  readonly model?: string;
  readonly mode?: SessionMode;
  readonly status: SessionStatus;
  readonly firstUserText?: string;
  readonly lastAssistantText?: string;
}
