import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import pkg from "../../package.json" with { type: "json" };

import {
  agentTranscriptsDirForWorkspace,
  getDataDir,
  stateDbPath,
} from "../config/paths";
import { createActivityManager } from "../activity/manager";
import { deriveGroupProgressSnapshot } from "../group/progress";
import { deriveQueueProgressSnapshot } from "../queue/progress";
import {
  BookmarkInputError,
  BookmarkNotFoundError,
  createBookmarkManager,
} from "../bookmarks/manager";
import { createActivitySignalClassifier } from "../cursor/activity-signals";
import {
  createChat,
  type HeadlessRunOptions,
  isTrustFailureMessage,
  type ResumeRunOptions,
  resumeStreaming,
  runHeadlessStreaming,
} from "../cursor/process-runner";
import { StreamNormalizerState } from "../cursor/stream-normalizer";
import {
  createTranscriptSearchService,
  DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
} from "../cursor/transcript-search";
import { loadAiTrackingEnrichment } from "../cursor/ai-tracking-reader";
import { findSkillByName, listSkillRecords } from "../cursor/skill-catalog";
import {
  createTranscriptMarkdownTaskExtractor,
  MarkdownTaskNotFoundError,
} from "../markdown/transcript-tasks";
import {
  parseTranscriptLine,
  readTranscriptFile,
} from "../cursor/transcript-reader";
import * as groupsStore from "../persistence/groups-store";
import * as queuesStore from "../persistence/queues-store";
import { SessionIndexRepository } from "../persistence/session-index";
import type { AgentEvent } from "../types/agent-event";
import type {
  BookmarkFilter,
  BookmarkSearchOptions,
  CreateBookmarkInput,
} from "../types/bookmark";
import type { ActivitySignal, ActivityStatus } from "../types/activity";
import { isBookmarkType } from "../types/bookmark";
import type { SessionSearchOptions } from "../types/session-search";
import type { SessionMode, SessionStatus } from "../types/session-record";
import type {
  GroupLifecycleState,
  GroupProgressSnapshot,
  GroupRecord,
  GroupRunRecord,
  GroupRunStatus,
  GroupRunWorkspaceRecord,
} from "../types/group";
import type {
  QueueItemMode,
  QueueItemRecord,
  QueueItemStatus,
  QueueProgressSnapshot,
  QueueRecord,
  QueueRunRecord,
  QueueRunStatus,
} from "../types/queue";
import type {
  TranscriptSearchOptions,
  TranscriptSearchResult,
  TranscriptSearchRole,
} from "../types/transcript-search";
import type { MarkdownTaskExtractionResult } from "../types/markdown-task";

type HeadlessStreamingRunner = typeof runHeadlessStreaming;

let runHeadlessStreamingImpl: HeadlessStreamingRunner = runHeadlessStreaming;

export function setCliTestOverrides(overrides: {
  readonly runHeadlessStreaming?: HeadlessStreamingRunner;
}): () => void {
  const previousRunHeadlessStreaming = runHeadlessStreamingImpl;
  if (overrides.runHeadlessStreaming !== undefined) {
    runHeadlessStreamingImpl = overrides.runHeadlessStreaming;
  }
  return () => {
    runHeadlessStreamingImpl = previousRunHeadlessStreaming;
  };
}

const EXIT = {
  OK: 0,
  ERR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CURSOR: 4,
  TRUST: 5,
  TRANSCRIPT: 6,
} as const;

function runnerPassthroughFromFlags(
  flags: Record<string, string | boolean>,
): Pick<
  HeadlessRunOptions,
  "sandbox" | "approveMcps" | "worktree" | "worktreeBase" | "skipWorktreeSetup"
> {
  const sandbox = flags["sandbox"];
  const wt = flags["worktree"];
  const wtb = flags["worktree-base"];
  return {
    ...(sandbox === "enabled" || sandbox === "disabled" ? { sandbox } : {}),
    ...(flags["approve-mcps"] === true ? { approveMcps: true as const } : {}),
    ...(wt === true
      ? { worktree: true as const }
      : typeof wt === "string" && wt.length > 0
        ? { worktree: wt }
        : {}),
    ...(typeof wtb === "string" && wtb.length > 0 ? { worktreeBase: wtb } : {}),
    ...(flags["skip-worktree-setup"] === true
      ? { skipWorktreeSetup: true as const }
      : {}),
  };
}

function buildHeadlessRunOptions(
  workspace: string,
  prompt: string,
  flags: Record<string, string | boolean>,
): HeadlessRunOptions {
  return {
    workspace,
    prompt,
    ...(typeof flags["model"] === "string" ? { model: flags["model"] } : {}),
    ...(flags["mode"] === "plan" || flags["mode"] === "ask"
      ? { mode: flags["mode"] }
      : {}),
    ...(flags["trust"] === true ? { trust: true } : {}),
    ...(flags["force"] === true ? { force: true } : {}),
    ...(flags["yolo"] === true ? { yolo: true } : {}),
    ...(flags["stream-partial-output"] === true
      ? { streamPartialOutput: true }
      : {}),
    ...runnerPassthroughFromFlags(flags),
  };
}

function buildResumeRunOptions(
  workspace: string,
  sessionOrChatId: string,
  flags: Record<string, string | boolean>,
): ResumeRunOptions {
  return {
    workspace,
    sessionOrChatId,
    ...(typeof flags["prompt"] === "string" && flags["prompt"].length > 0
      ? { prompt: flags["prompt"] }
      : {}),
    ...(typeof flags["model"] === "string" ? { model: flags["model"] } : {}),
    ...(flags["mode"] === "plan" || flags["mode"] === "ask"
      ? { mode: flags["mode"] }
      : {}),
    ...(flags["trust"] === true ? { trust: true } : {}),
    ...(flags["force"] === true ? { force: true } : {}),
    ...(flags["yolo"] === true ? { yolo: true } : {}),
    ...(flags["stream-partial-output"] === true
      ? { streamPartialOutput: true }
      : {}),
    ...runnerPassthroughFromFlags(flags),
  };
}

function parseFlags(argv: string[]): {
  rest: string[];
  flags: Record<string, string | boolean>;
} {
  const rest: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) {
      break;
    }
    if (a === "--json") {
      flags["json"] = true;
    } else if (a === "--trust") {
      flags["trust"] = true;
    } else if (a === "--force") {
      flags["force"] = true;
    } else if (a === "--yolo") {
      flags["yolo"] = true;
    } else if (a === "--stream-partial-output") {
      flags["stream-partial-output"] = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { rest, flags };
}

function getWorkspace(flags: Record<string, string | boolean>): string {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve(w);
  }
  return resolve(process.cwd());
}

function getExplicitWorkspace(
  flags: Record<string, string | boolean>,
): string | undefined {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve(w);
  }
  return undefined;
}

function isSessionMode(value: string): value is SessionMode {
  return value === "default" || value === "plan" || value === "ask";
}

function isSessionStatus(value: string): value is SessionStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "completed" ||
    value === "failed" ||
    value === "unknown"
  );
}

function isActivityStatus(value: string): value is ActivityStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "waiting_trust" ||
    value === "waiting_input" ||
    value === "completed" ||
    value === "failed"
  );
}

function isTranscriptSearchRole(value: string): value is TranscriptSearchRole {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "tool"
  );
}

