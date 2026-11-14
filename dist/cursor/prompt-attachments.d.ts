import type { PromptAttachmentInput, PromptAttachmentProvenance, PromptAttachmentSource } from "../types/prompt-attachment";
export interface ValidatePromptAttachmentsOptions {
    readonly workspace: string;
    readonly source: PromptAttachmentSource;
    readonly now: () => Date;
}
export interface ValidatedPromptAttachments {
    readonly attachments: readonly PromptAttachmentProvenance[];
    /** Resolved image paths suitable for forwarding to Cursor (de-duplicated). */
    readonly imagePaths: readonly string[];
}
export type PromptAttachmentValidationErrorCode = "invalid_scheme" | "unsafe_path" | "stat_failed" | "not_regular_file" | "unsupported_media" | "hash_failed";
export interface PromptAttachmentValidationError {
    readonly code: PromptAttachmentValidationErrorCode;
    readonly path: string;
    readonly detail: string;
}
export declare function validatePromptAttachments(inputs: readonly PromptAttachmentInput[], options: ValidatePromptAttachmentsOptions): Promise<{
    readonly ok: true;
    readonly value: ValidatedPromptAttachments;
} | {
    readonly ok: false;
    readonly error: PromptAttachmentValidationError;
}>;
//# sourceMappingURL=prompt-attachments.d.ts.map