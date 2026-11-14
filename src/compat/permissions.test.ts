import { describe, expect, test } from "bun:test";

import { getCompatCommandCapability } from "./commands";
import {
  authorizeCompatCommand,
  compatAuthPermissionForCapability,
} from "./permissions";

function capability(name: string) {
  const found = getCompatCommandCapability(name);
  if (found === undefined) {
    throw new Error(`missing test capability: ${name}`);
  }
  return found;
}

describe("compat permission adapter", () => {
  test("maps compatibility intents onto route-facing auth literals", () => {
    expect(compatAuthPermissionForCapability(capability("group.create"))).toBe(
      "group:*",
    );
    expect(compatAuthPermissionForCapability(capability("files.list"))).toBe(
      "files:*",
    );
    expect(
      compatAuthPermissionForCapability(capability("version.get")),
    ).toBeUndefined();
    expect(compatAuthPermissionForCapability(capability("skill.list"))).toBe(
      "server:read",
    );
  });

  test("returns 401 for missing required credentials and 403 for insufficient permissions", () => {
    const command = capability("session.list");
    expect(authorizeCompatCommand(command, { mode: "disabled" }).ok).toBe(true);

    const missing = authorizeCompatCommand(command, { mode: "required" });
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe(401);

    const forbidden = authorizeCompatCommand(command, {
      mode: "required",
      tokenPermissions: ["server:admin"],
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.status).toBe(403);

    const allowed = authorizeCompatCommand(command, {
      mode: "required",
      tokenPermissions: ["session:read"],
    });
    expect(allowed.ok).toBe(true);
  });
});
