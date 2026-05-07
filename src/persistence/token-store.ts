import { constants } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { getConfigDir } from "../config/paths";
import type { TokenRecord } from "../types/auth-token";

const TOKENS_FILE = "tokens.json";

export interface TokenConfig {
  readonly tokens: readonly TokenRecord[];
}

export interface TokenStore {
  load(): Promise<TokenConfig>;
  save(config: TokenConfig): Promise<void>;
}

export interface FileTokenStoreOptions {
  readonly configDir?: string;
}

function tokenFilePath(configDir: string): string {
  return join(configDir, TOKENS_FILE);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createFileTokenStore(
  options: FileTokenStoreOptions = {},
): TokenStore {
  const configDir = options.configDir ?? getConfigDir();
  const path = tokenFilePath(configDir);
  return {
    async load(): Promise<TokenConfig> {
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw) as TokenConfig;
        if (!Array.isArray(parsed.tokens)) {
          return { tokens: [] };
        }
        return { tokens: parsed.tokens };
      } catch (error) {
        if (isMissingFile(error)) {
          return { tokens: [] };
        }
        throw error;
      }
    },
    async save(config: TokenConfig): Promise<void> {
      await mkdir(configDir, { recursive: true });
      const tmpPath = `${path}.tmp.${randomUUID()}`;
      const json = `${JSON.stringify(config, null, 2)}\n`;
      await writeFile(tmpPath, json, {
        encoding: "utf8",
        mode: constants.S_IRUSR | constants.S_IWUSR,
      });
      await rename(tmpPath, path);
    },
  };
}
