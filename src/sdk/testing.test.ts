import { describe, expect, test } from "bun:test";

import {
  createMockCursorAgentSdk,
  createMockCursorRunningAgent,
} from "./testing";

describe("SDK testing helpers", () => {
  test("creates deterministic mock SDK and running agent helpers", async () => {
    const sdk = createMockCursorAgentSdk();
    const group = await sdk.groups.create("g1");
    const agent = createMockCursorRunningAgent({
      sessionId: "mock-session",
      events: [
        { type: "session.completed", sessionId: "mock-session", result: "ok" },
      ],
    });

    expect(group.name).toBe("g1");
    expect((await sdk.groups.list())[0]?.name).toBe("g1");
    expect((await agent.waitForCompletion()).sessionId).toBe("mock-session");
  });
});
