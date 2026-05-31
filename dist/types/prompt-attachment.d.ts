/**
 * Prompt image attachments validated before Cursor process launch (`P3-PROMPT-ATTACHMENTS`).
 */
export type PromptAttachmentKind = "image";
export type PromptAttachmentSource = "cli" | "sdk" | "queue" | "group";
export type PromptAttachmentStatus = "validated" | "rejected" | "unsupported" | "forwarded";
export type PromptAttachmentMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export interface PromptAttachmentInput {
    readonly kind: PromptAttachmentKind;
    readonly path: string;
    readonly label?: string;
}
export interface PromptAttachmentProvenance {
    readonly id: string;
    readonly kind: PromptAttachmentKind;
    readonly source: PromptAttachmentSource;
    readonly originalPath: string;
    readonly resolvedPath: string;
    readonly mediaType: PromptAttachmentMediaType;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly status: PromptAttachmentStatus;
    readonly recordedAt: string;
}
//# sourceMappingURL=prompt-attachment.d.ts.map