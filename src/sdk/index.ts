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
export {
  CursorAuthKeepAlive,
  type CursorAuthKeepAliveOptions,
  type CursorAuthKeepAliveStatus,
} from "../cursor/auth-keepalive";
export {
  resolveCursorAuthEnv,
  type CursorAuthEnvInput,
  type CursorAuthEnvResult,
} from "../cursor/auth-env";

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
      ...(options.cursorApiKey !== undefined
        ? { cursorApiKey: options.cursorApiKey }
        : {}),
      ...(options.cursorAgentEnv !== undefined
        ? { cursorAgentEnv: options.cursorAgentEnv }
        : {}),
    }),
    tools: createToolHelperSdk(options),
  };
}
