import { spawn } from "node:child_process";
import { once } from "node:events";

export type AttachmentCapabilityStatus =
  | "supported"
  | "unsupported"
  | "unknown";

export type CursorImageArgvFlag = "--image" | "--attach" | "--file";

export interface CursorAttachmentCapabilities {
  readonly imageFlag?: CursorImageArgvFlag;
  readonly status: AttachmentCapabilityStatus;
  readonly detectedFrom: "help" | "override";
  readonly checkedAt: string;
}

const probeCache = new Map<string, Promise<CursorAttachmentCapabilities>>();

function parseHelp(
  stdout: string,
  checkedAt: string,
): CursorAttachmentCapabilities {
  const candidates: readonly CursorImageArgvFlag[] = [
    "--image",
    "--attach",
    "--file",
  ];
  for (const flag of candidates) {
    const esc = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[\\s])${esc}(?=[\\s]|$)`, "m");
    if (re.test(stdout)) {
      return {
        imageFlag: flag,
        status: "supported",
        detectedFrom: "help",
        checkedAt,
      };
    }
  }
  return {
    status: "unsupported",
    detectedFrom: "help",
    checkedAt,
  };
}

export async function probeCursorAttachmentCapabilities(options: {
  readonly cursorBinary?: string;
  /** Test-only deterministic override of help stdout. */
  readonly helpTextOverride?: string;
  /** Test-only shortcut for non-probe paths. */
  readonly forceStatus?: AttachmentCapabilityStatus;
  readonly now: () => Date;
  /** Bypass cache when true (tests). */
  readonly bypassCache?: boolean;
}): Promise<CursorAttachmentCapabilities> {
  if (options.forceStatus !== undefined) {
    const checkedAt = options.now().toISOString();
    return {
      status: options.forceStatus,
      detectedFrom: "override",
      ...(options.forceStatus === "supported"
        ? {
            imageFlag: "--image" as const,
          }
        : {}),
      checkedAt,
    };
  }
  if (options.helpTextOverride !== undefined) {
    const checkedAt = options.now().toISOString();
    const cap = parseHelp(options.helpTextOverride, checkedAt);
    return { ...cap, detectedFrom: "override", checkedAt };
  }

  const binary = options.cursorBinary ?? "cursor-agent";
  if (!options.bypassCache) {
    const existing = probeCache.get(binary);
    if (existing !== undefined) {
      return existing;
    }
  }

  const checkedAt = options.now().toISOString();
  const runProbe = async (): Promise<CursorAttachmentCapabilities> => {
    const proc = spawn(binary, ["--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (c: string) => {
      stdout += c;
    });
    proc.stderr?.on("data", (c: string) => {
      stdout += c;
    });
    try {
      const [code] = (await once(proc, "close")) as [number | null];
      if (code !== 0) {
        return { status: "unknown", detectedFrom: "help", checkedAt };
      }
      return parseHelp(stdout, checkedAt);
    } catch {
      return { status: "unknown", detectedFrom: "help", checkedAt };
    }
  };

  const pending = runProbe();
  if (!options.bypassCache) {
    probeCache.set(binary, pending);
  }
  return pending;
}

export function resetAttachmentCapabilityCache(): void {
  probeCache.clear();
}
