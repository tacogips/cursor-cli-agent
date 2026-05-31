import type { CursorSkillRecord } from "../types/skill-record";
export interface SkillCatalogOptions {
    /** When set, also scan `<projectRoot>/.cursor/skills`. */
    readonly projectRoot?: string;
}
/**
 * Parse minimal YAML frontmatter from a SKILL.md body.
 * Recognizes `name`, `description`, and `disableModelInvocation` when present.
 */
export declare function parseSkillFrontmatter(content: string): {
    name?: string;
    description?: string;
    disableModelInvocation: boolean;
};
/**
 * Read all discoverable skills from built-in, user, and optional project roots.
 * Never writes; `skills-cursor` is read for metadata only.
 */
export declare function listSkillRecords(opts?: SkillCatalogOptions): Promise<CursorSkillRecord[]>;
export declare function findSkillByName(name: string, opts?: SkillCatalogOptions): Promise<CursorSkillRecord | undefined>;
//# sourceMappingURL=skill-catalog.d.ts.map