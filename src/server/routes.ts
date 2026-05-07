import { readTranscriptFile } from "../cursor/transcript-reader";
import {
  createTranscriptSearchService,
  DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
} from "../cursor/transcript-search";
import type { SessionIndexRepository } from "../persistence/session-index";
import {
  HttpError,
  errorResponse,
  jsonResponse,
  toHttpError,
} from "./http-errors";
import {
  parseNonNegativeInteger,
  parseOptionalPositiveInteger,
  parseOptionalString,
  parsePositiveInteger,
  parseRequiredString,
  parseTranscriptRole,
  requireBearerAuth,
} from "./request";
import type { HttpServerConfig } from "./types";

export interface RouteContext {
  readonly config: HttpServerConfig;
  readonly startedAt: Date;
  readonly sessions: SessionIndexRepository;
}

const API_VERSION = "v1";

function sessionIdentifierFromPath(pathname: string, suffix = ""): string {
  const prefix = "/api/sessions/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError("INVALID_REQUEST", "invalid session id");
  }
  if (decoded.length === 0 || decoded.includes("/")) {
    throw new HttpError("INVALID_REQUEST", "invalid session id");
  }
  return decoded;
}

async function refreshSessions(
  repository: SessionIndexRepository,
): Promise<void> {
  await repository.importTranscriptsFromFilesystem();
}

async function dispatchGet(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      uptimeSeconds: Math.max(
        0,
        Math.floor((Date.now() - context.startedAt.getTime()) / 1000),
      ),
      startedAt: context.startedAt.toISOString(),
      now: new Date().toISOString(),
      version: context.config.packageVersion,
    });
  }

  if (pathname === "/api/version") {
    return jsonResponse({
      packageName: "curort-cli-agent",
      packageVersion: context.config.packageVersion,
      apiVersion: API_VERSION,
    });
  }

  if (pathname === "/api/sessions") {
    await refreshSessions(context.sessions);
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const workspace = parseOptionalString(url, "workspace");
    const sessions =
      workspace === undefined
        ? context.sessions.listSessions(limit + offset)
        : context.sessions.listSessionsForWorkspace(workspace, limit + offset);
    return jsonResponse({
      sessions: sessions.slice(offset, offset + limit),
      total: sessions.length,
      offset,
      limit,
      provenance: "index",
    });
  }

  if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/messages")) {
    await refreshSessions(context.sessions);
    const sessionId = sessionIdentifierFromPath(pathname, "/messages");
    const session = context.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    if (session.transcriptPath === undefined) {
      return jsonResponse({
        session,
        messages: [],
        total: 0,
        provenance: "transcript",
      });
    }
    const transcript = await readTranscriptFile(session.transcriptPath);
    return jsonResponse({
      session,
      messages: transcript.lines.map((line, index) => ({
        id: `event-${index}-${line.role}`,
        role: line.role,
        message: line.message,
      })),
      total: transcript.lines.length,
      provenance: "transcript",
    });
  }

  if (pathname.startsWith("/api/sessions/")) {
    await refreshSessions(context.sessions);
    const sessionId = sessionIdentifierFromPath(pathname);
    const session = context.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    return jsonResponse({ session, provenance: "index" });
  }

  if (pathname === "/api/search/sessions") {
    await refreshSessions(context.sessions);
    const q = parseRequiredString(url, "q");
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const workspace = parseOptionalString(url, "workspace");
    const result = context.sessions.searchSessions({
      query: q,
      limit,
      offset,
      filters: {
        ...(workspace !== undefined ? { workspace } : {}),
      },
    });
    return jsonResponse(result);
  }

  if (pathname === "/api/search/transcripts") {
    await refreshSessions(context.sessions);
    const q = parseRequiredString(url, "q");
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const sessionId = parseOptionalString(url, "session");
    const role = parseTranscriptRole(url);
    const maxSessions = parseOptionalPositiveInteger(url, "maxSessions");
    const maxBytes = parseOptionalPositiveInteger(url, "maxBytes");
    const maxEvents = parseOptionalPositiveInteger(url, "maxEvents");
    const result = await createTranscriptSearchService(context.sessions).search(
      {
        query: q,
        limit,
        offset,
        timeoutMs: DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(maxSessions !== undefined ? { maxSessions } : {}),
        ...(maxBytes !== undefined ? { maxBytes } : {}),
        ...(maxEvents !== undefined ? { maxEvents } : {}),
      },
    );
    return jsonResponse(result);
  }

  throw new HttpError("NOT_FOUND", "route not found");
}

function isKnownPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/version" ||
    pathname === "/api/sessions" ||
    pathname.startsWith("/api/sessions/") ||
    pathname === "/api/search/sessions" ||
    pathname === "/api/search/transcripts"
  );
}

export function createHttpRouteHandler(
  context: RouteContext,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      requireBearerAuth(request, context.config);
      const url = new URL(request.url);
      if (request.method !== "GET" && isKnownPath(url.pathname)) {
        throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
      }
      if (request.method !== "GET") {
        throw new HttpError("NOT_FOUND", "route not found");
      }
      return await dispatchGet(request, context);
    } catch (error) {
      return errorResponse(toHttpError(error));
    }
  };
}
