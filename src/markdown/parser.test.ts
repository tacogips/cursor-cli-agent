import { describe, expect, test } from "bun:test";

import { parseMarkdownTasks } from "./parser";

describe("parseMarkdownTasks", () => {
  test("parses heading sections and task items", () => {
    const result = parseMarkdownTasks({
      recordId: "rec-1",
      localSessionId: "local-1",
      transcriptPath: "/tmp/session.jsonl",
      messageId: "event-2-assistant",
      eventOffset: 2,
      markdown: [
        "# Plan",
        "- [ ] first task",
        "notes",
        "## Done",
        "* [X] shipped",
      ].join("\n"),
    });

    expect(result.sections).toEqual([
      {
        messageId: "event-2-assistant",
        heading: "Plan",
        level: 1,
        content: "- [ ] first task\nnotes",
        startLine: 1,
        endLine: 3,
      },
      {
        messageId: "event-2-assistant",
        heading: "Done",
        level: 2,
        content: "* [X] shipped",
        startLine: 4,
        endLine: 5,
      },
    ]);
    expect(result.tasks).toEqual([
      expect.objectContaining({
        messageId: "event-2-assistant",
        sectionHeading: "Plan",
        text: "first task",
        checked: false,
        lineNumber: 2,
      }),
      expect.objectContaining({
        messageId: "event-2-assistant",
        sectionHeading: "Done",
        text: "shipped",
        checked: true,
        lineNumber: 5,
      }),
    ]);
  });

  test("returns a default section for markdown without headings", () => {
    const result = parseMarkdownTasks({
      recordId: "rec-2",
      cursorChatId: "chat-2",
      transcriptPath: "/tmp/session.jsonl",
      messageId: "event-4-assistant",
      eventOffset: 4,
      markdown: ["Summary", "- [x] keep parity"].join("\n"),
    });

    expect(result.sections).toEqual([
      {
        messageId: "event-4-assistant",
        heading: "",
        level: 0,
        content: "Summary\n- [x] keep parity",
        startLine: 1,
        endLine: 2,
      },
    ]);
    expect(result.tasks).toEqual([
      expect.objectContaining({
        messageId: "event-4-assistant",
        text: "keep parity",
        checked: true,
        lineNumber: 2,
      }),
    ]);
    expect(result.tasks[0]).not.toHaveProperty("sectionHeading");
  });

  test("handles empty markdown without tasks", () => {
    const result = parseMarkdownTasks({
      recordId: "rec-3",
      transcriptPath: "/tmp/session.jsonl",
      messageId: "event-6-assistant",
      eventOffset: 6,
      markdown: "",
    });

    expect(result.sections).toEqual([
      {
        messageId: "event-6-assistant",
        heading: "",
        level: 0,
        content: "",
        startLine: 1,
        endLine: 1,
      },
    ]);
    expect(result.tasks).toEqual([]);
  });
});
