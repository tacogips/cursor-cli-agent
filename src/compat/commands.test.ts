import { describe, expect, test } from "bun:test";

import {
  COMPAT_COMMAND_CAPABILITIES,
  decideCompatCommand,
  preferredCompatOperationKind,
} from "./commands";

describe("compat command registry", () => {
  test("covers supported, degraded, and unsupported commands", () => {
    const names = new Set(
      COMPAT_COMMAND_CAPABILITIES.map((capability) => capability.name),
    );

    expect(names.has("session.list")).toBe(true);
    expect(names.has("session.watch")).toBe(true);
    expect(names.has("session.fork")).toBe(true);
    expect(names.has("files.patches")).toBe(true);
    expect(names.has("token.create")).toBe(true);
    expect(names.has("token.list")).toBe(true);
    expect(names.has("token.revoke")).toBe(true);
    expect(names.has("token.rotate")).toBe(true);
  });

  test("classifies unsupported and kind mismatch decisions", () => {
    const unsupported = decideCompatCommand("files.patches", "query");
    expect(unsupported.ok).toBe(false);
    expect(unsupported.capability?.status).toBe("unsupported");
    expect(unsupported.capability?.limitations[0]?.code).toBe(
      "cursor-no-patch-history",
    );

    const mismatch = decideCompatCommand("group.create", "query");
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toContain("does not support query");

    expect(preferredCompatOperationKind("session.watch")).toBe("subscription");
  });
});
