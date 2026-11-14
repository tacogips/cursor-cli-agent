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
export declare function parseMarkdownTasks(input: MarkdownParseInput): MarkdownParseResult;
//# sourceMappingURL=parser.d.ts.map