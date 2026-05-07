import { createAgentRunnerFacade } from "./agent-runner";
import { createDomainFacades } from "./facades";
import { createToolHelperSdk } from "./helpers";
import type { CursorAgentSdk, CursorAgentSdkOptions } from "./types";

export type * from "./types";
export {
  ToolRegistry,
  ToolRegistryError,
  createToolRegistry,
  tool,
} from "./tool-registry";

export function createCursorAgentSdk(
  options: CursorAgentSdkOptions = {},
): CursorAgentSdk {
  const facades = createDomainFacades(options);
  return {
    ...facades,
    runner: createAgentRunnerFacade({
      ...(options.cursorBinary !== undefined
        ? { cursorBinary: options.cursorBinary }
        : {}),
    }),
    tools: createToolHelperSdk(options),
  };
}
