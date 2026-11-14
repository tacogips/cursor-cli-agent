import { describe, expect, test } from "bun:test";

import {
  classifyTextSignal,
  createActivitySignalClassifier,
} from "./activity-signals";

describe("activity signal classifier", () => {
  test("classifies normalized stream events", () => {
    const classifier = createActivitySignalClassifier();

    expect(
      classifier.classifyStreamEvent({
        type: "session.started",
        sessionId: "s1",
        cwd: "/tmp/workspace",
      })?.status,
    ).toBe("running");
    expect(
      classifier.classifyStreamEvent({
        type: "session.completed",
        sessionId: "s1",
        result: "done",
      })?.status,
    ).toBe("completed");
    expect(
      classifier.classifyStreamEvent({
        type: "session.error",
        sessionId: "s1",
        message: "boom",
      })?.status,
    ).toBe("failed");
  });

  test("classifies trust and input waits from stderr/stdout text", () => {
    expect(
      classifyTextSignal("Workspace Trust Required: open this folder", "stderr")
        ?.status,
    ).toBe("waiting_trust");
    expect(
      classifyTextSignal("Waiting for user input before continuing", "stdout")
        ?.status,
    ).toBe("waiting_input");
  });

  test("classifies process results", () => {
    const classifier = createActivitySignalClassifier();

    expect(classifier.classifyProcessResult(0, "")?.status).toBe("completed");
    expect(classifier.classifyProcessResult(2, "")?.status).toBe("failed");
    expect(
      classifier.classifyProcessResult(
        1,
        "Workspace Trust Required: approve workspace",
      )?.status,
    ).toBe("waiting_trust");
    const stdoutWait = classifier.classifyProcessResult(
      0,
      "",
      "Waiting for user input before continuing",
    );
    expect(stdoutWait?.status).toBe("waiting_input");
    expect(stdoutWait?.source).toBe("stdout");
  });
});
