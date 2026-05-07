import pkg from "../../package.json" with { type: "json" };

import { getConfigDir, getCursorHome, getDataDir } from "../config/paths";
import type { ApiTokenMetadata } from "../types/auth-token";

export type ServerAuthMode = "disabled" | "optional" | "required";

export interface ServerAuthContext {
  readonly mode: ServerAuthMode;
  readonly token?: ApiTokenMetadata;
}

export interface HttpServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly configDir: string;
  readonly cursorHome: string;
  readonly token?: string;
  readonly authMode: ServerAuthMode;
  readonly packageVersion: string;
}

export interface HttpServerHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

export interface ServerStartResult {
  readonly status: "running";
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly auth: "none" | "bearer";
}

export interface ResolveHttpServerConfigInput {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) {
    return true;
  }
  if (host.startsWith("127.")) {
    return true;
  }
  return host === "0:0:0:0:0:0:0:1";
}

export function resolveHttpServerConfig(
  input: ResolveHttpServerConfigInput = {},
): HttpServerConfig {
  const host = input.host ?? "127.0.0.1";
  const token =
    input.token ?? process.env["CURORT_CLI_AGENT_SERVER_TOKEN"] ?? undefined;
  if (!isLoopbackHost(host) && token === undefined) {
    throw new Error("server token is required for non-loopback hosts");
  }
  return {
    host,
    port: input.port ?? 0,
    dataDir: getDataDir(),
    configDir: getConfigDir(),
    cursorHome: getCursorHome(),
    ...(token !== undefined ? { token } : {}),
    authMode: token === undefined ? "disabled" : "required",
    packageVersion: pkg.version,
  };
}
