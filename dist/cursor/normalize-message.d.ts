import type { NormalizedMessage } from "../types/agent-event";
/**
 * Build a normalized user/assistant message from a single text block.
 */
export declare function normalizeTextBlock(role: "user" | "assistant", rawText: string): NormalizedMessage;
/**
 * Concatenate text parts from stream-json or transcript content blocks.
 */
export declare function joinTextParts(parts: readonly {
    type?: string;
    text?: string;
}[]): string;
//# sourceMappingURL=normalize-message.d.ts.map