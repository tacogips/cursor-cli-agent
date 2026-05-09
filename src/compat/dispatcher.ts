import pkg from "../../package.json" with { type: "json" };

import { listSkillRecords } from "../cursor/skill-catalog";
import type { EventStreamService } from "../server/event-streams";
import { createCursorAgentSdk, type CursorAgentSdk } from "../sdk";
import type { CursorRunningAgent } from "../sdk/agent-runner";
import type { AuthPermission } from "../auth";
import type { QueueItemMode, QueueItemStatus } from "../types/queue";
import {
  COMPAT_COMMAND_CAPABILITIES,
  decideCompatCommand,
  type CompatCommandCapability,
  type CompatOperationKind,
} from "./commands";
import { authorizeCompatCommand, type CompatAuthContext } from "./permissions";

export interface CompatExecutionContext {
  readonly workspace?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly configDir?: string | undefined;
  readonly cursorHome?: string | undefined;
  readonly requestId?: string | undefined;
  readonly auth?: CompatAuthContext | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface CompatCommandRequest {
  readonly kind: CompatOperationKind;
  readonly name: string;
  readonly params?: unknown;
  readonly context: CompatExecutionContext;
}

export type CompatCommandResult =
  | { readonly kind: "single"; readonly value: unknown }
  | { readonly kind: "stream"; readonly values: AsyncIterable<unknown> };

export interface CompatCommandDispatcher {
  readonly capabilities: readonly CompatCommandCapability[];
  execute(request: CompatCommandRequest): Promise<CompatCommandResult>;
}

export interface CompatDispatcherOptions {
  readonly sdk?: CursorAgentSdk;
  readonly streams?: EventStreamService;
  readonly auth?: CompatAuthContext;
}

export interface CompatErrorDetails {
  readonly command: string;
  readonly operationKind: CompatOperationKind;
  readonly status?: string;
  readonly reason: string;
  readonly cursorLimitation?: boolean;
  readonly provenance: "compat-bridge";
  readonly limitations?: readonly unknown[];
  readonly requiredPermission?: AuthPermission;
}

export class CompatCommandError extends Error {
  readonly details: CompatErrorDetails;
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 501;

  constructor(
    message: string,
    details: CompatErrorDetails,
    statusCode: 400 | 401 | 403 | 404 | 409 | 501 = 400,
  ) {
    super(message);
    this.name = "CompatCommandError";
    this.details = details;
    this.statusCode = statusCode;
  }
}

function objectParam(params: unknown): Readonly<Record<string, unknown>> {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("params must be an object");
  }
  return params as Readonly<Record<string, unknown>>;
}

function stringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function integerParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  command: string,
): number {
  const value = numberParam(params, key);
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`${command}: ${key} must be a non-negative integer`);
  }
  return value;
}

function positiveLimit(params: Readonly<Record<string, unknown>>): number {
  const limit = numberParam(params, "limit");
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    return 100;
  }
  return limit;
}

function requiredString(
  params: Readonly<Record<string, unknown>>,
  key: string,
  command: string,
): string {
  const value = stringParam(params, key);
  if (value === undefined) {
    throw new Error(`${command}: ${key} is required`);
  }
  return value;
}

function queueItemStatusParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  command: string,
): QueueItemStatus | undefined {
  const value = stringParam(params, key);
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }
  throw new Error(
    `${command}: ${key} must be pending, completed, failed, or skipped`,
  );
}

function queueItemModeParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  command: string,
): QueueItemMode {
  const value = stringParam(params, key);
  if (value === "auto" || value === "manual") {
    return value;
  }
  throw new Error(`${command}: ${key} must be auto or manual`);
}

