import { join } from "node:path";

import {
  createActivityManager,
  type ActivityManager,
} from "../activity/manager";
import { getCursorHome, getDataDir } from "../config/paths";
import { checkModelAvailability } from "../cursor/model-availability";
import { getToolVersions } from "../cursor/tool-versions";
import { createActivityStore } from "../persistence/activity-store";
import { SessionIndexRepository } from "../persistence/session-index";
import {
  createUsageEventStore,
  type UsageEventStore,
} from "../persistence/usage-event-store";
import { createUsageStatsManager } from "../usage/manager";
import type {
  ModelAvailabilityOptions,
  ModelAvailabilityReport,
} from "../types/model-availability";
import type {
  ToolVersionCommandRunner,
  ToolVersionOptions,
  ToolVersionReport,
} from "../types/tool-versions";
import type { UsageStatsOptions, UsageStatsReport } from "../types/usage-stats";
import type { ToolRegistrySdk } from "../types/tool-registry";
import { createToolRegistry, type ToolRegistry } from "./tool-registry";

export interface ToolHelperSdk {
  readonly registry: ToolRegistrySdk;
  versions(options?: ToolVersionOptions): Promise<ToolVersionReport>;
  checkModel(
    options: ModelAvailabilityOptions,
  ): Promise<ModelAvailabilityReport>;
  usageStats(options?: UsageStatsOptions): Promise<UsageStatsReport>;
}

export interface ToolHelperSdkOptions {
  readonly stateRoot?: string;
  readonly cursorHome?: string;
  readonly cursorBinary?: string;
  readonly now?: () => Date;
  readonly registry?: ToolRegistry;
  readonly sessionRepository?: SessionIndexRepository;
  readonly activityManager?: ActivityManager;
  readonly usageEventStore?: UsageEventStore;
  readonly commandRunner?: ToolVersionCommandRunner;
  readonly cursorApiKey?: string;
  readonly cursorAuthToken?: string;
  readonly cursorAgentEnv?: Readonly<Record<string, string | undefined>>;
}

function dataPath(stateRoot: string, name: string): string {
  return join(stateRoot, name);
}

export function createToolHelperSdk(
  options: ToolHelperSdkOptions = {},
): ToolHelperSdk {
  const stateRoot = options.stateRoot ?? getDataDir();
  const cursorHome = options.cursorHome ?? getCursorHome();
  const registry = options.registry ?? createToolRegistry();
  return {
    registry,
    versions(versionOptions?: ToolVersionOptions) {
      return getToolVersions({
        ...(options.cursorBinary !== undefined
          ? { cursorAgentBinary: options.cursorBinary }
          : {}),
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.commandRunner !== undefined
          ? { commandRunner: options.commandRunner }
          : {}),
        ...versionOptions,
      });
    },
    checkModel(modelOptions: ModelAvailabilityOptions) {
      return checkModelAvailability({
        ...(options.cursorBinary !== undefined
          ? { cursorAgentBinary: options.cursorBinary }
          : {}),
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(options.commandRunner !== undefined
          ? { commandRunner: options.commandRunner }
          : {}),
        ...(options.cursorApiKey !== undefined
          ? { cursorApiKey: options.cursorApiKey }
          : {}),
        ...(options.cursorAuthToken !== undefined
          ? { cursorAuthToken: options.cursorAuthToken }
          : {}),
        ...(options.cursorAgentEnv !== undefined
          ? { env: options.cursorAgentEnv }
          : {}),
        ...modelOptions,
      });
    },
    async usageStats(usageOptions?: UsageStatsOptions) {
      const repository =
        options.sessionRepository ??
        new SessionIndexRepository(dataPath(stateRoot, "state.db"), {
          cursorProjectsRoot: join(cursorHome, "projects"),
        });
      const shouldClose = options.sessionRepository === undefined;
      try {
        await repository.importTranscriptsFromFilesystem();
        const activity =
          options.activityManager ??
          createActivityManager({
            sessions: repository,
            store: createActivityStore(
              dataPath(stateRoot, "activity-signals.json"),
            ),
          });
        const usageEvents =
          options.usageEventStore ??
          createUsageEventStore(dataPath(stateRoot, "usage-events.json"));
        return await createUsageStatsManager({
          sessions: repository,
          activity,
          usageEvents,
        }).stats({
          ...(options.now !== undefined && usageOptions?.now === undefined
            ? { now: options.now() }
            : {}),
          ...usageOptions,
        });
      } finally {
        if (shouldClose) {
          repository.close();
        }
      }
    },
  };
}
