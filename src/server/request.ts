import type { TranscriptSearchRole } from "../types/transcript-search";
import { HttpError } from "./http-errors";
import type { HttpServerConfig } from "./types";

export function requireBearerAuth(
  request: Request,
  config: HttpServerConfig,
): void {
  if (config.token === undefined) {
    return;
  }
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${config.token}`) {
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
}

export function parsePositiveInteger(
  url: { readonly searchParams: URLSearchParams },
  name: string,
  defaultValue: number,
): number {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      "INVALID_REQUEST",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

export function parseOptionalPositiveInteger(
  url: { readonly searchParams: URLSearchParams },
  name: string,
): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      "INVALID_REQUEST",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

export function parseNonNegativeInteger(
  url: { readonly searchParams: URLSearchParams },
  name: string,
  defaultValue: number,
): number {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(
      "INVALID_REQUEST",
      `${name} must be a non-negative integer`,
    );
  }
  return parsed;
}

export function parseRequiredString(
  url: { readonly searchParams: URLSearchParams },
  name: string,
): string {
  const value = url.searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    throw new HttpError("INVALID_REQUEST", `${name} is required`);
  }
  return value;
}

export function parseOptionalString(
  url: { readonly searchParams: URLSearchParams },
  name: string,
): string | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

export function parseTranscriptRole(url: {
  readonly searchParams: URLSearchParams;
}): TranscriptSearchRole | undefined {
  const role = parseOptionalString(url, "role");
  if (role === undefined) {
    return undefined;
  }
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "tool"
  ) {
    return role;
  }
  throw new HttpError(
    "INVALID_REQUEST",
    "role must be user, assistant, system, or tool",
  );
}

export function parseReplayMode(
  url: { readonly searchParams: URLSearchParams },
  name: string,
  defaultValue: "latest" | "none",
): "latest" | "none" {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  if (value === "latest" || value === "none") {
    return value;
  }
  throw new HttpError("INVALID_REQUEST", `${name} must be latest or none`);
}
