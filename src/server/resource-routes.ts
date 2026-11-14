import { join } from "node:path";

import type { ActivityManager } from "../activity/manager";
import { createActivityManager } from "../activity/manager";
import {
  BookmarkInputError,
  BookmarkNotFoundError,
  createBookmarkManager,
  type BookmarkManager,
} from "../bookmarks/manager";
import {
  createAiTrackingAnalyticsReader,
  createAiTrackingFileReader,
} from "../cursor/ai-tracking-reader";
import {
  createFileIntelligenceService,
  FileIntelligenceNotFoundError,
  type FileIntelligenceService,
} from "../file-intelligence";
import { deriveGroupProgressSnapshot } from "../group/progress";
import {
  addWorkspaceToGroup,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  pauseGroup,
  removeWorkspaceFromGroup,
  resumeGroup,
} from "../persistence/groups-store";
import { FileIntelligenceIndex } from "../persistence/file-intelligence-index";
import {
  addQueueItem,
  createQueue,
  deleteQueue,
  getQueue,
  listQueues,
  moveQueueItem,
  pauseQueue,
  removeQueueItem,
  resumeQueue,
  updateQueueItem,
} from "../persistence/queues-store";
import { RepositoryAnalyticsIndex } from "../persistence/repository-analytics-index";
import type { SessionIndexRepository } from "../persistence/session-index";
import {
  createRepositoryAnalyticsService,
  type RepositoryAnalyticsService,
} from "../repository-analytics";
import { isBookmarkType, type CreateBookmarkInput } from "../types/bookmark";
import type { CursorSessionRecord } from "../types/session-record";
import { HttpError, jsonResponse } from "./http-errors";
import {
  parseOptionalPositiveInteger,
  parseOptionalString,
  parsePositiveInteger,
  parseRequiredString,
} from "./request";
import type { HttpServerConfig } from "./types";

export interface ResourceServices {
  readonly bookmarks: BookmarkManager;
  readonly activity: ActivityManager;
  readonly files: FileIntelligenceService;
  readonly fileIndex: FileIntelligenceIndex;
  readonly analytics: RepositoryAnalyticsService;
}

export interface ResourceRouteContext {
  readonly config: HttpServerConfig;
  readonly startedAt: Date;
  readonly sessions: SessionIndexRepository;
  readonly resources: ResourceServices;
}

export function createResourceServices(
  config: HttpServerConfig,
  sessions: SessionIndexRepository,
): ResourceServices {
  const fileIndex = new FileIntelligenceIndex(
    join(config.dataDir, "file-intelligence.db"),
  );
  const aiDb = join(config.cursorHome, "ai-tracking", "ai-code-tracking.db");
  const aiTracking = createAiTrackingFileReader(aiDb);
  const analyticsIndex = new RepositoryAnalyticsIndex(
    join(config.dataDir, "repository-analytics.db"),
  );
  const files = createFileIntelligenceService({
    sessions,
    aiTracking,
    index: fileIndex,
  });
  const analytics = createRepositoryAnalyticsService({
    sessions,
    aiTracking: createAiTrackingAnalyticsReader(aiDb),
    fileIntelligence: files,
    fileIndex,
    analyticsIndex,
  });
  return {
    bookmarks: createBookmarkManager({ sessions }),
    activity: createActivityManager({ sessions }),
    files,
    fileIndex,
    analytics,
  };
}

/**
 * Decodes a single URL path segment (no unescaped "/"). Rejects dot segments and
 * NUL bytes so resource ids cannot alias traversal-like names after decoding.
 */
export function decodeResourceUrlSegment(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw);
    if (
      decoded.length === 0 ||
      decoded.includes("/") ||
      decoded.includes("\0") ||
      decoded === "." ||
      decoded === ".."
    ) {
      throw new HttpError("INVALID_REQUEST", "invalid path segment");
    }
    return decoded;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError("INVALID_REQUEST", "invalid path segment");
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError("INVALID_REQUEST", "invalid JSON body");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = body[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function readStringArrayField(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = body[key];
  if (!Array.isArray(v)) {
    return undefined;
  }
  return v.filter((item): item is string => typeof item === "string");
}

function httpErrorFromPersistenceMessage(message: string): HttpError {
  if (message.includes("already exists")) {
    return new HttpError("CONFLICT", message);
  }
  if (message.includes("not found")) {
    return new HttpError("NOT_FOUND", message);
  }
  return new HttpError("INTERNAL_ERROR", message);
}

function catchPersistence<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof Error) {
      throw httpErrorFromPersistenceMessage(error.message);
    }
    throw error;
  });
}

