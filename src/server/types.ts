import pkg from "../../package.json" with { type: "json" };

import { getConfigDir, getCursorHome, getDataDir } from "../config/paths";

export interface HttpServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly configDir: string;
  readonly cursorHome: string;
  readonly token?: string;
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
    packageVersion: pkg.version,
  };
}