function parsePositiveIntegerFlag(
  flags: Record<string, string | boolean>,
  key: string,
  defaultValue: number,
): number | undefined {
  const value = flags[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseNonNegativeIntegerFlag(
  flags: Record<string, string | boolean>,
  key: string,
  defaultValue: number,
): number | undefined {
  const value = flags[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseSessionSearchOptions(
  pos: readonly string[],
  flags: Record<string, string | boolean>,
): { options: SessionSearchOptions } | { error: string } {
  const query = pos[0];
  if (query === undefined || query.trim().length === 0) {
    return { error: "session search: missing query" };
  }

  const workspace = flags["workspace"];
  if (workspace !== undefined && typeof workspace !== "string") {
    return { error: "session search: --workspace requires a path" };
  }

  const model = flags["model"];
  if (model !== undefined && typeof model !== "string") {
    return { error: "session search: --model requires a model" };
  }

  const mode = flags["mode"];
  if (mode !== undefined) {
    if (typeof mode !== "string" || !isSessionMode(mode)) {
      return { error: "session search: --mode must be default, plan, or ask" };
    }
  }

  const status = flags["status"];
  if (status !== undefined) {
    if (typeof status !== "string" || !isSessionStatus(status)) {
      return {
        error:
          "session search: --status must be pending, active, completed, failed, or unknown",
      };
    }
  }

  const limit = parsePositiveIntegerFlag(flags, "limit", 20);
  if (limit === undefined) {
    return { error: "session search: --limit must be a positive integer" };
  }

  const offset = parseNonNegativeIntegerFlag(flags, "offset", 0);
  if (offset === undefined) {
    return { error: "session search: --offset must be a non-negative integer" };
  }

  return {
    options: {
      query,
      limit,
      offset,
      filters: {
        ...(typeof workspace === "string" ? { workspace } : {}),
        ...(typeof model === "string" ? { model } : {}),
        ...(typeof mode === "string" && isSessionMode(mode) ? { mode } : {}),
        ...(typeof status === "string" && isSessionStatus(status)
          ? { status }
          : {}),
      },
    },
  };
}

function parseOptionalPositiveIntegerFlag(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined | null {
  const value = flags[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTranscriptSearchOptions(
  pos: readonly string[],
  flags: Record<string, string | boolean>,
): { options: TranscriptSearchOptions } | { error: string } {
  const query = pos[0];
  if (query === undefined || query.trim().length === 0) {
    return { error: "transcript search: missing query" };
  }

  const sessionId = flags["session"];
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "transcript search: --session requires an id" };
  }

  const role = flags["role"];
  if (role !== undefined) {
    if (typeof role !== "string" || !isTranscriptSearchRole(role)) {
      return {
        error:
          "transcript search: --role must be user, assistant, system, or tool",
      };
    }
  }

  const limit = parsePositiveIntegerFlag(flags, "limit", 20);
  if (limit === undefined) {
    return { error: "transcript search: --limit must be a positive integer" };
  }

  const offset = parseNonNegativeIntegerFlag(flags, "offset", 0);
  if (offset === undefined) {
    return {
      error: "transcript search: --offset must be a non-negative integer",
    };
  }

  const maxSessions = parseOptionalPositiveIntegerFlag(flags, "max-sessions");
  if (maxSessions === null) {
    return {
      error: "transcript search: --max-sessions must be a positive integer",
    };
  }

  const maxBytes = parseOptionalPositiveIntegerFlag(flags, "max-bytes");
  if (maxBytes === null) {
    return {
      error: "transcript search: --max-bytes must be a positive integer",
    };
  }

  const maxEvents = parseOptionalPositiveIntegerFlag(flags, "max-events");
  if (maxEvents === null) {
    return {
      error: "transcript search: --max-events must be a positive integer",
    };
  }

  return {
    options: {
      query,
      limit,
      offset,
      timeoutMs: DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
      ...(typeof sessionId === "string" ? { sessionId } : {}),
      ...(typeof role === "string" && isTranscriptSearchRole(role)
        ? { role }
        : {}),
      ...(maxSessions !== undefined ? { maxSessions } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(maxEvents !== undefined ? { maxEvents } : {}),
    },
  };
}

function parseActivityOptions(flags: Record<string, string | boolean>):
  | {
      session?: string;
      status?: ActivityStatus;
      limit?: number;
    }
  | { error: string } {
  const session = flags["session"];
  if (session !== undefined && typeof session !== "string") {
    return { error: "activity: --session requires an id" };
  }

  const status = flags["status"];
  if (status !== undefined) {
    if (typeof status !== "string" || !isActivityStatus(status)) {
      return {
        error:
          "activity: --status must be idle, running, waiting_trust, waiting_input, completed, or failed",
      };
    }
  }

  const limit = parseOptionalPositiveIntegerFlag(flags, "limit");
  if (limit === null) {
    return { error: "activity: --limit must be a positive integer" };
  }

  return {
    ...(typeof session === "string" ? { session } : {}),
    ...(typeof status === "string" && isActivityStatus(status)
      ? { status }
      : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function parseMarkdownTaskOptions(flags: Record<string, string | boolean>):
  | {
      sessionId: string;
      messageId?: string;
      checked?: boolean;
    }
  | { error: string } {
  const sessionId = flags["session"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { error: "markdown tasks: --session is required" };
  }

  const messageId = flags["message"];
  if (messageId !== undefined && typeof messageId !== "string") {
    return { error: "markdown tasks: --message requires an id" };
  }

  const checked = flags["checked"];
  if (checked === undefined) {
    return {
      sessionId,
      ...(typeof messageId === "string" ? { messageId } : {}),
    };
  }
  if (checked === "true") {
    return {
      sessionId,
      ...(typeof messageId === "string" ? { messageId } : {}),
      checked: true,
    };
  }
  if (checked === "false") {
    return {
      sessionId,
      ...(typeof messageId === "string" ? { messageId } : {}),
      checked: false,
    };
  }
  return { error: "markdown tasks: --checked must be true or false" };
}

function parseBookmarkFilter(
  flags: Record<string, string | boolean>,
): { filter: BookmarkFilter } | { error: string } {
  const sessionId = flags["session"];
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "bookmark list: --session requires an id" };
  }
  const type = flags["type"];
  if (type !== undefined) {
    if (typeof type !== "string" || !isBookmarkType(type)) {
      return {
        error: "bookmark list: --type must be session, message, or range",
      };
    }
  }
  const tag = flags["tag"];
  if (tag !== undefined && typeof tag !== "string") {
    return { error: "bookmark list: --tag requires a tag" };
  }
  return {
    filter: {
      ...(typeof sessionId === "string" ? { sessionId } : {}),
      ...(typeof type === "string" && isBookmarkType(type) ? { type } : {}),
      ...(typeof tag === "string" ? { tag } : {}),
    },
  };
}

function parseBookmarkAddInput(
  flags: Record<string, string | boolean>,
): { input: CreateBookmarkInput } | { error: string } {
  const type = flags["type"];
  if (typeof type !== "string" || !isBookmarkType(type)) {
    return { error: "bookmark add: --type must be session, message, or range" };
  }
  const sessionId = flags["session"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { error: "bookmark add: --session is required" };
  }
  const name = flags["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { error: "bookmark add: --name is required" };
  }
  const messageId = flags["message"];
  if (messageId !== undefined && typeof messageId !== "string") {
    return { error: "bookmark add: --message requires an id" };
  }
  const fromMessageId = flags["from"];
  if (fromMessageId !== undefined && typeof fromMessageId !== "string") {
    return { error: "bookmark add: --from requires an id" };
  }
  const toMessageId = flags["to"];
  if (toMessageId !== undefined && typeof toMessageId !== "string") {
    return { error: "bookmark add: --to requires an id" };
  }
  const description = flags["description"];
  if (description !== undefined && typeof description !== "string") {
    return { error: "bookmark add: --description requires text" };
  }
  const tag = flags["tag"];
  if (tag !== undefined && typeof tag !== "string") {
    return { error: "bookmark add: --tag requires a tag" };
  }
  return {
    input: {
      type,
      sessionId,
      name,
      ...(typeof messageId === "string" ? { messageId } : {}),
      ...(typeof fromMessageId === "string" ? { fromMessageId } : {}),
      ...(typeof toMessageId === "string" ? { toMessageId } : {}),
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof tag === "string" ? { tags: [tag] } : {}),
    },
  };
}

function parseBookmarkSearchOptions(
  flags: Record<string, string | boolean>,
): { options: BookmarkSearchOptions } | { error: string } {
  const limit = parseOptionalPositiveIntegerFlag(flags, "limit");
  if (limit === null) {
    return { error: "bookmark search: --limit must be a positive integer" };
  }
  return { options: { ...(limit !== undefined ? { limit } : {}) } };
}

function renderBookmarkHuman(bookmark: {
  readonly id: string;
  readonly type: string;
  readonly sessionId: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly messageId?: string;
  readonly fromMessageId?: string;
  readonly toMessageId?: string;
}): void {
  const target =
    bookmark.type === "message"
      ? `message=${bookmark.messageId ?? ""}`
      : bookmark.type === "range"
        ? `range=${bookmark.fromMessageId ?? ""}..${bookmark.toMessageId ?? ""}`
        : "session";
  const tags =
    bookmark.tags.length > 0 ? ` tags=${bookmark.tags.join(",")}` : "";
  console.log(
    `${bookmark.id}  ${bookmark.type}  session=${bookmark.sessionId}  ${target}  ${bookmark.name}${tags}`,
  );
}

function renderSessionSearchHuman(
  result: ReturnType<SessionIndexRepository["searchSessions"]>,
): void {
  for (const r of result.sessions) {
    const pending = r.identityState === "chat_only" ? " [pending-chat]" : "";
    const id = r.localSessionId ?? r.cursorChatId ?? r.recordId;
    console.log(
      `${id}${pending}  ${r.workspaceSlug}  ${r.status}  ${r.updatedAt}  matches=${r.matchFields.join(",")}`,
    );
  }
}

function renderTranscriptSearchHuman(result: TranscriptSearchResult): void {
  for (const hit of result.hits) {
    const id = hit.localSessionId ?? hit.cursorChatId ?? hit.recordId;
    console.log(
      `${id}  ${hit.role}  ${hit.messageId}  ${hit.excerpt.replace(/\s+/g, " ").trim()}`,
    );
  }
  if (result.truncated) {
    console.log(
      `Search truncated after ${result.scannedSessions} sessions, ${result.scannedEvents} events, ${result.scannedBytes} bytes`,
    );
  }
  if (result.timedOut) {
    console.log(
      `Search timed out after ${result.scannedSessions} sessions, ${result.scannedEvents} events, ${result.scannedBytes} bytes`,
    );
  }
}

function renderMarkdownTasksHuman(result: MarkdownTaskExtractionResult): void {
  for (const task of result.tasks) {
    const marker = task.checked ? "[x]" : "[ ]";
    const section =
      task.sectionHeading === undefined || task.sectionHeading.length === 0
        ? ""
        : `  ${task.sectionHeading}`;
    console.log(`${task.messageId}  ${marker}${section}  ${task.text}`);
  }
}

function renderActivityHuman(activity: {
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly recordId: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
  readonly signals: readonly ActivitySignal[];
}): void {
  const id =
    activity.localSessionId ?? activity.cursorChatId ?? activity.recordId;
  const sources = activity.signals.map((signal) => signal.source).join(",");
  console.log(`${id}  ${activity.status}  ${activity.updatedAt}  ${sources}`);
}

function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function renderGroupProgressHuman(snapshot: GroupProgressSnapshot): void {
  console.log(
    `${snapshot.group.name}  lifecycle=${snapshot.group.lifecycleState}  run=${snapshot.run?.status ?? "none"}  updated=${snapshot.updatedAt}`,
  );
  console.log(
    `totals pending=${snapshot.totals.pending} running=${snapshot.totals.running} waiting=${snapshot.totals.waiting} completed=${snapshot.totals.completed} failed=${snapshot.totals.failed} unknown=${snapshot.totals.unknown}`,
  );
  for (const workspace of snapshot.run?.workspaces ?? []) {
    const session = workspace.localSessionId ?? workspace.cursorChatId ?? "-";
    console.log(`${workspace.workspace}  ${workspace.status}  ${session}`);
  }
}

function renderQueueProgressLine(snapshot: QueueProgressSnapshot): string {
  return `${snapshot.queue.name}  lifecycle=${snapshot.queue.lifecycleState}  run=${snapshot.run?.status ?? "none"}  total=${snapshot.queue.items.length}  pending=${snapshot.totals.pending}  running=${snapshot.totals.running}  completed=${snapshot.totals.completed}  failed=${snapshot.totals.failed}  skipped=${snapshot.totals.skipped}  manual=${snapshot.totals.manual}  workspace=${snapshot.queue.workspace}`;
}

function renderQueueProgressHuman(snapshot: QueueProgressSnapshot): void {
  console.log(renderQueueProgressLine(snapshot));
  for (const item of snapshot.queue.items) {
    console.log(
      `${item.id}  ${item.status}  mode=${item.mode}  ${promptPreview(item.prompt)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isTerminalRunStatus(status: GroupRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "paused";
}

function runId(name: string, startedAt: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${safeName}-${startedAt.replace(/[^0-9]/g, "")}`;
}

function promptPreview(prompt: string): string {
  return prompt.length <= 120 ? prompt : `${prompt.slice(0, 117)}...`;
}

function initialRunRecord(group: GroupRecord, prompt: string): GroupRunRecord {
  const startedAt = new Date().toISOString();
  return {
    id: runId(group.name, startedAt),
    status: "running",
    promptPreview: promptPreview(prompt),
    startedAt,
    updatedAt: startedAt,
    workspaces: group.workspaces.map((workspace) => ({
      workspace,
      status: "pending",
      updatedAt: startedAt,
    })),
  };
}

function initialQueueRunRecord(queue: QueueRecord): QueueRunRecord {
  const startedAt = new Date().toISOString();
  const runnable = queue.items.filter(
    (item) => item.status === "pending" && item.mode === "auto",
  );
  return {
    id: runId(queue.name, startedAt),
    status: "running",
    startedAt,
    updatedAt: startedAt,
    completedItemIds: [],
    failedItemIds: [],
    pendingItemIds: runnable.map((item) => item.id),
  };
}

function updateQueueRunItem(
  run: QueueRunRecord,
  itemId: string,
  status: QueueItemStatus,
): QueueRunRecord {
  const updatedAt = new Date().toISOString();
  const completed = new Set(run.completedItemIds);
  const failed = new Set(run.failedItemIds);
  const pending = new Set(run.pendingItemIds);
  pending.delete(itemId);
  if (status === "completed") {
    completed.add(itemId);
    failed.delete(itemId);
  }
  if (status === "failed") {
    failed.add(itemId);
    completed.delete(itemId);
  }
  const currentItemId =
    status === "running"
      ? itemId
      : run.currentItemId === itemId
        ? undefined
        : run.currentItemId;
  const runWithoutCurrent = {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
    completedItemIds: run.completedItemIds,
    failedItemIds: run.failedItemIds,
    pendingItemIds: run.pendingItemIds,
    ...(run.stoppedAt !== undefined ? { stoppedAt: run.stoppedAt } : {}),
  };
  return {
    ...runWithoutCurrent,
    ...(currentItemId !== undefined ? { currentItemId } : {}),
    updatedAt,
    completedItemIds: [...completed],
    failedItemIds: [...failed],
    pendingItemIds: [...pending],
  };
}

function finishQueueRunRecord(
  run: QueueRunRecord,
  status: QueueRunStatus,
): QueueRunRecord {
  const completedAt = new Date().toISOString();
  return {
    ...run,
    status,
    updatedAt: completedAt,
    completedAt,
    ...(status === "stopped" ? { stoppedAt: completedAt } : {}),
  };
}

function updateRunWorkspace(
  run: GroupRunRecord,
  workspace: string,
  update: Partial<GroupRunWorkspaceRecord>,
): GroupRunRecord {
  const updatedAt = new Date().toISOString();
  return {
    ...run,
    updatedAt,
    workspaces: run.workspaces.map((record) =>
      record.workspace === workspace
        ? {
            ...record,
            ...update,
            updatedAt,
          }
        : record,
    ),
  };
}

function finishRunRecord(
  run: GroupRunRecord,
  status: GroupRunStatus,
): GroupRunRecord {
  const completedAt = new Date().toISOString();
  return {
    ...run,
    status,
    updatedAt: completedAt,
    completedAt,
  };
}

function printEvents(events: readonly AgentEvent[], json: boolean): void {
  if (json) {
    for (const e of events) {
      printJson(e);
    }
  } else {
    for (const e of events) {
      console.log(JSON.stringify(e));
    }
  }
}

interface TextStreamRenderState {
  readonly lastAssistantBySession: Map<string, string>;
}

/**
 * Resolves `--stream` with optional `--json` as alias for `json` mode (parity with group/queue).
 * An explicit `--stream <value>` must be `text`, `json`, or `events`.
 */
function resolveStreamMode(
  flags: Record<string, string | boolean>,
): { mode: "text" | "json" | "events" } | { error: true } {
  const s = flags["stream"];
  if (s === "text" || s === "json" || s === "events") {
    return { mode: s };
  }
  if (typeof s === "string" && s.length > 0) {
    return { error: true };
  }
  if (flags["json"] === true) {
    return { mode: "json" };
  }
  return { mode: "events" };
}

function emitStreamedAgentEvents(
  stream: "text" | "json" | "events",
  evs: readonly AgentEvent[],
  textState?: TextStreamRenderState,
): void {
  if (stream === "text") {
    const state = textState;
    for (const e of evs) {
      if (e.type === "session.assistant_message") {
        process.stdout.write(e.message.displayText);
        state?.lastAssistantBySession.set(e.sessionId, e.message.displayText);
      }
      if (e.type === "session.completed") {
        const lastAssistant = state?.lastAssistantBySession.get(e.sessionId);
        if (lastAssistant !== e.result) {
          process.stdout.write(e.result);
        }
        state?.lastAssistantBySession.delete(e.sessionId);
      }
    }
  } else {
    printEvents(evs, stream === "json");
  }
}

async function openRepo(): Promise<SessionIndexRepository> {
  mkdirSync(getDataDir(), { recursive: true });
  return new SessionIndexRepository(stateDbPath());
}

function sessionIdFromEvent(event: AgentEvent): string | undefined {
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
    case "session.materialized":
      return undefined;
  }
}

async function recordActivitySignal(
  manager: ReturnType<typeof createActivityManager>,
  sessionId: string | undefined,
  signal: ActivitySignal | null,
): Promise<void> {
  if (sessionId === undefined || signal === null) {
    return;
  }
  await manager.recordSignal(sessionId, signal);
}

export async function runCli(argv: string[]): Promise<number> {
  const [, , cmd, ...tail] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") {
    console.log(`Usage:
  curort-cli-agent version
  curort-cli-agent session list [--workspace <path>] [--limit N] [--json]
  curort-cli-agent session show <id> [--workspace <path>] [--json]
  curort-cli-agent session watch <id> [--workspace <path>] [--json]
  curort-cli-agent session run --prompt <text> [options]
  curort-cli-agent session create [--workspace <path>] [--json]
  curort-cli-agent session resume <id> [--prompt <text>] [options]
  curort-cli-agent session continue [--workspace <path>] [--stream <text|json|events>] [--json]
  curort-cli-agent session attach <id> [--workspace <path>]
  curort-cli-agent session search <query> [--workspace <path>] [--model <model>] [--mode <default|plan|ask>] [--status <pending|active|completed|failed|unknown>] [--limit N] [--offset N] [--json]
  curort-cli-agent transcript search <query> [--session <id>] [--role <user|assistant|system|tool>] [--limit N] [--offset N] [--max-sessions N] [--max-bytes N] [--max-events N] [--json]
  curort-cli-agent activity [--session <id>] [--status <idle|running|waiting_trust|waiting_input|completed|failed>] [--limit N] [--json]
  curort-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
  curort-cli-agent bookmark add --type <session|message|range> --session <id> --name <name> [--message <id>] [--from <id>] [--to <id>] [--tag <tag>] [--json]
  curort-cli-agent bookmark list [--session <id>] [--type <type>] [--tag <tag>] [--json]
  curort-cli-agent bookmark show <id> [--json]
  curort-cli-agent bookmark delete <id> [--json]
  curort-cli-agent bookmark search <query> [--limit N] [--json]
  curort-cli-agent group <subcommand> ...
    create <name> | list | show <name> | add <name> [--workspace <path>] | remove <name> [--workspace <path>]
    pause <name> [--json] | resume <name> [--json] | delete <name> [--force] [--json]
    watch <name> [--interval <seconds>] [--once] [--json]
    run <name> --prompt <text> [--stream <text|json|events>] [--json]
  curort-cli-agent queue <subcommand> ...
    create <name> [--workspace <path>] | list | show <name> | add <name> --prompt <text> | remove <name> --item <id>
    pause <name> [--json] | resume <name> [--json] | delete <name> [--force] [--json]
    update <name> --item <id> [--prompt <text>] [--status <pending|completed|failed|skipped>] [--json]
    move <name> --from <n> --to <n> [--json] | mode <name> --item <id> --mode <auto|manual> [--json] | stop <name> [--json]
    run <name> [--stream <text|json|events>] [--json]
  curort-cli-agent skill list [--workspace <path>] [--json]
  curort-cli-agent skill show <name> [--workspace <path>] [--json]
  curort-cli-agent server ...  (phase 2; not implemented yet)
  curort-cli-agent daemon ...  (phase 2; not implemented yet)
`);
    return EXIT.USAGE;
  }

  if (cmd === "version") {
    console.log(`curort-cli-agent ${pkg.version}`);
    return EXIT.OK;
  }

  if (cmd === "server" || cmd === "daemon") {
    console.error(
      `${cmd}: not implemented in phase 1 (planned for phase 2; see design-docs/specs/command.md)`,
    );
    return EXIT.ERR;
  }

  if (cmd === "session") {
    return runSession(tail);
  }
  if (cmd === "transcript") {
    return runTranscript(tail);
  }
  if (cmd === "activity") {
    return runActivity(tail);
  }
  if (cmd === "markdown") {
    return runMarkdown(tail);
  }
  if (cmd === "bookmark") {
    return runBookmark(tail);
  }
  if (cmd === "group") {
    return runGroup(tail);
  }
  if (cmd === "queue") {
    return runQueue(tail);
  }
  if (cmd === "skill") {
    return runSkill(tail);
  }

  console.error(`Unknown command: ${cmd}`);
  return EXIT.USAGE;
}

async function runActivity(argv: string[]): Promise<number> {
  const { rest: pos, flags } = parseFlags(argv);
  if (pos.length > 0) {
    console.error("activity: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseActivityOptions(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const manager = createActivityManager({ sessions: repo });
    if (parsed.session !== undefined) {
      const activity = await manager.getSessionActivity(parsed.session);
      if (activity === null) {
        console.error("session not found");
        return EXIT.NOT_FOUND;
      }
      if (parsed.status !== undefined && activity.status !== parsed.status) {
        if (json) {
          printJson({ activity: null });
        }
        return EXIT.OK;
      }
      if (json) {
        printJson(activity);
      } else {
        renderActivityHuman(activity);
      }
      return EXIT.OK;
    }
    const activities = await manager.listActivity({
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    });
    if (json) {
      printJson({ activities });
    } else {
      for (const activity of activities) {
        renderActivityHuman(activity);
      }
    }
    return EXIT.OK;
  } finally {
    repo.close();
  }
}

async function runMarkdown(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("markdown: missing subcommand");
    return EXIT.USAGE;
  }
  if (sub !== "tasks") {
    console.error(`Unknown markdown subcommand: ${sub}`);
    return EXIT.USAGE;
  }

  const { rest: pos, flags } = parseFlags(rest);
  if (pos.length > 0) {
    console.error("markdown tasks: unexpected positional arguments");
    return EXIT.USAGE;
  }

  const parsed = parseMarkdownTaskOptions(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }

  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const extractor = createTranscriptMarkdownTaskExtractor(repo);
    const result = await extractor.extract(parsed);
    if (json) {
      printJson(result);
    } else {
      renderMarkdownTasksHuman(result);
    }
    return EXIT.OK;
  } catch (error) {
    if (error instanceof MarkdownTaskNotFoundError) {
      console.error(error.message);
      return EXIT.NOT_FOUND;
    }
    throw error;
  } finally {
    repo.close();
  }
}

async function runBookmark(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("bookmark: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const manager = createBookmarkManager({ sessions: repo });

    if (sub === "add") {
      const parsed = parseBookmarkAddInput(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      try {
        const bookmark = await manager.add(parsed.input);
        if (json) {
          printJson(bookmark);
        } else {
          renderBookmarkHuman(bookmark);
        }
        return EXIT.OK;
      } catch (e) {
        if (e instanceof BookmarkInputError) {
          console.error(`bookmark add: ${e.message}`);
          return EXIT.USAGE;
        }
        if (e instanceof BookmarkNotFoundError) {
          console.error(e.message);
          return EXIT.NOT_FOUND;
        }
        throw e;
      }
    }

    if (sub === "list") {
      const parsed = parseBookmarkFilter(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      const bookmarks = await manager.list(parsed.filter);
      if (json) {
        printJson({ bookmarks });
      } else {
        for (const bookmark of bookmarks) {
          renderBookmarkHuman(bookmark);
        }
      }
      return EXIT.OK;
    }

    if (sub === "show") {
      const id = pos[0];
      if (id === undefined || id.length === 0) {
        console.error("bookmark show: missing bookmark id");
        return EXIT.USAGE;
      }
      const bookmark = await manager.show(id);
      if (bookmark === null) {
        console.error("bookmark not found");
        return EXIT.NOT_FOUND;
      }
      if (json) {
        printJson(bookmark);
      } else {
        renderBookmarkHuman(bookmark);
      }
      return EXIT.OK;
    }

    if (sub === "delete") {
      const id = pos[0];
      if (id === undefined || id.length === 0) {
        console.error("bookmark delete: missing bookmark id");
        return EXIT.USAGE;
      }
      const deleted = await manager.delete(id);
      if (!deleted) {
        console.error("bookmark not found");
        return EXIT.NOT_FOUND;
      }
      if (json) {
        printJson({ deleted: true, id });
      }
      return EXIT.OK;
    }

    if (sub === "search") {
      const query = pos[0];
      if (query === undefined || query.trim().length === 0) {
        console.error("bookmark search: missing query");
        return EXIT.USAGE;
      }
      const parsed = parseBookmarkSearchOptions(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      const result = await manager.search(query, parsed.options);
      if (json) {
        printJson(result);
      } else {
        for (const hit of result.hits) {
          renderBookmarkHuman(hit.bookmark);
        }
      }
      return EXIT.OK;
    }
  } finally {
    repo.close();
  }

  console.error(`Unknown bookmark subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runTranscript(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("transcript: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;

  if (sub !== "search") {
    console.error(`Unknown transcript subcommand: ${sub}`);
    return EXIT.USAGE;
  }

  const parsed = parseTranscriptSearchOptions(pos, flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }

  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const result = await createTranscriptSearchService(repo).search(
      parsed.options,
    );
    if (json) {
      printJson(result);
    } else {
      renderTranscriptSearchHuman(result);
    }
    return EXIT.OK;
  } finally {
    repo.close();
  }
}

async function runSession(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("session: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;
  const workspace = getWorkspace(flags);
  const explicitWorkspace = getExplicitWorkspace(flags);

  let runHeadlessPrompt: string | undefined;
  let resumeSessionId: string | undefined;
  let headlessStreamMode: "text" | "json" | "events" | undefined;
  let searchOptions: SessionSearchOptions | undefined;

  if (sub === "run") {
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined || prompt.length === 0) {
      console.error("session run: --prompt is required");
      return EXIT.USAGE;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    runHeadlessPrompt = prompt;
    headlessStreamMode = sm.mode;
  }
  if (sub === "resume") {
    const sid = pos[0];
    if (sid === undefined || sid.length === 0) {
      console.error("session resume: missing session id");
      return EXIT.USAGE;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session resume: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    resumeSessionId = sid;
    headlessStreamMode = sm.mode;
  }
  if (sub === "continue") {
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session continue: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    headlessStreamMode = sm.mode;
  }
  if (sub === "search") {
    const parsed = parseSessionSearchOptions(pos, flags);
    if ("error" in parsed) {
      console.error(parsed.error);
      return EXIT.USAGE;
    }
    searchOptions = {
      ...parsed.options,
      filters: {
        ...parsed.options.filters,
        ...(explicitWorkspace !== undefined
          ? { workspace: explicitWorkspace }
          : {}),
      },
    };
  }

  const repo = await openRepo();
  await repo.importTranscriptsFromFilesystem();
  const activityManager = createActivityManager({ sessions: repo });
  const activityClassifier = createActivitySignalClassifier();
  let activityWriteChain: Promise<void> = Promise.resolve();
  let lastActivitySessionId: string | undefined;
  const enqueueActivitySignal = (
    sessionId: string | undefined,
    signal: ActivitySignal | null,
  ): void => {
    activityWriteChain = activityWriteChain.then(() =>
      recordActivitySignal(activityManager, sessionId, signal),
    );
  };
  const captureActivityEvents = (
    events: readonly AgentEvent[],
    fallbackSessionId?: string,
  ): void => {
    for (const event of events) {
      const sessionId = sessionIdFromEvent(event) ?? fallbackSessionId;
      if (sessionId !== undefined) {
        lastActivitySessionId = sessionId;
      }
      enqueueActivitySignal(
        sessionId,
        activityClassifier.classifyStreamEvent(event),
      );
    }
  };
  const recordProcessResult = async (
    exitCode: number | null,
    stderr: string,
    stdout: string,
    fallbackSessionId?: string,
  ): Promise<void> => {
    enqueueActivitySignal(
      lastActivitySessionId ?? fallbackSessionId,
      activityClassifier.classifyProcessResult(exitCode, stderr, stdout),
    );
    await activityWriteChain;
  };

  if (sub === "list") {
    const limit =
      typeof flags["limit"] === "string" ? Number(flags["limit"]) : 20;
    const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
    const rows = repo.listSessionsForWorkspace(workspace, lim);
    if (json) {
      printJson({ sessions: rows });
    } else {
      for (const r of rows) {
        const pending =
          r.identityState === "chat_only" ? " [pending-chat]" : "";
        const id = r.localSessionId ?? r.cursorChatId ?? r.recordId;
        console.log(
          `${id}${pending}  ${r.workspaceSlug}  ${r.status}  ${r.updatedAt}`,
        );
      }
    }
    return EXIT.OK;
  }

  if (sub === "search") {
    const result = repo.searchSessions(searchOptions!);
    if (json) {
      printJson(result);
    } else {
      renderSessionSearchHuman(result);
    }
    return EXIT.OK;
  }

  if (sub === "show") {
    const id = pos[0];
    if (id === undefined || id.length === 0) {
      console.error("session show: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(id);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    if (rec.identityState === "chat_only") {
      const body = {
        recordId: rec.recordId,
        identityState: rec.identityState,
        cursorChatId: rec.cursorChatId,
        workspaceSlug: rec.workspaceSlug,
        workspacePath: rec.workspacePath,
        status: rec.status,
        pendingTranscript: true,
        message: "Transcript has not materialized yet.",
      };
      if (json) {
        printJson(body);
      } else {
        console.log(`Pending chat session (no transcript yet)`);
        console.log(`cursorChatId: ${rec.cursorChatId ?? ""}`);
        console.log(`workspace: ${rec.workspacePath ?? rec.workspaceSlug}`);
      }
      return EXIT.OK;
    }
    if (rec.transcriptPath === undefined) {
      console.error("session has no transcript path");
      return EXIT.TRANSCRIPT;
    }
    let summary;
    try {
      summary = await readTranscriptFile(rec.transcriptPath);
    } catch {
      console.error("failed to read transcript");
      return EXIT.TRANSCRIPT;
    }
    const convId = rec.localSessionId ?? rec.cursorChatId;
    const aiTracking =
      convId !== undefined ? loadAiTrackingEnrichment(convId) : undefined;
    if (json) {
      printJson({
        record: rec,
        messages: summary.lines.map((l) => ({
          role: l.role,
          rawText: l.message.rawText,
          displayText: l.message.displayText,
          structured: l.message.structured,
        })),
        ...(aiTracking !== undefined ? { aiTracking } : {}),
      });
    } else {
      console.log(`Session ${rec.localSessionId ?? rec.recordId}`);
      console.log(`Workspace: ${rec.workspacePath ?? rec.workspaceSlug}`);
      const fu = summary.firstUserMessage;
      const la = summary.lastAssistantMessage;
      if (fu !== undefined) {
        console.log(`First user (display): ${fu.displayText}`);
      }
      if (la !== undefined) {
        console.log(`Last assistant (display): ${la.displayText}`);
      }
      if (aiTracking !== undefined) {
        const touches = aiTracking.codeTouches.length;
        const deleted = aiTracking.deletedFiles.length;
        const tracked = aiTracking.trackedFiles.length;
        console.log(
          `AI tracking: code touches=${touches}, deleted files=${deleted}, tracked snapshots=${tracked}`,
        );
      }
    }
    return EXIT.OK;
  }

  if (sub === "watch") {
    const id = pos[0];
    if (id === undefined || id.length === 0) {
      console.error("session watch: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(id);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    let watchInterrupted = false;
    const stopWatch = (): void => {
      watchInterrupted = true;
    };
    process.once("SIGINT", stopWatch);
    process.once("SIGTERM", stopWatch);
    if (rec.identityState === "chat_only" && rec.cursorChatId !== undefined) {
      const ws = rec.workspacePath ?? workspace;
      const expected = join(
        agentTranscriptsDirForWorkspace(ws),
        `${rec.cursorChatId}.jsonl`,
      );
      const pendingEvent = {
        type: "session.pending",
        recordId: rec.recordId,
        cursorChatId: rec.cursorChatId,
        workspacePath: ws,
      } as const;
      printEvents([pendingEvent], json);
      while (!existsSync(expected) && !watchInterrupted) {
        await new Promise((r) => setTimeout(r, 750));
        await repo.importTranscriptsFromFilesystem();
      }
      if (watchInterrupted) {
        process.off("SIGINT", stopWatch);
        process.off("SIGTERM", stopWatch);
        return EXIT.OK;
      }
      const linked = repo.resolveSessionKey(id);
      const materialSessionId =
        linked?.localSessionId ?? rec.cursorChatId ?? id;
      const mat = {
        type: "session.materialized",
        recordId: rec.recordId,
        sessionId: materialSessionId,
        cursorChatId: rec.cursorChatId,
      } as const;
      printEvents([mat], json);
    }
    const updated = repo.resolveSessionKey(id);
    const path = updated?.transcriptPath;
    if (path === undefined) {
      console.error("no transcript to watch");
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
      return EXIT.TRANSCRIPT;
    }
    const sessionKey = updated?.localSessionId ?? id;
    let offset = 0;
    const pump = async (): Promise<void> => {
      if (watchInterrupted) {
        return;
      }
      const buf = await readFile(path, "utf8");
      const chunk = buf.slice(offset);
      offset = buf.length;
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        if (watchInterrupted) {
          return;
        }
        const t = parseTranscriptLine(line);
        if (t === undefined) {
          continue;
        }
        const ev =
          t.role === "user"
            ? ({
                type: "session.user_message",
                sessionId: sessionKey,
                message: t.message,
              } as const)
            : ({
                type: "session.assistant_message",
                sessionId: sessionKey,
                message: t.message,
              } as const);
        printEvents([ev], json);
      }
    };
    await pump();
    if (watchInterrupted) {
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
      return EXIT.OK;
    }
    const pollMs = 1000;
    const handle = setInterval(() => {
      void pump().catch(() => undefined);
    }, pollMs);
    if (typeof handle.unref === "function") {
      handle.unref();
    }
    return await new Promise<number>((resolve) => {
      const shutdown = (): void => {
        watchInterrupted = true;
        clearInterval(handle);
        resolve(EXIT.OK);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
    });
  }

  if (sub === "run") {
    const stream = headlessStreamMode!;
    const prompt = runHeadlessPrompt!;
    const norm = new StreamNormalizerState();
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    const exit = await runHeadlessStreaming(
      buildHeadlessRunOptions(workspace, prompt, flags),
      (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        captureActivityEvents(events);
      },
    );
    await recordProcessResult(exit.code, exit.stderr, exit.stdout);
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "create") {
    try {
      const { chatId } = await createChat(workspace);
      const rec = repo.insertPendingChatRecord(chatId, workspace);
      if (json) {
        printJson({ record: rec, cursorChatId: chatId });
      } else {
        console.log(chatId);
      }
      return EXIT.OK;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      return EXIT.CURSOR;
    }
  }

  if (sub === "resume") {
    const stream = headlessStreamMode!;
    const sid = resumeSessionId!;
    const known = repo.resolveSessionKey(sid);
    const resumeWorkspace =
      explicitWorkspace ?? known?.workspacePath ?? workspace;
    const norm = new StreamNormalizerState();
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    await activityManager.recordSignal(sid, {
      source: "process",
      status: "running",
      observedAt: new Date().toISOString(),
      detail: "resume process started",
    });
    const exit = await resumeStreaming(
      buildResumeRunOptions(resumeWorkspace, sid, flags),
      (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        captureActivityEvents(events, sid);
      },
    );
    await recordProcessResult(exit.code, exit.stderr, exit.stdout, sid);
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "continue") {
    const rows = repo.listSessionsForWorkspace(workspace, 50);
    const latest = rows[0];
    if (
      latest === undefined ||
      (latest.localSessionId === undefined && latest.cursorChatId === undefined)
    ) {
      console.error("no session to continue");
      return EXIT.NOT_FOUND;
    }
    const sid = latest.localSessionId ?? latest.cursorChatId ?? "";
    const stream = headlessStreamMode!;
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    const norm = new StreamNormalizerState();
    await activityManager.recordSignal(sid, {
      source: "process",
      status: "running",
      observedAt: new Date().toISOString(),
      detail: "continue process started",
    });
    const exit = await resumeStreaming(
      buildResumeRunOptions(workspace, sid, flags),
      (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        captureActivityEvents(events, sid);
      },
    );
    await recordProcessResult(exit.code, exit.stderr, exit.stdout, sid);
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "attach") {
    const sid = pos[0];
    if (sid === undefined || sid.length === 0) {
      console.error("session attach: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(sid);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    const target = rec.cursorChatId ?? rec.localSessionId ?? sid;
    const attachWorkspace = explicitWorkspace ?? rec.workspacePath ?? workspace;
    const proc = spawn("cursor-agent", ["--resume", target], {
      cwd: attachWorkspace,
      stdio: "inherit",
    });
    try {
      const code = await new Promise<number>((resolve, reject) => {
        proc.once("close", (exitCode, signal) => {
          if (signal !== null) {
            resolve(EXIT.OK);
            return;
          }
          resolve(exitCode === 0 ? EXIT.OK : EXIT.CURSOR);
        });
        proc.once("error", reject);
      });
      return code;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      return EXIT.CURSOR;
    }
  }

  console.error(`Unknown session subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runGroup(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("group: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;

  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group create: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.createGroup(name);
    if (json) {
      printJson(g);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await groupsStore.listGroups();
    if (json) {
      printJson({ groups: rows });
    } else {
      for (const g of rows) {
        console.log(`${g.name}: ${g.workspaces.length} workspaces`);
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group show: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(JSON.stringify(g, null, 2));
    }
    return EXIT.OK;
  }
  if (sub === "pause") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group pause: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.pauseGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(`paused ${g.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "resume") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group resume: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.resumeGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(`resumed ${g.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "delete") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group delete: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (g.lastRun?.status === "running" && flags["force"] !== true) {
      console.error("group delete: latest run is running; use --force");
      return EXIT.ERR;
    }
    const deleted = await groupsStore.deleteGroup(name);
    if (deleted === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson({ deleted: true, group: deleted });
    } else {
      console.log(`deleted ${deleted.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "watch") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group watch: missing name");
      return EXIT.USAGE;
    }
    const intervalSeconds = parsePositiveIntegerFlag(flags, "interval", 2);
    if (intervalSeconds === undefined) {
      console.error("group watch: --interval must be a positive integer");
      return EXIT.USAGE;
    }
    const repo = await openRepo();
    try {
      await repo.importTranscriptsFromFilesystem();
      const activityManager = createActivityManager({ sessions: repo });
      while (true) {
        const g = await groupsStore.getGroup(name);
        if (g === undefined) {
          console.error("group not found");
          return EXIT.NOT_FOUND;
        }
        const snapshot = await deriveGroupProgressSnapshot(g, {
          getActivity: (sessionId) =>
            activityManager.getSessionActivity(sessionId),
          now: () => new Date().toISOString(),
        });
        if (json) {
          if (flags["once"] === true) {
            printJson(snapshot);
          } else {
            console.log(JSON.stringify(snapshot));
          }
        } else {
          renderGroupProgressHuman(snapshot);
        }
        if (
          flags["once"] === true ||
          snapshot.run === undefined ||
          isTerminalRunStatus(snapshot.run.status)
        ) {
          return EXIT.OK;
        }
        await sleep(intervalSeconds * 1000);
        await repo.importTranscriptsFromFilesystem();
      }
    } finally {
      repo.close();
    }
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group add: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await groupsStore.addWorkspaceToGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "remove") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group remove: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await groupsStore.removeWorkspaceFromGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group run: missing name");
      return EXIT.USAGE;
    }
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("group run: --prompt is required");
      return EXIT.USAGE;
    }
    const g = await groupsStore.getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (g.lifecycleState === "paused") {
      console.error("group run: group is paused");
      return EXIT.ERR;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("group run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const repo = await openRepo();
    const activityManager = createActivityManager({ sessions: repo });
    const activityClassifier = createActivitySignalClassifier();
    let groupWriteChain: Promise<void> = Promise.resolve();
    const enqueueGroupRunUpdate = (
      nextRun: GroupRunRecord,
      lifecycleState?: GroupLifecycleState,
    ): void => {
      groupWriteChain = groupWriteChain.then(async () => {
        await groupsStore.updateGroupRun(name, {
          ...(lifecycleState !== undefined ? { lifecycleState } : {}),
          lastRun: nextRun,
        });
      });
    };
    let run = initialRunRecord(g, prompt);
    enqueueGroupRunUpdate(run, "active");
    await groupWriteChain;
    for (const w of g.workspaces) {
      const latest = await groupsStore.getGroup(name);
      if (latest?.lifecycleState === "paused") {
        run = finishRunRecord(run, "paused");
        enqueueGroupRunUpdate(run, "paused");
        await groupWriteChain;
        return EXIT.OK;
      }
      const startedAt = new Date().toISOString();
      run = updateRunWorkspace(run, w, {
        status: "running",
        startedAt,
      });
      enqueueGroupRunUpdate(run);
      await groupWriteChain;
      const norm = new StreamNormalizerState();
      const textState: TextStreamRenderState = {
        lastAssistantBySession: new Map(),
      };
      let activityWriteChain: Promise<void> = Promise.resolve();
      let lastSessionId: string | undefined;
      const enqueueActivitySignal = (
        sessionId: string | undefined,
        signal: ActivitySignal | null,
      ): void => {
        activityWriteChain = activityWriteChain.then(() =>
          recordActivitySignal(activityManager, sessionId, signal),
        );
      };
      const exit = await runHeadlessStreamingImpl(
        buildHeadlessRunOptions(resolve(w), prompt, flags),
        (line) => {
          const events = norm.processLine(line);
          emitStreamedAgentEvents(stream, events, textState);
          for (const event of events) {
            const sessionId = sessionIdFromEvent(event);
            if (sessionId !== undefined) {
              lastSessionId = sessionId;
              run = updateRunWorkspace(run, w, {
                localSessionId: sessionId,
                status: "running",
              });
              enqueueGroupRunUpdate(run);
            }
            enqueueActivitySignal(
              sessionId,
              activityClassifier.classifyStreamEvent(event),
            );
          }
        },
      );
      const completedAt = new Date().toISOString();
      const workspaceUpdate: Partial<GroupRunWorkspaceRecord> = {
        status: exit.code === 0 || exit.code === null ? "completed" : "failed",
        completedAt,
      };
      if (exit.code !== null) {
        run = updateRunWorkspace(run, w, {
          ...workspaceUpdate,
          exitCode: exit.code,
        });
      } else {
        run = updateRunWorkspace(run, w, workspaceUpdate);
      }
      enqueueGroupRunUpdate(run);
      await groupWriteChain;
      enqueueActivitySignal(
        lastSessionId,
        activityClassifier.classifyProcessResult(
          exit.code,
          exit.stderr,
          exit.stdout,
        ),
      );
      await activityWriteChain;
      if (isTrustFailureMessage(exit.stderr)) {
        run = finishRunRecord(run, "failed");
        enqueueGroupRunUpdate(run, "failed");
        await groupWriteChain;
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        run = finishRunRecord(run, "failed");
        enqueueGroupRunUpdate(run, "failed");
        await groupWriteChain;
        console.error(exit.stderr || `run failed in ${w}`);
        return EXIT.CURSOR;
      }
      await repo.importTranscriptsFromFilesystem();
    }
    run = finishRunRecord(run, "completed");
    enqueueGroupRunUpdate(run, "completed");
    await groupWriteChain;
    return EXIT.OK;
  }

  console.error(`Unknown group subcommand: ${sub}`);
  return EXIT.USAGE;
}

function isQueueItemStatus(value: string): value is QueueItemStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  );
}

function isOperatorQueueItemStatus(value: string): value is QueueItemStatus {
  return (
    value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  );
}

function isQueueItemMode(value: string): value is QueueItemMode {
  return value === "auto" || value === "manual";
}

function parseQueueIndex(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const value = flags[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function runQueue(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("queue: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;

  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue create: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    const q = await queuesStore.createQueue(name, ws);
    if (json) {
      printJson(q);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await queuesStore.listQueues();
    if (json) {
      printJson({ queues: rows });
    } else {
      const repo = await openRepo();
      try {
        const activityManager = createActivityManager({ sessions: repo });
        await repo.importTranscriptsFromFilesystem();
        for (const q of rows) {
          const snapshot = await deriveQueueProgressSnapshot(q, {
            getActivity: (sessionId) =>
              activityManager.getSessionActivity(sessionId),
            now: () => new Date().toISOString(),
          });
          console.log(renderQueueProgressLine(snapshot));
        }
      } finally {
        repo.close();
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue show: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      const repo = await openRepo();
      try {
        const activityManager = createActivityManager({ sessions: repo });
        await repo.importTranscriptsFromFilesystem();
        const snapshot = await deriveQueueProgressSnapshot(q, {
          getActivity: (sessionId) =>
            activityManager.getSessionActivity(sessionId),
          now: () => new Date().toISOString(),
        });
        renderQueueProgressHuman(snapshot);
      } finally {
        repo.close();
      }
    }
    return EXIT.OK;
  }
  if (sub === "pause") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue pause: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.pauseQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`paused ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "resume") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue resume: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.resumeQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`resumed ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "delete") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue delete: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (q.lastRun?.status === "running" && flags["force"] !== true) {
      console.error("queue delete: latest run is running; use --force");
      return EXIT.ERR;
    }
    const deleted = await queuesStore.deleteQueue(name);
    if (deleted === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson({ deleted: true, queue: deleted });
    } else {
      console.log(`deleted ${deleted.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "update") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue update: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue update: --item is required");
      return EXIT.USAGE;
    }
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    const rawStatus = flags["status"];
    if (
      rawStatus !== undefined &&
      (typeof rawStatus !== "string" || !isOperatorQueueItemStatus(rawStatus))
    ) {
      console.error(
        "queue update: --status must be pending, completed, failed, or skipped",
      );
      return EXIT.USAGE;
    }
    if (prompt === undefined && rawStatus === undefined) {
      console.error("queue update: --prompt or --status is required");
      return EXIT.USAGE;
    }
    const q = await queuesStore.updateQueueItem(name, item, {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(typeof rawStatus === "string" && isQueueItemStatus(rawStatus)
        ? { status: rawStatus }
        : {}),
    });
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (!q.items.some((queueItem) => queueItem.id === item)) {
      console.error("queue item not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`updated ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "move") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue move: missing name");
      return EXIT.USAGE;
    }
    const from = parseQueueIndex(flags, "from");
    const to = parseQueueIndex(flags, "to");
    if (from === undefined || to === undefined) {
      console.error("queue move: --from and --to must be zero-based indexes");
      return EXIT.USAGE;
    }
    const before = await queuesStore.getQueue(name);
    if (before === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (
      from >= before.items.length ||
      to >= before.items.length ||
      before.items.length === 0
    ) {
      console.error("queue move: index out of range");
      return EXIT.USAGE;
    }
    const q = await queuesStore.moveQueueItem(name, from, to);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`moved ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "mode") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue mode: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue mode: --item is required");
      return EXIT.USAGE;
    }
    const mode = flags["mode"];
    if (typeof mode !== "string" || !isQueueItemMode(mode)) {
      console.error("queue mode: --mode must be auto or manual");
      return EXIT.USAGE;
    }
    const q = await queuesStore.updateQueueItem(name, item, { mode });
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (!q.items.some((queueItem) => queueItem.id === item)) {
      console.error("queue item not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`set ${item} mode=${mode}`);
    }
    return EXIT.OK;
  }
  if (sub === "stop") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue stop: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.requestQueueStop(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`stopped ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue add: missing name");
      return EXIT.USAGE;
    }
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("queue add: --prompt is required");
      return EXIT.USAGE;
    }
    await queuesStore.addQueueItem(name, prompt);
    return EXIT.OK;
  }
  if (sub === "remove") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue remove: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue remove: --item is required");
      return EXIT.USAGE;
    }
    await queuesStore.removeQueueItem(name, item);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue run: missing name");
      return EXIT.USAGE;
    }
    const initialQueue = await queuesStore.getQueue(name);
    if (initialQueue === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (initialQueue.lifecycleState === "paused") {
      console.error("queue run: queue is paused");
      return EXIT.ERR;
    }
    if (initialQueue.lifecycleState === "stopped") {
      console.error("queue run: queue is stopped; resume before running");
      return EXIT.ERR;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("queue run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const repo = await openRepo();
    const activityManager = createActivityManager({ sessions: repo });
    const activityClassifier = createActivitySignalClassifier();
    let queueWriteChain: Promise<void> = Promise.resolve();
    const enqueueQueueRunUpdate = (
      run: QueueRunRecord,
      lifecycleState?: QueueRecord["lifecycleState"],
      items?: readonly QueueItemRecord[],
    ): void => {
      queueWriteChain = queueWriteChain.then(async () => {
        await queuesStore.updateQueueRun(name, {
          ...(lifecycleState !== undefined ? { lifecycleState } : {}),
          lastRun: run,
          ...(items !== undefined ? { items } : {}),
        });
      });
    };
    let run = initialQueueRunRecord(initialQueue);
    enqueueQueueRunUpdate(run, "active");
    await queueWriteChain;
    for (const item of initialQueue.items) {
      if (item.status !== "pending" || item.mode === "manual") {
        continue;
      }
      const latest = await queuesStore.getQueue(name);
      if (latest === undefined) {
        console.error("queue not found");
        return EXIT.NOT_FOUND;
      }
      if (latest.lifecycleState === "paused") {
        run = finishQueueRunRecord(run, "paused");
        enqueueQueueRunUpdate(run, "paused");
        await queueWriteChain;
        return EXIT.OK;
      }
      if (
        latest.lifecycleState === "stopped" ||
        latest.stopRequestedAt !== undefined
      ) {
        run = finishQueueRunRecord(run, "stopped");
        enqueueQueueRunUpdate(run, "stopped");
        await queueWriteChain;
        return EXIT.OK;
      }
      const startedAt = new Date().toISOString();
      let currentItems = latest.items.map((queueItem) =>
        queueItem.id === item.id
          ? {
              ...queueItem,
              status: "running" as const,
              startedAt,
              updatedAt: startedAt,
            }
          : queueItem,
      );
      run = updateQueueRunItem(run, item.id, "running");
      enqueueQueueRunUpdate(run, undefined, currentItems);
      await queueWriteChain;
      const norm = new StreamNormalizerState();
      const textState: TextStreamRenderState = {
        lastAssistantBySession: new Map(),
      };
      let activityWriteChain: Promise<void> = Promise.resolve();
      let lastSessionId: string | undefined;
      const enqueueActivitySignal = (
        sessionId: string | undefined,
        signal: ActivitySignal | null,
      ): void => {
        activityWriteChain = activityWriteChain.then(() =>
          recordActivitySignal(activityManager, sessionId, signal),
        );
      };
      const exit = await runHeadlessStreamingImpl(
        buildHeadlessRunOptions(initialQueue.workspace, item.prompt, flags),
        (line) => {
          const events = norm.processLine(line);
          emitStreamedAgentEvents(stream, events, textState);
          for (const event of events) {
            const sessionId = sessionIdFromEvent(event);
            if (sessionId !== undefined) {
              lastSessionId = sessionId;
              currentItems = currentItems.map((queueItem) =>
                queueItem.id === item.id
                  ? {
                      ...queueItem,
                      localSessionId: sessionId,
                      updatedAt: new Date().toISOString(),
                    }
                  : queueItem,
              );
              enqueueQueueRunUpdate(run, undefined, currentItems);
            }
            enqueueActivitySignal(
              sessionId,
              activityClassifier.classifyStreamEvent(event),
            );
          }
        },
      );
      enqueueActivitySignal(
        lastSessionId,
        activityClassifier.classifyProcessResult(
          exit.code,
          exit.stderr,
          exit.stdout,
        ),
      );
      await activityWriteChain;
      const completedAt = new Date().toISOString();
      const itemStatus =
        exit.code === 0 || exit.code === null ? "completed" : "failed";
      currentItems = currentItems.map((queueItem) =>
        queueItem.id === item.id
          ? {
              ...queueItem,
              status: itemStatus,
              completedAt,
              updatedAt: completedAt,
              result: { exitCode: exit.code },
            }
          : queueItem,
      );
      run = updateQueueRunItem(run, item.id, itemStatus);
      enqueueQueueRunUpdate(run, undefined, currentItems);
      await queueWriteChain;
      if (isTrustFailureMessage(exit.stderr)) {
        run = finishQueueRunRecord(run, "failed");
        enqueueQueueRunUpdate(run, "failed");
        await queueWriteChain;
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        run = finishQueueRunRecord(run, "failed");
        enqueueQueueRunUpdate(run, "failed");
        await queueWriteChain;
        console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
        return EXIT.CURSOR;
      }
      await repo.importTranscriptsFromFilesystem();
    }
    run = finishQueueRunRecord(run, "completed");
    enqueueQueueRunUpdate(run, "completed");
    await queueWriteChain;
    return EXIT.OK;
  }

  console.error(`Unknown queue subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runSkill(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("skill: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;
  const workspace = getWorkspace(flags);

  if (sub === "list") {
    const rows = await listSkillRecords({ projectRoot: workspace });
    if (json) {
      printJson({ skills: rows });
    } else {
      for (const s of rows) {
        const desc = s.description !== undefined ? `  ${s.description}` : "";
        console.log(`[${s.scope}] ${s.name}${desc}`);
      }
    }
    return EXIT.OK;
  }

  if (sub === "show") {
    const name = pos[0];
    if (name === undefined || name.length === 0) {
      console.error("skill show: missing name");
      return EXIT.USAGE;
    }
    const rec = await findSkillByName(name, { projectRoot: workspace });
    if (rec === undefined) {
      console.error("skill not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(rec);
    } else {
      console.log(`name: ${rec.name}`);
      console.log(`scope: ${rec.scope}`);
      console.log(`path: ${rec.path}`);
      console.log(`disableModelInvocation: ${rec.disableModelInvocation}`);
      if (rec.description !== undefined) {
        console.log(`description: ${rec.description}`);
      }
    }
    return EXIT.OK;
  }

  console.error(`Unknown skill subcommand: ${sub}`);
  return EXIT.USAGE;
}
