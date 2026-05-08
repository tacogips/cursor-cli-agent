import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

import type {
  PromptAttachmentInput,
  PromptAttachmentMediaType,
  PromptAttachmentProvenance,
  PromptAttachmentSource,
} from "../types/prompt-attachment";

export interface ValidatePromptAttachmentsOptions {
  readonly workspace: string;
  readonly source: PromptAttachmentSource;
  readonly now: () => Date;
}

export interface ValidatedPromptAttachments {
  readonly attachments: readonly PromptAttachmentProvenance[];
  /** Resolved image paths suitable for forwarding to Cursor (de-duplicated). */
  readonly imagePaths: readonly string[];
}

export type PromptAttachmentValidationErrorCode =
  | "invalid_scheme"
  | "unsafe_path"
  | "stat_failed"
  | "not_regular_file"
  | "unsupported_media"
  | "hash_failed";

export interface PromptAttachmentValidationError {
  readonly code: PromptAttachmentValidationErrorCode;
  readonly path: string;
  readonly detail: string;
}

function looksLikeRemoteOrSpecial(pathStr: string): boolean {
  if (pathStr.length === 0) {
    return true;
  }
  if (pathStr === "-" || pathStr === "--") {
    return true;
  }
  const lower = pathStr.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("file://") ||
    lower.startsWith("data:")
  ) {
    return true;
  }
  if (pathStr.startsWith("\\\\")) {
    return true;
  }
  return false;
}

function mediaTypeFromName(
  pathStr: string,
): PromptAttachmentMediaType | undefined {
  const lower = pathStr.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

function sniffMediaType(
  head: Uint8Array,
): PromptAttachmentMediaType | undefined {
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    head.length >= 12 &&
    head[0] === 0x47 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x38 &&
    (head[4] === 0x39 || head[4] === 0x37) &&
    head[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

async function sha256File(pathStr: string): Promise<string | undefined> {
  const hash = createHash("sha256");
  try {
    const stream = createReadStream(pathStr);
    await new Promise<void>((resolveP, reject) => {
      stream.on("error", reject);
      stream.on("data", (c: string | Buffer) => {
        if (typeof c === "string") {
          hash.update(c);
        } else {
          hash.update(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
        }
      });
      stream.on("close", () => resolveP());
    });
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

async function readHeadSafe(
  pathStr: string,
  maxLen: number,
): Promise<Uint8Array> {
  const buf = new Uint8Array(maxLen);
  const stream = createReadStream(pathStr, { start: 0, end: maxLen - 1 });
  let offset = 0;
  for await (const chunk of stream) {
    const c = chunk as Buffer;
    for (let i = 0; i < c.length && offset < buf.length; i += 1) {
      buf[offset] = c.readUInt8(i);
      offset += 1;
    }
  }
  return buf.subarray(0, offset);
}

/** Resolve CLI/SDK path against workspace (absolute paths preserved). */
function resolveAgainstWorkspace(
  workspace: string,
  originalPath: string,
): string {
  return resolve(workspace, originalPath);
}

export async function validatePromptAttachments(
  inputs: readonly PromptAttachmentInput[],
  options: ValidatePromptAttachmentsOptions,
): Promise<
  | { readonly ok: true; readonly value: ValidatedPromptAttachments }
  | { readonly ok: false; readonly error: PromptAttachmentValidationError }
> {
  const recordedAt = options.now().toISOString();
  const seenResolved = new Set<string>();
  const attachments: PromptAttachmentProvenance[] = [];
  const imagePaths: string[] = [];

  for (const input of inputs) {
    if (input.kind !== "image") {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: input.path,
          detail: "only image attachments are supported",
        },
      };
    }
    const originalPath = input.path.trim();
    if (looksLikeRemoteOrSpecial(originalPath)) {
      return {
        ok: false,
        error: {
          code: "invalid_scheme",
          path: originalPath,
          detail: "only local filesystem image paths are allowed",
        },
      };
    }

    const resolvedPath = resolveAgainstWorkspace(
      options.workspace,
      originalPath,
    );
    if (!isAbsolute(originalPath)) {
      const workspaceAbs = resolve(options.workspace);
      if (
        resolvedPath !== workspaceAbs &&
        !resolvedPath.startsWith(workspaceAbs + sep)
      ) {
        return {
          ok: false,
          error: {
            code: "unsafe_path",
            path: originalPath,
            detail: "relative path escapes workspace boundary",
          },
        };
      }
    }

    let st;
    try {
      st = await lstat(resolvedPath);
    } catch {
      return {
        ok: false,
        error: {
          code: "stat_failed",
          path: originalPath,
          detail: `cannot stat ${resolvedPath}`,
        },
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: {
          code: "not_regular_file",
          path: originalPath,
          detail: "path must be a regular file",
        },
      };
    }

    const byName = mediaTypeFromName(resolvedPath);
    const head = await readHeadSafe(resolvedPath, 32);
    const byMagic = sniffMediaType(head);

    if (byMagic !== undefined && byName !== undefined && byMagic !== byName) {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: originalPath,
          detail: `file magic (${byMagic}) does not match declared extension type (${byName})`,
        },
      };
    }

    const mediaType: PromptAttachmentMediaType | undefined =
      byMagic !== undefined ? byMagic : byName;

    if (mediaType === undefined) {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: originalPath,
          detail: "not a recognized PNG/JPEG/WebP/GIF image",
        },
      };
    }

    const hex = await sha256File(resolvedPath);
    if (hex === undefined) {
      return {
        ok: false,
        error: {
          code: "hash_failed",
          path: originalPath,
          detail: "failed to read file content for hashing",
        },
      };
    }

    if (!seenResolved.has(resolvedPath)) {
      seenResolved.add(resolvedPath);
      attachments.push({
        id: randomUUID(),
        kind: "image",
        source: options.source,
        originalPath,
        resolvedPath,
        mediaType,
        sizeBytes: st.size,
        sha256: hex,
        status: "validated",
        recordedAt,
      });
      imagePaths.push(resolvedPath);
    }
  }

  return {
    ok: true,
    value: { attachments, imagePaths },
  };
}
