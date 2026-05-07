import type { MarkdownSection, MarkdownTask } from "../types/markdown-task";

export interface MarkdownParseInput {
  readonly recordId: string;
  readonly localSessionId?: string;
  readonly cursorChatId?: string;
  readonly transcriptPath: string;
  readonly messageId: string;
  readonly eventOffset: number;
  readonly byteOffset?: number;
  readonly markdown: string;
}

export interface MarkdownParseResult {
  readonly sections: readonly MarkdownSection[];
  readonly tasks: readonly MarkdownTask[];
}

interface HeadingMatch {
  readonly heading: string;
  readonly level: number;
  readonly lineIndex: number;
}

interface SectionRange {
  readonly heading: string;
  readonly level: number;
  readonly startLine: number;
  readonly endLine: number;
}

const HEADING_PATTERN = /^(#{1,6})(?:[ \t]+(.*))?$/;
const TASK_PATTERN = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/;

function parseHeadings(lines: readonly string[]): readonly HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const match = HEADING_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    headings.push({
      heading: (match[2] ?? "").trim(),
      level: match[1]?.length ?? 0,
      lineIndex: index,
    });
  }
  return headings;
}

function buildSectionRanges(lines: readonly string[]): readonly SectionRange[] {
  const headings = parseHeadings(lines);
  if (headings.length === 0) {
    return [
      {
        heading: "",
        level: 0,
        startLine: 1,
        endLine: lines.length,
      },
    ];
  }

  return headings.map((heading, index) => ({
    heading: heading.heading,
    level: heading.level,
    startLine: heading.lineIndex + 1,
    endLine: (headings[index + 1]?.lineIndex ?? lines.length) - 1 + 1,
  }));
}

function sectionContent(lines: readonly string[], range: SectionRange): string {
  if (range.level === 0) {
    return lines.join("\n");
  }
  return lines.slice(range.startLine, range.endLine).join("\n");
}

function sectionForLine(
  sections: readonly SectionRange[],
  lineNumber: number,
): SectionRange | undefined {
  for (const section of sections) {
    if (lineNumber >= section.startLine && lineNumber <= section.endLine) {
      return section;
    }
  }
  return undefined;
}

export function parseMarkdownTasks(
  input: MarkdownParseInput,
): MarkdownParseResult {
  const lines = input.markdown.split(/\r?\n/);
  const ranges = buildSectionRanges(lines);
  const sections: MarkdownSection[] = ranges.map((range) => ({
    messageId: input.messageId,
    heading: range.heading,
    level: range.level,
    content: sectionContent(lines, range),
    startLine: range.startLine,
    endLine: range.endLine,
  }));

  const tasks: MarkdownTask[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const match = TASK_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    const lineNumber = index + 1;
    const section = sectionForLine(ranges, lineNumber);
    tasks.push({
      recordId: input.recordId,
      ...(input.localSessionId !== undefined
        ? { localSessionId: input.localSessionId }
        : {}),
      ...(input.cursorChatId !== undefined
        ? { cursorChatId: input.cursorChatId }
        : {}),
      transcriptPath: input.transcriptPath,
      messageId: input.messageId,
      role: "assistant",
      ...(section !== undefined && section.heading.length > 0
        ? { sectionHeading: section.heading }
        : {}),
      text: (match[2] ?? "").trim(),
      checked: match[1] !== " ",
      lineNumber,
      eventOffset: input.eventOffset,
      ...(input.byteOffset !== undefined
        ? { byteOffset: input.byteOffset }
        : {}),
      provenance: "transcript",
    });
  }

  return { sections, tasks };
}
