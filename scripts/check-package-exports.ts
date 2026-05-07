import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

interface PackageJson {
  readonly exports?: Record<string, unknown>;
}

const requiredExports = [".", "./sdk", "./sdk/testing", "./server", "./types"];
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as PackageJson;

for (const exportPath of requiredExports) {
  const entry = packageJson.exports?.[exportPath];
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`missing package export ${exportPath}`);
  }
  for (const field of ["types", "import", "default"] as const) {
    const value = (entry as Record<string, unknown>)[field];
    if (typeof value !== "string") {
      throw new Error(
        `missing ${field} field for package export ${exportPath}`,
      );
    }
    const path = new URL(`..${value.slice(1)}`, import.meta.url);
    if (value.startsWith("./dist/") && !existsSync(path)) {
      throw new Error(
        `missing built ${field} file for ${exportPath}: ${value}`,
      );
    }
  }
}

const publicBarrels = [
  "../src/index.ts",
  "../src/sdk/index.ts",
  "../src/sdk/types.ts",
  "../src/sdk/testing.ts",
  "../src/sdk/server.ts",
];

for (const path of publicBarrels) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  if (
    /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']\.\.\/cursor\//s.test(
      source,
    )
  ) {
    throw new Error(`${path} exports raw cursor adapter symbols`);
  }
}

console.log("package exports ok");