export function isDelegatedResourcePath(pathname: string): boolean {
  return (
    pathname === "/api/repository/analytics" ||
    pathname.startsWith("/api/groups") ||
    pathname.startsWith("/api/queues") ||
    pathname.startsWith("/api/bookmarks") ||
    pathname.startsWith("/api/files/") ||
    pathname === "/api/activity" ||
    pathname.startsWith("/api/activity/")
  );
}

function mapDomainError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof BookmarkInputError) {
    return new HttpError("INVALID_REQUEST", error.message);
  }
  if (error instanceof BookmarkNotFoundError) {
    return new HttpError("NOT_FOUND", error.message);
  }
  if (error instanceof FileIntelligenceNotFoundError) {
    return new HttpError("NOT_FOUND", error.message);
  }
  if (error instanceof Error) {
    return httpErrorFromPersistenceMessage(error.message);
  }
  return new HttpError("INTERNAL_ERROR", "unexpected error");
}

async function refreshSessions(
  repository: SessionIndexRepository,
): Promise<void> {
  await repository.importTranscriptsFromFilesystem();
}

function bucketSessions(sessions: readonly CursorSessionRecord[]): {
  readonly byStatus: Record<string, number>;
  readonly byIdentityState: Record<string, number>;
} {
  const byStatus: Record<string, number> = {};
  const byIdentityState: Record<string, number> = {};
  for (const s of sessions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byIdentityState[s.identityState] =
      (byIdentityState[s.identityState] ?? 0) + 1;
  }
  return { byStatus, byIdentityState };
}

function bucketLifecycle<T extends { readonly lifecycleState: string }>(
  records: readonly T[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    out[r.lifecycleState] = (out[r.lifecycleState] ?? 0) + 1;
  }
  return out;
}

export async function dispatchResourceRoutes(
  request: Request,
  ctx: ResourceRouteContext,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (!isDelegatedResourcePath(pathname)) {
    return undefined;
  }

  const { sessions, resources } = ctx;

  try {
    if (pathname === "/api/repository/analytics" && request.method === "GET") {
      await refreshSessions(sessions);
      const allSessions = sessions.listSessions(500_000);
      const groups = await listGroups();
      const queues = await listQueues();
      const bookmarks = await resources.bookmarks.list();
      const activities = await resources.activity.listActivity({
        limit: 50_000,
      });
      const fileStats = resources.fileIndex.getStats();
      const gitSummary = await resources.analytics.getSummary();
      return jsonResponse({
        sessions: {
          total: allSessions.length,
          ...bucketSessions(allSessions),
          provenance: "index",
        },
        groups: {
          total: groups.length,
          lifecycle: bucketLifecycle(groups),
        },
        queues: {
          total: queues.length,
          lifecycle: bucketLifecycle(queues),
        },
        bookmarks: {
          total: bookmarks.length,
        },
        activity: {
          total: activities.length,
          buckets: activities.reduce<Record<string, number>>((acc, a) => {
            acc[a.status] = (acc[a.status] ?? 0) + 1;
            return acc;
          }, {}),
        },
        fileIndex: fileStats,
        gitDerived: gitSummary,
        generatedAt: new Date().toISOString(),
        provenance: ["index", "local_stores"],
      });
    }

    if (pathname.startsWith("/api/groups")) {
      return await dispatchGroupRoutes(request, ctx);
    }
    if (pathname.startsWith("/api/queues")) {
      return await dispatchQueueRoutes(request);
    }
    if (pathname.startsWith("/api/bookmarks")) {
      await refreshSessions(sessions);
      return await dispatchBookmarkRoutes(request, resources.bookmarks);
    }
    if (pathname.startsWith("/api/files/")) {
      await refreshSessions(sessions);
      return await dispatchFileRoutes(request, resources.files);
    }
    if (pathname === "/api/activity" || pathname.startsWith("/api/activity/")) {
      await refreshSessions(sessions);
      return await dispatchActivityRoutes(
        request,
        resources.activity,
        sessions,
      );
    }

    return undefined;
  } catch (error) {
    throw mapDomainError(error);
  }
}

