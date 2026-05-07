import { constants } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { daemonMetadataPath } from "../config/paths";
import type { DaemonMetadata } from "../types/daemon";

export type DaemonMetadataReadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly metadata: DaemonMetadata }
  | { readonly status: "malformed"; readonly diagnostic: string };

export interface DaemonMetadataStore {
  read(): Promise<DaemonMetadataReadResult>;
  write(metadata: DaemonMetadata): Promise<void>;
  remove(): Promise<void>;
}

export interface FileDaemonMetadataStoreOptions {
  readonly path?: string;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isDaemonState(value: unknown): value is DaemonMetadata["state"] {
  return (
    value === "starting" ||
    value === "running" ||
    value === "stopping" ||
    value === "failed"
  );
}

function validateMetadata(value: unknown): DaemonMetadata | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const auth = record["auth"];
  if (typeof auth !== "object" || auth === null) {
    return undefined;
  }
  const authRecord = auth as Record<string, unknown>;
  if (
    record["schemaVersion"] !== 1 ||
    !isDaemonState(record["state"]) ||
    typeof record["pid"] !== "number" ||
    !Number.isInteger(record["pid"]) ||
    typeof record["parentPid"] !== "number" ||
    !Number.isInteger(record["parentPid"]) ||
    typeof record["marker"] !== "string" ||
    typeof record["commandPath"] !== "string" ||
    typeof record["host"] !== "string" ||
    typeof record["port"] !== "number" ||
    !Number.isInteger(record["port"]) ||
    typeof record["baseUrl"] !== "string" ||
    typeof record["dataDir"] !== "string" ||
    typeof record["configDir"] !== "string" ||
    record["serverMode"] !== "http" ||
    typeof record["startedAt"] !== "string" ||
    (record["lastCheckedAt"] !== undefined &&
      typeof record["lastCheckedAt"] !== "string") ||
    (authRecord["mode"] !== "disabled" && authRecord["mode"] !== "required") ||
    typeof authRecord["tokenConfigured"] !== "boolean"
  ) {
    return undefined;
  }
  return value as DaemonMetadata;
}

export function createFileDaemonMetadataStore(
  options: FileDaemonMetadataStoreOptions = {},
): DaemonMetadataStore {
  const path = options.path ?? daemonMetadataPath();
  return {
    async read(): Promise<DaemonMetadataReadResult> {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFile(error)) {
          return { status: "missing" };
        }
        return {
          status: "malformed",
          diagnostic:
            error instanceof Error ? error.message : "failed to read metadata",
        };
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        const metadata = validateMetadata(parsed);
        if (metadata === undefined) {
          return { status: "malformed", diagnostic: "invalid metadata shape" };
        }
        return { status: "valid", metadata };
      } catch (error) {
        return {
          status: "malformed",
          diagnostic:
            error instanceof Error ? error.message : "invalid metadata JSON",
        };
      }
    },
    async write(metadata: DaemonMetadata): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp.${randomUUID()}`;
      await writeFile(tmpPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: "utf8",
        mode: constants.S_IRUSR | constants.S_IWUSR,
      });
      await rename(tmpPath, path);
    },
    async remove(): Promise<void> {
      await rm(path, { force: true });
    },
  };
}
