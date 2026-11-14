import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { listSkillRecords, parseSkillFrontmatter } from "./skill-catalog";

describe("parseSkillFrontmatter", () => {
  test("reads name and description from YAML frontmatter", () => {
    const md = `---
name: my-skill
description: Does a thing
---
# Body
`;
    const p = parseSkillFrontmatter(md);
    expect(p.name).toBe("my-skill");
    expect(p.description).toBe("Does a thing");
    expect(p.disableModelInvocation).toBe(false);
  });

  test("parses disableModelInvocation", () => {
    const md = `---
name: x
disableModelInvocation: true
---
`;
    const p = parseSkillFrontmatter(md);
    expect(p.disableModelInvocation).toBe(true);
  });
});

describe("listSkillRecords", () => {
  test("discovers project-scoped skills only under the given project root", async () => {
    const root = join(tmpdir(), `proj-${Date.now()}`);
    const skillDir = join(root, ".cursor/skills/demo-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: demo-skill
description: test skill
---
`,
      "utf8",
    );
    const rows = await listSkillRecords({ projectRoot: root });
    const hit = rows.find((r) => r.name === "demo-skill");
    expect(hit).toBeDefined();
    expect(hit?.scope).toBe("project");
    expect(hit?.path).toContain("SKILL.md");
  });
});
