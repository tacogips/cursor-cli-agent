import { randomUUID } from "node:crypto";

export type HttpErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId: string;
  };
}

const STATUS_BY_CODE: Record<HttpErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500,
};

export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly details: unknown | undefined;

  constructor(
    code: HttpErrorCode,
    message: string,
    options: { readonly details?: unknown } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.details = options.details;
  }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(error: HttpError): Response {
  const envelope: HttpErrorEnvelope = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
      requestId: randomUUID(),
    },
  };
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };
  if (error.code === "UNAUTHORIZED") {
    headers["www-authenticate"] = "Bearer";
  }
  return new Response(JSON.stringify(envelope), {
    status: STATUS_BY_CODE[error.code],
    headers,
  });
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError("INTERNAL_ERROR", "internal server error");
}
