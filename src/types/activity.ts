import type { PromptAttachmentProvenance } from "./prompt-attachment";

export type ActivityStatus =
  | "idle"
  | "running"
  | "waiting_trust"
  | "waiting_input"
  | "completed"
  | "failed";

export type ActivitySignalSource =
  | "process"
  | "transcript"
  | "stream"
  | "stderr"
  | "stdout"
  | "index";

export interface ActivitySignal {
  readonly source: ActivitySignalSource;
  readonly status: ActivityStatus;
  readonly observedAt: string;
  readonly detail?: string;
  /** Summaries for image attachments forwarded into Cursor (no bytes). */
  readonly attachments?: readonly PromptAttachmentProvenance[];
}

export interface SessionActivity {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
  readonly signals: readonly ActivitySignal[];
  readonly provenance: "derived";
}