function runRequest(input: {
  readonly prompt: string;
  readonly cwd?: string | undefined;
  readonly model?: string | undefined;
}) {
  return {
    prompt: input.prompt,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}

function resumeRequest(input: {
  readonly sessionId: string;
  readonly prompt?: string | undefined;
  readonly cwd?: string | undefined;
}) {
  return {
    sessionId: input.sessionId,
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  };
}

function commandError(
  request: CompatCommandRequest,
  reason: string,
  statusCode: 400 | 401 | 403 | 404 | 409 | 501,
  capability?: CompatCommandCapability,
  requiredPermission?: AuthPermission,
): CompatCommandError {
  return new CompatCommandError(
    reason,
    {
      command: request.name,
      operationKind: request.kind,
      ...(capability !== undefined ? { status: capability.status } : {}),
      reason,
      cursorLimitation:
        capability?.limitations.some(
          (limitation) => limitation.cursorSpecific,
        ) ?? false,
      provenance: "compat-bridge",
      ...(capability !== undefined && capability.limitations.length > 0
        ? { limitations: capability.limitations }
        : {}),
      ...(requiredPermission !== undefined ? { requiredPermission } : {}),
    },
    statusCode,
  );
}

async function collectRun(agent: CursorRunningAgent): Promise<unknown> {
  return await agent.waitForCompletion();
}

async function* oneValue(value: unknown): AsyncGenerator<unknown, void, void> {
  yield value;
}

function streamOptions(params: Readonly<Record<string, unknown>>) {
  const startOffset = numberParam(params, "startOffset");
  return {
    replay: "latest" as const,
    heartbeatMs: 15_000,
    ...(startOffset !== undefined ? { startOffset } : {}),
  };
}

function streamSignal(request: CompatCommandRequest): AbortSignal {
  return request.context.abortSignal ?? new AbortController().signal;
}

export function createCompatCommandDispatcher(
  options: CompatDispatcherOptions = {},
): CompatCommandDispatcher {
  const sdk = options.sdk ?? createCursorAgentSdk();

  return {
    capabilities: COMPAT_COMMAND_CAPABILITIES,
    async execute(request: CompatCommandRequest): Promise<CompatCommandResult> {
      const decision = decideCompatCommand(request.name, request.kind);
      if (!decision.ok) {
        throw commandError(
          request,
          decision.reason ?? "command cannot be executed",
          decision.capability?.status === "unsupported" ? 501 : 400,
          decision.capability,
        );
      }
      const capability = decision.capability;
      if (capability === undefined) {
        throw commandError(request, "unknown command", 400);
      }
      const auth = authorizeCompatCommand(
        capability,
        request.context.auth ?? options.auth ?? { mode: "disabled" },
      );
      if (!auth.ok) {
        throw commandError(
          request,
          auth.reason ?? "not authorized",
          auth.status ?? 403,
          capability,
          auth.required,
        );
      }

      const params = objectParam(request.params);
      try {
        switch (request.name) {
          case "version.get":
            return {
              kind: "single",
              value: {
                packageName: "cursor-cli-agent",
                packageVersion: pkg.version,
                capabilities: COMPAT_COMMAND_CAPABILITIES,
                provenance: "compat-bridge",
              },
            };
          case "session.list":
            return {
              kind: "single",
              value: {
                sessions: await sdk.sessions.list({
                  limit: positiveLimit(params),
                }),
                provenance: "index",
              },
            };
          case "session.show":
            return {
              kind: "single",
              value: {
                session: await sdk.sessions.get(
                  requiredString(params, "id", request.name),
                ),
                provenance: "index",
              },
            };
          case "session.search":
            return {
              kind: "single",
              value: await sdk.search.sessions({
                query: requiredString(params, "query", request.name),
                limit: positiveLimit(params),
                offset: numberParam(params, "offset") ?? 0,
              }),
            };
          case "session.searchTranscript":
            return {
              kind: "single",
              value: await sdk.search.transcripts({
                query: requiredString(params, "query", request.name),
                limit: positiveLimit(params),
                offset: numberParam(params, "offset") ?? 0,
              }),
            };
          case "session.run":
            return {
              kind: "single",
              value: await collectRun(
                sdk.runner.start(
                  runRequest({
                    prompt: requiredString(params, "prompt", request.name),
                    cwd: request.context.workspace,
                    model: stringParam(params, "model"),
                  }),
                ),
              ),
            };
          case "session.resume":
            return {
              kind: "single",
              value: await collectRun(
                sdk.runner.resume(
                  resumeRequest({
                    sessionId: requiredString(params, "id", request.name),
                    prompt: stringParam(params, "prompt"),
                    cwd: request.context.workspace,
                  }),
                ),
              ),
            };
          case "session.create":
            return {
              kind: "single",
              value: await collectRun(
                sdk.runner.start(
                  runRequest({
                    prompt: requiredString(params, "prompt", request.name),
                    cwd: request.context.workspace,
                  }),
                ),
              ),
            };
          case "session.cancel":
            throw commandError(
              request,
              "session cancellation is degraded until daemon process supervision owns active runs",
              409,
              capability,
            );
          case "session.watch": {
            const id = requiredString(params, "id", request.name);
            const streams = options.streams;
            if (streams === undefined) {
              return {
                kind: "stream",
                values: oneValue({
                  id,
                  status: "degraded",
                  limitations: capability.limitations,
                  provenance: "compat-bridge",
                }),
              };
            }
            return {
              kind: "stream",
              values: streams.watchSession(
                id,
                streamOptions(params),
                streamSignal(request),
              ),
            };
          }
          case "group.list":
            return {
              kind: "single",
              value: {
                groups: await sdk.groups.list(),
                provenance: "compat-bridge",
              },
            };
          case "group.show":
            return {
              kind: "single",
              value: {
                group: await sdk.groups.get(
                  requiredString(params, "name", request.name),
                ),
                provenance: "compat-bridge",
              },
            };
          case "group.create": {
            const group = await sdk.groups.create(
              requiredString(params, "name", request.name),
            );
            const workspaces = params["workspaces"];
            if (Array.isArray(workspaces)) {
              let current = group;
              for (const workspace of workspaces) {
                if (typeof workspace === "string" && workspace.length > 0) {
                  current = await sdk.groups.addWorkspace(
                    group.name,
                    workspace,
                  );
                }
              }
              return { kind: "single", value: current };
            }
            return { kind: "single", value: group };
          }
          case "group.add":
            return {
              kind: "single",
              value: await sdk.groups.addWorkspace(
                requiredString(params, "name", request.name),
                requiredString(params, "workspace", request.name),
              ),
            };
          case "group.remove":
            return {
              kind: "single",
              value: await sdk.groups.removeWorkspace(
                requiredString(params, "name", request.name),
                requiredString(params, "workspace", request.name),
              ),
            };
          case "group.pause":
            return {
              kind: "single",
              value: await sdk.groups.pause(
                requiredString(params, "name", request.name),
              ),
            };
          case "group.resume":
            return {
              kind: "single",
              value: await sdk.groups.resume(
                requiredString(params, "name", request.name),
              ),
            };
          case "group.delete":
            return {
              kind: "single",
              value: await sdk.groups.delete(
                requiredString(params, "name", request.name),
              ),
            };
          case "group.run":
            return {
              kind: "single",
              value: await collectRun(
                sdk.runner.start(
                  runRequest({
                    prompt: requiredString(params, "prompt", request.name),
                    cwd:
                      stringParam(params, "workspace") ??
                      request.context.workspace,
                  }),
                ),
              ),
            };
          case "group.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchGroup(
                  requiredString(params, "name", request.name),
                  streamOptions(params),
                  streamSignal(request),
                ),
              };
            }
            return {
              kind: "stream",
              values: oneValue(
                await sdk.groups.progress(
                  requiredString(params, "name", request.name),
                ),
              ),
            };
          case "queue.list":
            return {
              kind: "single",
              value: {
                queues: await sdk.queues.list(),
                provenance: "compat-bridge",
              },
            };
          case "queue.show":
            return {
              kind: "single",
              value: {
                queue: await sdk.queues.get(
                  requiredString(params, "name", request.name),
                ),
                provenance: "compat-bridge",
              },
            };
          case "queue.create":
            return {
              kind: "single",
              value: await sdk.queues.create(
                requiredString(params, "name", request.name),
                stringParam(params, "workspace") ??
                  request.context.workspace ??
                  process.cwd(),
              ),
            };
          case "queue.add":
            return {
              kind: "single",
              value: await sdk.queues.addItem(
                requiredString(params, "name", request.name),
                requiredString(params, "prompt", request.name),
              ),
            };
          case "queue.remove":
            return {
              kind: "single",
              value: await sdk.queues.removeItem(
                requiredString(params, "name", request.name),
                requiredString(params, "item", request.name),
              ),
            };
          case "queue.update": {
            const name = requiredString(params, "name", request.name);
            const item = requiredString(params, "item", request.name);
            const prompt = stringParam(params, "prompt");
            const status = queueItemStatusParam(params, "status", request.name);
            if (prompt === undefined && status === undefined) {
              throw new Error(`${request.name}: prompt or status is required`);
            }
            const updated = await sdk.queues.updateItem(name, item, {
              ...(prompt !== undefined ? { prompt } : {}),
              ...(status !== undefined ? { status } : {}),
            });
            if (updated === null) {
              throw commandError(request, "queue not found", 404, capability);
            }
            return { kind: "single", value: updated };
          }
          case "queue.move": {
            const name = requiredString(params, "name", request.name);
            const from = integerParam(params, "from", request.name);
            const to = integerParam(params, "to", request.name);
            const existing = await sdk.queues.get(name);
            if (existing === null) {
              throw commandError(request, "queue not found", 404, capability);
            }
            if (
              existing.items.length === 0 ||
              from >= existing.items.length ||
              to >= existing.items.length
            ) {
              throw new Error(`${request.name}: index out of range`);
            }
            const moved = await sdk.queues.moveItem(name, from, to);
            if (moved === null) {
              throw commandError(request, "queue not found", 404, capability);
            }
            return { kind: "single", value: moved };
          }
          case "queue.mode": {
            const name = requiredString(params, "name", request.name);
            const item = requiredString(params, "item", request.name);
            const mode = queueItemModeParam(params, "mode", request.name);
            const updated = await sdk.queues.setItemMode(name, item, mode);
            if (updated === null) {
              throw commandError(request, "queue not found", 404, capability);
            }
            return { kind: "single", value: updated };
          }
          case "queue.pause":
            return {
              kind: "single",
              value: await sdk.queues.pause(
                requiredString(params, "name", request.name),
              ),
            };
          case "queue.resume":
            return {
              kind: "single",
              value: await sdk.queues.resume(
                requiredString(params, "name", request.name),
              ),
            };
          case "queue.delete":
            return {
              kind: "single",
              value: await sdk.queues.delete(
                requiredString(params, "name", request.name),
              ),
            };
          case "queue.run":
            return {
              kind: "single",
              value: await collectRun(
                sdk.runner.start(
                  runRequest({
                    prompt: requiredString(params, "prompt", request.name),
                    cwd:
                      stringParam(params, "workspace") ??
                      request.context.workspace,
                  }),
                ),
              ),
            };
          case "queue.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchQueue(
                  requiredString(params, "name", request.name),
                  streamOptions(params),
                  streamSignal(request),
                ),
              };
            }
            return {
              kind: "stream",
              values: oneValue(
                await sdk.queues.progress(
                  requiredString(params, "name", request.name),
                ),
              ),
            };
          case "bookmark.list":
            return {
              kind: "single",
              value: {
                bookmarks: await sdk.bookmarks.list(),
                provenance: "compat-bridge",
              },
            };
          case "bookmark.get":
            return {
              kind: "single",
              value: {
                bookmark: await sdk.bookmarks.show(
                  requiredString(params, "id", request.name),
                ),
              },
            };
          case "bookmark.search":
            return {
              kind: "single",
              value: await sdk.bookmarks.search(
                requiredString(params, "query", request.name),
                { limit: positiveLimit(params) },
              ),
            };
          case "bookmark.add":
            return {
              kind: "single",
              value: await sdk.bookmarks.add({
                type: "session",
                sessionId: requiredString(params, "sessionId", request.name),
                name: requiredString(params, "name", request.name),
              }),
            };
          case "bookmark.delete":
            return {
              kind: "single",
              value: {
                deleted: await sdk.bookmarks.delete(
                  requiredString(params, "id", request.name),
                ),
              },
            };
          case "files.list":
            return {
              kind: "single",
              value: await sdk.files.list(
                requiredString(params, "sessionId", request.name),
              ),
            };
          case "files.find":
            return {
              kind: "single",
              value: await sdk.files.find(
                requiredString(params, "path", request.name),
              ),
            };
          case "files.snapshots":
            return {
              kind: "single",
              value: await sdk.files.snapshots(
                requiredString(params, "sessionId", request.name),
              ),
            };
          case "files.deleted":
            return {
              kind: "single",
              value: await sdk.files.deleted(
                requiredString(params, "sessionId", request.name),
              ),
            };
          case "files.rebuild":
            return { kind: "single", value: await sdk.files.rebuild() };
          case "activity.list":
            return {
              kind: "single",
              value: {
                activity: await sdk.activity.list({
                  limit: positiveLimit(params),
                }),
                provenance: "compat-bridge",
              },
            };
          case "activity.show":
            return {
              kind: "single",
              value: await sdk.activity.get(
                requiredString(params, "id", request.name),
              ),
            };
          case "activity.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchActivity(
                  stringParam(params, "id"),
                  streamOptions(params),
                  streamSignal(request),
                ),
              };
            }
            return {
              kind: "stream",
              values: oneValue(
                await sdk.activity.get(
                  requiredString(params, "id", request.name),
                ),
              ),
            };
          case "skill.list":
            return {
              kind: "single",
              value: {
                skills: await listSkillRecords({
                  projectRoot: request.context.workspace ?? process.cwd(),
                }),
                limitations: capability.limitations,
                provenance: "compat-bridge",
              },
            };
          default:
            throw commandError(
              request,
              `command ${request.name} is not implemented by the compatibility dispatcher`,
              501,
              capability,
            );
        }
      } catch (error) {
        if (error instanceof CompatCommandError) {
          throw error;
        }
        throw commandError(
          request,
          error instanceof Error ? error.message : "compat command failed",
          400,
          capability,
        );
      }
    },
  };
}

export function createDefaultCompatCommandDispatcher(
  context: CompatExecutionContext = {},
): CompatCommandDispatcher {
  const sdk = createCursorAgentSdk({
    ...(context.dataDir !== undefined ? { stateRoot: context.dataDir } : {}),
    ...(context.cursorHome !== undefined
      ? { cursorHome: context.cursorHome }
      : {}),
  });
  return createCompatCommandDispatcher({
    sdk,
    ...(context.auth !== undefined ? { auth: context.auth } : {}),
  });
}
