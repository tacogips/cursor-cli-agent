/**
 * Discovered Cursor skill metadata (read-only; execution does not depend on built-in bodies).
 */

export type SkillScope = "builtin" | "user" | "project";

export interface CursorSkillRecord {
  readonly name: string;
  readonly description?: string;
  readonly scope: SkillScope;
  readonly path: string;
  readonly disableModelInvocation: boolean;
}
