/**
 * Normalized events and messages (domain layer; Cursor-agnostic shapes).
 */

export interface NormalizedMessage {
  readonly role: "user" | "assistant";
  readonly rawText: string;
  readonly displayText: string;
  readonly structured?: {
    readonly userQueryText?: string;
  };
}

export interface UsageStats {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** When provided by the stream, preferred over summed component totals. */
  readonly totalTokens?: number;
}

export type AgentEvent =
  | {
      readonly type: "session.started";
      readonly sessionId: string;
      readonly cwd: string;
      readonly model?: string;
    }
  | {
      readonly type: "session.pending";
      readonly recordId: string;
      readonly cursorChatId: string;
      readonly workspacePath?: string;
    }
  | {
      readonly type: "session.materialized";
      readonly recordId: string;
      readonly sessionId: string;
      readonly cursorChatId?: string;
    }
  | {
      readonly type: "session.user_message";
      readonly sessionId: string;
      readonly message: NormalizedMessage;
    }
  | {
      readonly type: "session.thinking";
      readonly sessionId: string;
      readonly state: "delta" | "completed";
    }
  | {
      readonly type: "session.assistant_message";
      readonly sessionId: string;
      readonly message: NormalizedMessage;
    }
  | {
      readonly type: "session.completed";
      readonly sessionId: string;
      readonly result: string;
      readonly usage?: UsageStats;
    }
  | {
      readonly type: "session.error";
      readonly sessionId?: string;
      readonly message: string;
      readonly reason?:
        | "attachment_validation_failed"
        | "attachments_unsupported"
        | "attachments_capability_unknown";
    };

/**
 * Prefer materialized `sessionId`; before that, fall back to Cursor chat id when
 * streaming still reports a pending session envelope.
 */
export function sessionIdFromEvent(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "session.started":
    case "session.user_message":
    case "session.thinking":
    case "session.assistant_message":
    case "session.completed":
      return event.sessionId;
    case "session.error":
      return event.sessionId;
    case "session.pending":
      return event.cursorChatId;
    case "session.materialized":
      return event.sessionId;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
