import { describe, expect, test } from "bun:test";

import {
  probeCursorAttachmentCapabilities,
  resetAttachmentCapabilityCache,
} from "./attachment-capability";

describe("probeCursorAttachmentCapabilities", () => {
  test("parses supported --image flag from override help text", async () => {
    resetAttachmentCapabilityCache();
    const cap = await probeCursorAttachmentCapabilities({
      helpTextOverride: "something --image <path>",
      bypassCache: true,
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    });
    expect(cap.status).toBe("supported");
    expect(cap.imageFlag).toBe("--image");
  });

  test("unsupported when flag missing", async () => {
    resetAttachmentCapabilityCache();
    const cap = await probeCursorAttachmentCapabilities({
      helpTextOverride: "no attachments here\n",
      bypassCache: true,
      now: () => new Date(),
    });
    expect(cap.status).toBe("unsupported");
    expect(cap.imageFlag).toBeUndefined();
  });

  test("forceStatus override for deterministic tests", async () => {
    const capUnknown = await probeCursorAttachmentCapabilities({
      forceStatus: "unknown",
      now: () => new Date(),
    });
    expect(capUnknown.status).toBe("unknown");
  });
});
