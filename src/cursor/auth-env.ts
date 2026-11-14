/**
 * Resolves Cursor authentication env vars from explicit options and ambient
 * process.env.  Explicit options always win; ambient values are only used when
 * the caller has not provided an override.
 *
 * The returned object contains only the vars that are actually set so that
 * callers can spread it into option objects without producing empty string
 * entries.
 */
export interface CursorAuthEnvResult {
  readonly cursorApiKey?: string;
  readonly cursorAuthToken?: string;
}

export interface CursorAuthEnvInput {
  readonly cursorApiKey?: string;
  readonly cursorAuthToken?: string;
}

export function resolveCursorAuthEnv(
  options: CursorAuthEnvInput = {},
): CursorAuthEnvResult {
  const apiKey =
    options.cursorApiKey !== undefined && options.cursorApiKey.length > 0
      ? options.cursorApiKey
      : typeof process.env["CURSOR_API_KEY"] === "string" &&
          process.env["CURSOR_API_KEY"].length > 0
        ? process.env["CURSOR_API_KEY"]
        : undefined;

  const authToken =
    options.cursorAuthToken !== undefined && options.cursorAuthToken.length > 0
      ? options.cursorAuthToken
      : typeof process.env["CURSOR_AUTH_TOKEN"] === "string" &&
          process.env["CURSOR_AUTH_TOKEN"].length > 0
        ? process.env["CURSOR_AUTH_TOKEN"]
        : undefined;

  return {
    ...(apiKey !== undefined ? { cursorApiKey: apiKey } : {}),
    ...(authToken !== undefined ? { cursorAuthToken: authToken } : {}),
  };
}
