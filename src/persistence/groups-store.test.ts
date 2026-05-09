import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  addWorkspaceToGroup,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  pauseGroup,
  removeWorkspaceFromGroup,
  resumeGroup,
  updateGroupRun,
} from "./groups-store";

const previousDataDir = process.env["CURSOR_CLI_AGENT_DATA_DIR"];

let testDir: string;

function groupsPath(): string {
  return join(testDir, "data", "groups.json");
}

function restoreEnv(): void {
  if (previousDataDir === undefined) {
    delete process.env["CURSOR_CLI_AGENT_DATA_DIR"];
  } else {
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = previousDataDir;
  }
}

describe("groups store lifecycle persistence", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cursor-groups-store-"));
    process.env["CURSOR_CLI_AGENT_DATA_DIR"] = join(testDir, "data");
    await mkdir(join(testDir, "data"), { recursive: true });
  });

  afterEach(async () => {
    restoreEnv();
    await rm(testDir, { recursive: true, force: true });
  });

  test("loads minimal group records as active", async () => {
    await writeFile(
      groupsPath(),
      JSON.stringify({
        groups: [{ name: "minimal", workspaces: ["/tmp/a"] }],
      }),
      "utf8",
    );

    const group = await getGroup("minimal");

    expect(group?.lifecycleState).toBe("active");
    expect(group?.workspaces).toEqual(["/tmp/a"]);
  });

  test("persists pause, resume, delete, and run updates", async () => {
    await createGroup("team");
    await addWorkspaceToGroup("team", "/tmp/a");

    const paused = await pauseGroup("team");
    expect(paused?.lifecycleState).toBe("paused");

    const resumed = await resumeGroup("team");
    expect(resumed?.lifecycleState).toBe("active");

    const updated = await updateGroupRun("team", {
      lifecycleState: "completed",
      lastRun: {
        id: "run-1",
        status: "completed",
        startedAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:01:00.000Z",
        completedAt: "2026-05-06T00:01:00.000Z",
        workspaces: [
          {
            workspace: "/tmp/a",
            localSessionId: "session-1",
            status: "completed",
            startedAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:01:00.000Z",
            completedAt: "2026-05-06T00:01:00.000Z",
            exitCode: 0,
          },
        ],
      },
    });

    expect(updated?.lastRun?.status).toBe("completed");
    expect((await listGroups())[0]?.lastRun?.workspaces[0]?.exitCode).toBe(0);

    const deleted = await deleteGroup("team");
    expect(deleted?.name).toBe("team");
    expect(await getGroup("team")).toBeUndefined();
  });

  test("preserves add/remove duplicate behavior with canonical fields", async () => {
    await createGroup("team");
    await addWorkspaceToGroup("team", "/tmp/a");
    await addWorkspaceToGroup("team", "/tmp/a");
    expect((await getGroup("team"))?.workspaces).toEqual(["/tmp/a"]);

    const removed = await removeWorkspaceFromGroup("team", "/tmp/a");
    expect(removed.workspaces).toEqual([]);
    expect(removed.lifecycleState).toBe("active");
  });

  test("tolerates corrupt lifecycle and run statuses", async () => {
    await writeFile(
      groupsPath(),
      JSON.stringify({
        groups: [
          {
            name: "corrupt",
            workspaces: ["/tmp/a"],
            lifecycleState: "archived",
            lastRun: {
              id: "run-corrupt",
              status: "not-a-status",
              startedAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
              workspaces: [{ workspace: "/tmp/a", status: "mystery" }],
            },
          },
        ],
      }),
      "utf8",
    );

    const group = await getGroup("corrupt");

    expect(group?.lifecycleState).toBe("active");
    expect(group?.lastRun).toBeUndefined();
    const raw = await readFile(groupsPath(), "utf8");
    expect(raw).toContain("not-a-status");
  });
});
