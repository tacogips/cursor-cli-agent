export type HttpErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "CONFLICT" | "NOT_IMPLEMENTED" | "INTERNAL_ERROR";
export interface HttpErrorEnvelope {
    readonly error: {
        readonly code: HttpErrorCode;
        readonly message: string;
        readonly details?: unknown;
        readonly requestId: string;
    };
}
export declare class HttpError extends Error {
    readonly code: HttpErrorCode;
    readonly details: unknown | undefined;
    constructor(code: HttpErrorCode, message: string, options?: {
        readonly details?: unknown;
    });
}
export declare function jsonResponse(value: unknown, status?: number): Response;
export declare function errorResponse(error: HttpError): Response;
export declare function toHttpError(error: unknown): HttpError;
//# sourceMappingURL=http-errors.d.ts.map