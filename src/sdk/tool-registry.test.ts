import { describe, expect, test } from "bun:test";

import { ToolRegistryError, createToolRegistry, tool } from "./tool-registry";

describe("ToolRegistry", () => {
  test("registers tools, lists them sorted, and runs async handlers", async () => {
    const registry = createToolRegistry();
    registry.register(
      tool<{ readonly value: number }, number>({
        name: "z.double",
        description: "Double a number.",
        run: async (input) => input.value * 2,
      }),
    );
    registry.register(
      tool<{ readonly text: string }, string>({
        name: "a.echo",
        run: (input) => input.text,
      }),
    );

    expect(registry.list().map((item) => item.name)).toEqual([
      "a.echo",
      "z.double",
    ]);
    await expect(
      registry.run<{ readonly value: number }, number>("z.double", {
        value: 4,
      }),
    ).resolves.toBe(8);
  });

  test("rejects blank names, duplicate registrations, and missing tools", async () => {
    expect(() =>
      tool({
        name: "  ",
        run: () => null,
      }),
    ).toThrow(ToolRegistryError);

    const registry = createToolRegistry([
      tool({
        name: "same",
        run: () => "first",
      }),
    ]);
    expect(() =>
      registry.register(
        tool({
          name: "same",
          run: () => "second",
        }),
      ),
    ).toThrow("tool already registered: same");
    await expect(registry.run("missing", {})).rejects.toThrow(
      "tool not found: missing",
    );
  });
});