async function dispatchGroupRoutes(
  request: Request,
  ctx: ResourceRouteContext,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const { resources } = ctx;

  if (pathname === "/api/groups") {
    if (request.method === "GET") {
      const items = await listGroups();
      return jsonResponse({
        items,
        total: items.length,
        provenance: "groups_store",
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const name = readStringField(body, "name");
      if (name === undefined) {
        throw new HttpError("INVALID_REQUEST", "name is required");
      }
      const group = await catchPersistence(createGroup(name));
      const workspaces = readStringArrayField(body, "workspaces");
      let updated = group;
      if (workspaces !== undefined) {
        for (const w of workspaces) {
          updated = await catchPersistence(addWorkspaceToGroup(name, w));
        }
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  const prefix = "/api/groups/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const rest = pathname.slice(prefix.length);
  const segments = rest.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const groupName = decodeResourceUrlSegment(segments[0] ?? "");

  if (segments.length === 1) {
    if (request.method === "GET") {
      const group = await getGroup(groupName);
      if (group === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: group, provenance: "groups_store" });
    }
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      let updated = await getGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      const remove = readStringArrayField(body, "removeWorkspaces");
      if (remove !== undefined) {
        for (const w of remove) {
          updated = await catchPersistence(
            removeWorkspaceFromGroup(groupName, w),
          );
        }
      }
      const add = readStringArrayField(body, "addWorkspaces");
      if (add !== undefined) {
        for (const w of add) {
          updated = await catchPersistence(addWorkspaceToGroup(groupName, w));
        }
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteGroup(groupName);
      if (deleted === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({
        deleted: true,
        data: deleted,
        provenance: "groups_store",
      });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  if (segments.length === 2) {
    const action = segments[1];
    if (action === "progress") {
      if (request.method !== "GET") {
        throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
      }
      const group = await getGroup(groupName);
      if (group === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      const snapshot = await deriveGroupProgressSnapshot(group, {
        getActivity: (id) => resources.activity.getSessionActivity(id),
        now: () => new Date().toISOString(),
      });
      return jsonResponse({ data: snapshot, provenance: "group_progress" });
    }
    if (action === "pause" && request.method === "POST") {
      const updated = await pauseGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (action === "resume" && request.method === "POST") {
      const updated = await resumeGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (action === "runs" && request.method === "POST") {
      throw new HttpError(
        "NOT_IMPLEMENTED",
        "group runs are not available via HTTP; use the CLI `group run` command",
      );
    }
  }

  throw new HttpError("NOT_FOUND", "route not found");
}

async function dispatchQueueRoutes(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/queues") {
    if (request.method === "GET") {
      const items = await listQueues();
      return jsonResponse({
        items,
        total: items.length,
        provenance: "queues_store",
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const name = readStringField(body, "name");
      const workspace = readStringField(body, "workspace");
      if (name === undefined || workspace === undefined) {
        throw new HttpError(
          "INVALID_REQUEST",
          "name and workspace are required",
        );
      }
      const queue = await catchPersistence(createQueue(name, workspace));
      return jsonResponse({ data: queue, provenance: "queues_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  const prefix = "/api/queues/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const rest = pathname.slice(prefix.length);
  const segments = rest.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const queueName = decodeResourceUrlSegment(segments[0] ?? "");

  if (segments.length === 1) {
    if (request.method === "GET") {
      const queue = await getQueue(queueName);
      if (queue === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: queue, provenance: "queues_store" });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteQueue(queueName);
      if (deleted === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({
        deleted: true,
        data: deleted,
        provenance: "queues_store",
      });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  if (
    segments.length === 2 &&
    segments[1] === "items" &&
    request.method === "POST"
  ) {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new HttpError("INVALID_REQUEST", "expected object body");
    }
    const prompt = readStringField(body, "prompt");
    if (prompt === undefined) {
      throw new HttpError("INVALID_REQUEST", "prompt is required");
    }
    const updated = await catchPersistence(addQueueItem(queueName, prompt));
    return jsonResponse({ data: updated, provenance: "queues_store" });
  }

  if (segments.length === 3 && segments[1] === "items") {
    const itemId = decodeResourceUrlSegment(segments[2] ?? "");
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const patch: {
        prompt?: string;
        status?: "pending" | "completed" | "failed" | "skipped" | "running";
        mode?: "auto" | "manual";
      } = {};
      const p = readStringField(body, "prompt");
      if (p !== undefined) {
        patch.prompt = p;
      }
      const st = readStringField(body, "status");
      if (
        st === "pending" ||
        st === "completed" ||
        st === "failed" ||
        st === "skipped" ||
        st === "running"
      ) {
        patch.status = st;
      }
      const mode = readStringField(body, "mode");
      if (mode === "auto" || mode === "manual") {
        patch.mode = mode;
      }
      const updated = await catchPersistence(
        updateQueueItem(queueName, itemId, patch),
      );
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue or item not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (request.method === "DELETE") {
      const updated = await catchPersistence(
        removeQueueItem(queueName, itemId),
      );
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
  }

  if (
    segments.length === 4 &&
    segments[1] === "items" &&
    segments[3] === "move" &&
    request.method === "POST"
  ) {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new HttpError("INVALID_REQUEST", "expected object body");
    }
    const from = body["from"];
    const to = body["to"];
    if (typeof from !== "number" || typeof to !== "number") {
      throw new HttpError(
        "INVALID_REQUEST",
        "from and to must be numeric indices",
      );
    }
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < 0
    ) {
      throw new HttpError("INVALID_REQUEST", "invalid from/to indices");
    }
    const updated = await catchPersistence(moveQueueItem(queueName, from, to));
    if (updated === undefined) {
      throw new HttpError("NOT_FOUND", "queue not found");
    }
    return jsonResponse({ data: updated, provenance: "queues_store" });
  }

  if (segments.length === 2) {
    const action = segments[1];
    if (action === "pause" && request.method === "POST") {
      const updated = await pauseQueue(queueName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (action === "resume" && request.method === "POST") {
      const updated = await resumeQueue(queueName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (action === "runs" && request.method === "POST") {
      throw new HttpError(
        "NOT_IMPLEMENTED",
        "queue runs are not available via HTTP; use the CLI `queue run` command",
      );
    }
  }

  throw new HttpError("NOT_FOUND", "route not found");
}

async function dispatchBookmarkRoutes(
  request: Request,
  bookmarks: BookmarkManager,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/bookmarks") {
    if (request.method === "GET") {
      const sessionId = parseOptionalString(url, "session");
      const typeRaw = parseOptionalString(url, "type");
      const tag = parseOptionalString(url, "tag");
      if (typeRaw !== undefined && !isBookmarkType(typeRaw)) {
        throw new HttpError("INVALID_REQUEST", "invalid bookmark type filter");
      }
      const filter =
        sessionId === undefined && typeRaw === undefined && tag === undefined
          ? undefined
          : {
              ...(sessionId !== undefined ? { sessionId } : {}),
              ...(typeRaw !== undefined ? { type: typeRaw } : {}),
              ...(tag !== undefined ? { tag } : {}),
            };
      const items = await bookmarks.list(filter);
      return jsonResponse({
        items,
        total: items.length,
        provenance: "bookmarks_store",
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const typeField = readStringField(body, "type");
      if (typeField === undefined || !isBookmarkType(typeField)) {
        throw new HttpError(
          "INVALID_REQUEST",
          "type must be one of: session, message, range",
        );
      }
      const sessionId = readStringField(body, "sessionId");
      if (sessionId === undefined) {
        throw new HttpError("INVALID_REQUEST", "sessionId is required");
      }
      const name = readStringField(body, "name");
      if (name === undefined) {
        throw new HttpError("INVALID_REQUEST", "name is required");
      }
      const messageId = readStringField(body, "messageId");
      const fromMessageId = readStringField(body, "fromMessageId");
      const toMessageId = readStringField(body, "toMessageId");
      const description = readStringField(body, "description");
      const tags = readStringArrayField(body, "tags");
      const input: CreateBookmarkInput = {
        type: typeField,
        sessionId,
        name,
        ...(messageId !== undefined ? { messageId } : {}),
        ...(fromMessageId !== undefined ? { fromMessageId } : {}),
        ...(toMessageId !== undefined ? { toMessageId } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(tags !== undefined ? { tags } : {}),
      };
      const created = await bookmarks.add(input);
      return jsonResponse({ data: created, provenance: "bookmarks_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }

  if (pathname === "/api/bookmarks/search") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const q = parseRequiredString(url, "q");
    const limit = parseOptionalPositiveInteger(url, "limit") ?? 20;
    const result = await bookmarks.search(q, { limit });
    return jsonResponse({ ...result, provenance: "bookmarks_store" });
  }

  const prefix = "/api/bookmarks/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const id = decodeResourceUrlSegment(pathname.slice(prefix.length));
  if (id === "search" || id.includes("/")) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  if (request.method === "GET") {
    const record = await bookmarks.show(id);
    if (record === null) {
      throw new HttpError("NOT_FOUND", "bookmark not found");
    }
    return jsonResponse({ data: record, provenance: "bookmarks_store" });
  }
  if (request.method === "DELETE") {
    const ok = await bookmarks.delete(id);
    if (!ok) {
      throw new HttpError("NOT_FOUND", "bookmark not found");
    }
    return jsonResponse({
      deleted: true,
      data: { id },
      provenance: "bookmarks_store",
    });
  }
  throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
}

async function dispatchFileRoutes(
  request: Request,
  files: FileIntelligenceService,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/files/rebuild") {
    if (request.method !== "POST") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const stats = await files.rebuild();
    return jsonResponse({ data: stats, provenance: "file_intelligence" });
  }
  if (pathname === "/api/files/find") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const pathQuery = parseRequiredString(url, "path");
    const result = await files.findFile(pathQuery);
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }

  const sessionsPrefix = "/api/files/sessions/";
  if (!pathname.startsWith(sessionsPrefix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const after = pathname.slice(sessionsPrefix.length);
  const parts = after.split("/").filter((s) => s.length > 0);
  if (parts.length < 1) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const sessionId = decodeResourceUrlSegment(parts[0] ?? "");
  if (parts.length === 1) {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const summary = await files.listFiles(sessionId);
    return jsonResponse({ ...summary, provenance: "file_intelligence" });
  }
  if (parts.length === 2 && parts[1] === "snapshots") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const include =
      parseOptionalString(url, "includeContent") === "true" ||
      url.searchParams.get("includeContent") === "1";
    const result = await files.listSnapshots(sessionId, {
      includeContent: include,
    });
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }
  if (parts.length === 2 && parts[1] === "deleted") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const result = await files.listDeleted(sessionId);
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }

  throw new HttpError("NOT_FOUND", "route not found");
}

async function dispatchActivityRoutes(
  request: Request,
  activity: ActivityManager,
  sessions: SessionIndexRepository,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/activity") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const status = parseOptionalString(url, "status");
    const limit = parsePositiveInteger(url, "limit", 50);
    const validStatuses = new Set([
      "idle",
      "running",
      "waiting_trust",
      "waiting_input",
      "completed",
      "failed",
    ]);
    const st =
      status !== undefined && validStatuses.has(status)
        ? (status as
            | "idle"
            | "running"
            | "waiting_trust"
            | "waiting_input"
            | "completed"
            | "failed")
        : undefined;
    const items = await activity.listActivity(
      st === undefined ? { limit } : { status: st, limit },
    );
    return jsonResponse({
      items,
      total: items.length,
      provenance: "activity_store",
    });
  }

  const prefix = "/api/activity/sessions/";
  if (!pathname.startsWith(prefix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const sessionId = decodeResourceUrlSegment(pathname.slice(prefix.length));
  if (sessionId.includes("/")) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  if (request.method !== "GET") {
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  if (sessions.resolveSessionKey(sessionId) === undefined) {
    throw new HttpError("NOT_FOUND", "session not found");
  }
  const detail = await activity.getSessionActivity(sessionId);
  if (detail === null) {
    return jsonResponse({
      sessionId,
      activity: null,
      provenance: "activity_store",
    });
  }
  return jsonResponse({ data: detail, provenance: "activity_store" });
}
