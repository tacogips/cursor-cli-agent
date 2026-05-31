export type AttachmentCapabilityStatus = "supported" | "unsupported" | "unknown";
export type CursorImageArgvFlag = "--image" | "--attach" | "--file";
export interface CursorAttachmentCapabilities {
    readonly imageFlag?: CursorImageArgvFlag;
    readonly status: AttachmentCapabilityStatus;
    readonly detectedFrom: "help" | "override";
    readonly checkedAt: string;
}
export declare function probeCursorAttachmentCapabilities(options: {
    readonly cursorBinary?: string;
    /** Test-only deterministic override of help stdout. */
    readonly helpTextOverride?: string;
    /** Test-only shortcut for non-probe paths. */
    readonly forceStatus?: AttachmentCapabilityStatus;
    readonly now: () => Date;
    /** Bypass cache when true (tests). */
    readonly bypassCache?: boolean;
}): Promise<CursorAttachmentCapabilities>;
export declare function resetAttachmentCapabilityCache(): void;
//# sourceMappingURL=attachment-capability.d.ts.map