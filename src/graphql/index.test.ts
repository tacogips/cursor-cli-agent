import { describe, expect, test } from "bun:test";

import type { CompatCommandDispatcher } from "../compat/dispatcher";
import { executeGraphqlOperation, isGraphqlAsyncResult } from "./index";

function dispatcher(value: unknown): CompatCommandDispatcher {
  return {
    capabilities: [],
    async execute(request) {
      if (request.kind === "subscription") {
        return {
          kind: "stream",
          values: (async function* (): AsyncGenerator<unknown, void, void> {
            yield value;
          })(),
        };
      }
      return {
        kind: "single",
        value: { name: request.name, params: request.params },
      };
    },
  };
}

describe("GraphQL compatibility executor", () => {
  test("executes ping and command operations", async () => {
    const ping = await executeGraphqlOperation({
      document: "query { ping }",
      dispatcher: dispatcher({}),
    });
    expect(ping).toEqual({ data: { ping: true } });

    const result = await executeGraphqlOperation({
      document:
        'mutation ($param: JSON) { command(name: "group.create", params: $param) }',
      variables: { param: { name: "demo" } },
      dispatcher: dispatcher({}),
    });
    expect(result).toEqual({
      data: { command: { name: "group.create", params: { name: "demo" } } },
    });
  });

  test("streams subscription command results", async () => {
    const result = await executeGraphqlOperation({
      document:
        'subscription ($param: JSON) { command(name: "session.watch", params: $param) }',
      variables: { param: { id: "session-1" } },
      dispatcher: dispatcher({ event: "first" }),
    });

    expect(isGraphqlAsyncResult(result)).toBe(true);
    if (isGraphqlAsyncResult(result)) {
      const iterator = result[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { data: { command: { event: "first" } } },
      });
    }
  });

  test("preserves parse errors", async () => {
    const result = await executeGraphqlOperation({
      document: "",
      dispatcher: dispatcher({}),
    });
    expect(result).toMatchObject({
      data: null,
      errors: [{ extensions: { code: "GRAPHQL_PARSE_ERROR" } }],
    });
  });
});
