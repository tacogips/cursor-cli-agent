import type { AuthPermission } from "../auth";

export interface RoutePermissionRequirement {
  readonly permission: AuthPermission;
}

export function routePermissionForRequest(
  request: Request,
): RoutePermissionRequirement | undefined {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/health" || pathname === "/api/version") {
    return { permission: "server:admin" };
  }
  if (pathname === "/api/sessions" && request.method === "POST") {
    return { permission: "session:create" };
  }
  if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/cancel")) {
    return { permission: "session:cancel" };
  }
  if (
    pathname === "/api/sessions" ||
    pathname.startsWith("/api/sessions/") ||
    pathname === "/api/search/sessions" ||
    pathname === "/api/search/transcripts" ||
    pathname === "/api/events/activity" ||
    pathname.startsWith("/api/events/activity/") ||
    pathname.startsWith("/api/events/sessions/")
  ) {
    return { permission: "session:read" };
  }
  if (pathname.startsWith("/api/events/groups/")) {
    return { permission: "group:*" };
  }
  if (pathname.startsWith("/api/events/queues/")) {
    return { permission: "queue:*" };
  }
  if (pathname.startsWith("/api/bookmarks")) {
    return { permission: "bookmark:*" };
  }
  if (pathname.startsWith("/api/files")) {
    return { permission: "files:*" };
  }
  if (pathname.startsWith("/api/admin")) {
    return { permission: "server:admin" };
  }
  return undefined;
}
