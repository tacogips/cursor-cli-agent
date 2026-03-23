import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import pkg from "../../package.json" with { type: "json" };

import {
  agentTranscriptsDirForWorkspace,
  getDataDir,
  stateDbPath,
} from "../config/paths";
import {
  createChat,
  type HeadlessRunOptions,
  isTrustFailureMessage,
  type ResumeRunOptions,
  resumeStreaming,
  runHeadlessStreaming,
} from "../cursor/process-runner";
import { StreamNormalizerState } from "../cursor/stream-normalizer";
import { loadAiTrackingEnrichment } from "../cursor/ai-tracking-reader";
import { findSkillByName, listSkillRecords } from "../cursor/skill-catalog";
import {
  parseTranscriptLine,
  readTranscriptFile,
} from "../cursor/transcript-reader";
import * as groupsStore from "../persistence/groups-store";
import * as queuesStore from "../persistence/queues-store";
import { SessionIndexRepository } from "../persistence/session-index";
import type { AgentEvent } from "../types/agent-event";

const EXIT = {
  OK: 0,
  ERR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CURSOR: 4,
  TRUST: 5,
  TRANSCRIPT: 6,
} as const;

function runnerPassthroughFromFlags(
  flags: Record<string, string | boolean>,
): Pick<
  HeadlessRunOptions,
  "sandbox" | "approveMcps" | "worktree" | "worktreeBase" | "skipWorktreeSetup"
> {
  const sandbox = flags["sandbox"];
  const wt = flags["worktree"];
  const wtb = flags["worktree-base"];
  return {
    ...(sandbox === "enabled" || sandbox === "disabled" ? { sandbox } : {}),
    ...(flags["approve-mcps"] === true ? { approveMcps: true as const } : {}),
    ...(wt === true
      ? { worktree: true as const }
      : typeof wt === "string" && wt.length > 0
        ? { worktree: wt }
        : {}),
    ...(typeof wtb === "string" && wtb.length > 0 ? { worktreeBase: wtb } : {}),
    ...(flags["skip-worktree-setup"] === true
      ? { skipWorktreeSetup: true as const }
      : {}),
  };
}

function buildHeadlessRunOptions(
  workspace: string,
  prompt: string,
  flags: Record<string, string | boolean>,
): HeadlessRunOptions {
  return {
    workspace,
    prompt,
    ...(typeof flags["model"] === "string" ? { model: flags["model"] } : {}),
    ...(flags["mode"] === "plan" || flags["mode"] === "ask"
      ? { mode: flags["mode"] }
      : {}),
    ...(flags["trust"] === true ? { trust: true } : {}),
    ...(flags["force"] === true ? { force: true } : {}),
    ...(flags["yolo"] === true ? { yolo: true } : {}),
    ...(flags["stream-partial-output"] === true
      ? { streamPartialOutput: true }
      : {}),
    ...runnerPassthroughFromFlags(flags),
  };
}

function buildResumeRunOptions(
  workspace: string,
  sessionOrChatId: string,
  flags: Record<string, string | boolean>,
): ResumeRunOptions {
  return {
    workspace,
    sessionOrChatId,
    ...(typeof flags["prompt"] === "string" && flags["prompt"].length > 0
      ? { prompt: flags["prompt"] }
      : {}),
    ...(typeof flags["model"] === "string" ? { model: flags["model"] } : {}),
    ...(flags["mode"] === "plan" || flags["mode"] === "ask"
      ? { mode: flags["mode"] }
      : {}),
    ...(flags["trust"] === true ? { trust: true } : {}),
    ...(flags["force"] === true ? { force: true } : {}),
    ...(flags["yolo"] === true ? { yolo: true } : {}),
    ...(flags["stream-partial-output"] === true
      ? { streamPartialOutput: true }
      : {}),
    ...runnerPassthroughFromFlags(flags),
  };
}

function parseFlags(argv: string[]): {
  rest: string[];
  flags: Record<string, string | boolean>;
} {
  const rest: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) {
      break;
    }
    if (a === "--json") {
      flags["json"] = true;
    } else if (a === "--trust") {
      flags["trust"] = true;
    } else if (a === "--force") {
      flags["force"] = true;
    } else if (a === "--yolo") {
      flags["yolo"] = true;
    } else if (a === "--stream-partial-output") {
      flags["stream-partial-output"] = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { rest, flags };
}

function getWorkspace(flags: Record<string, string | boolean>): string {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve(w);
  }
  return resolve(process.cwd());
}

function getExplicitWorkspace(
  flags: Record<string, string | boolean>,
): string | undefined {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve(w);
  }
  return undefined;
}

function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function printEvents(events: readonly AgentEvent[], json: boolean): void {
  if (json) {
    for (const e of events) {
      printJson(e);
    }
  } else {
    for (const e of events) {
      console.log(JSON.stringify(e));
    }
  }
}

interface TextStreamRenderState {
  readonly lastAssistantBySession: Map<string, string>;
}

/**
 * Resolves `--stream` with optional `--json` as alias for `json` mode (parity with group/queue).
 * An explicit `--stream <value>` must be `text`, `json`, or `events`.
 */
function resolveStreamMode(
  flags: Record<string, string | boolean>,
): { mode: "text" | "json" | "events" } | { error: true } {
  const s = flags["stream"];
  if (s === "text" || s === "json" || s === "events") {
    return { mode: s };
  }
  if (typeof s === "string" && s.length > 0) {
    return { error: true };
  }
  if (flags["json"] === true) {
    return { mode: "json" };
  }
  return { mode: "events" };
}

function emitStreamedAgentEvents(
  stream: "text" | "json" | "events",
  evs: readonly AgentEvent[],
  textState?: TextStreamRenderState,
): void {
  if (stream === "text") {
    const state = textState;
    for (const e of evs) {
      if (e.type === "session.assistant_message") {
        process.stdout.write(e.message.displayText);
        state?.lastAssistantBySession.set(e.sessionId, e.message.displayText);
      }
      if (e.type === "session.completed") {
        const lastAssistant = state?.lastAssistantBySession.get(e.sessionId);
        if (lastAssistant !== e.result) {
          process.stdout.write(e.result);
        }
        state?.lastAssistantBySession.delete(e.sessionId);
      }
    }
  } else {
    printEvents(evs, stream === "json");
  }
}

async function openRepo(): Promise<SessionIndexRepository> {
  mkdirSync(getDataDir(), { recursive: true });
  return new SessionIndexRepository(stateDbPath());
}

export async function runCli(argv: string[]): Promise<number> {
  const [, , cmd, ...tail] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") {
    console.log(`Usage:
  cursor-cli-agent version
  cursor-cli-agent session list [--workspace <path>] [--limit N] [--json]
  cursor-cli-agent session show <id> [--workspace <path>] [--json]
  cursor-cli-agent session watch <id> [--workspace <path>] [--json]
  cursor-cli-agent session run --prompt <text> [options]
  cursor-cli-agent session create [--workspace <path>] [--json]
  cursor-cli-agent session resume <id> [--prompt <text>] [options]
  cursor-cli-agent session continue [--workspace <path>] [--stream <text|json|events>] [--json]
  cursor-cli-agent session attach <id> [--workspace <path>]
  cursor-cli-agent group <subcommand> ...
  cursor-cli-agent queue <subcommand> ...
  cursor-cli-agent skill list [--workspace <path>] [--json]
  cursor-cli-agent skill show <name> [--workspace <path>] [--json]
  cursor-cli-agent server ...  (phase 2; not implemented yet)
  cursor-cli-agent daemon ...  (phase 2; not implemented yet)
`);
    return EXIT.USAGE;
  }

  if (cmd === "version") {
    console.log(`cursor-cli-agent ${pkg.version}`);
    return EXIT.OK;
  }

  if (cmd === "server" || cmd === "daemon") {
    console.error(
      `${cmd}: not implemented in phase 1 (planned for phase 2; see design-docs/specs/command.md)`,
    );
    return EXIT.ERR;
  }

  if (cmd === "session") {
    return runSession(tail);
  }
  if (cmd === "group") {
    return runGroup(tail);
  }
  if (cmd === "queue") {
    return runQueue(tail);
  }
  if (cmd === "skill") {
    return runSkill(tail);
  }

  console.error(`Unknown command: ${cmd}`);
  return EXIT.USAGE;
}

async function runSession(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("session: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;
  const workspace = getWorkspace(flags);
  const explicitWorkspace = getExplicitWorkspace(flags);

  let runHeadlessPrompt: string | undefined;
  let resumeSessionId: string | undefined;
  let headlessStreamMode: "text" | "json" | "events" | undefined;

  if (sub === "run") {
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined || prompt.length === 0) {
      console.error("session run: --prompt is required");
      return EXIT.USAGE;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    runHeadlessPrompt = prompt;
    headlessStreamMode = sm.mode;
  }
  if (sub === "resume") {
    const sid = pos[0];
    if (sid === undefined || sid.length === 0) {
      console.error("session resume: missing session id");
      return EXIT.USAGE;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session resume: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    resumeSessionId = sid;
    headlessStreamMode = sm.mode;
  }
  if (sub === "continue") {
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("session continue: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    headlessStreamMode = sm.mode;
  }

  const repo = await openRepo();
  await repo.importTranscriptsFromFilesystem();

  if (sub === "list") {
    const limit =
      typeof flags["limit"] === "string" ? Number(flags["limit"]) : 20;
    const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
    const rows = repo.listSessionsForWorkspace(workspace, lim);
    if (json) {
      printJson({ sessions: rows });
    } else {
      for (const r of rows) {
        const pending =
          r.identityState === "chat_only" ? " [pending-chat]" : "";
        const id = r.localSessionId ?? r.cursorChatId ?? r.recordId;
        console.log(
          `${id}${pending}  ${r.workspaceSlug}  ${r.status}  ${r.updatedAt}`,
        );
      }
    }
    return EXIT.OK;
  }

  if (sub === "show") {
    const id = pos[0];
    if (id === undefined || id.length === 0) {
      console.error("session show: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(id);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    if (rec.identityState === "chat_only") {
      const body = {
        recordId: rec.recordId,
        identityState: rec.identityState,
        cursorChatId: rec.cursorChatId,
        workspaceSlug: rec.workspaceSlug,
        workspacePath: rec.workspacePath,
        status: rec.status,
        pendingTranscript: true,
        message: "Transcript has not materialized yet.",
      };
      if (json) {
        printJson(body);
      } else {
        console.log(`Pending chat session (no transcript yet)`);
        console.log(`cursorChatId: ${rec.cursorChatId ?? ""}`);
        console.log(`workspace: ${rec.workspacePath ?? rec.workspaceSlug}`);
      }
      return EXIT.OK;
    }
    if (rec.transcriptPath === undefined) {
      console.error("session has no transcript path");
      return EXIT.TRANSCRIPT;
    }
    let summary;
    try {
      summary = await readTranscriptFile(rec.transcriptPath);
    } catch {
      console.error("failed to read transcript");
      return EXIT.TRANSCRIPT;
    }
    const convId = rec.localSessionId ?? rec.cursorChatId;
    const aiTracking =
      convId !== undefined ? loadAiTrackingEnrichment(convId) : undefined;
    if (json) {
      printJson({
        record: rec,
        messages: summary.lines.map((l) => ({
          role: l.role,
          rawText: l.message.rawText,
          displayText: l.message.displayText,
          structured: l.message.structured,
        })),
        ...(aiTracking !== undefined ? { aiTracking } : {}),
      });
    } else {
      console.log(`Session ${rec.localSessionId ?? rec.recordId}`);
      console.log(`Workspace: ${rec.workspacePath ?? rec.workspaceSlug}`);
      const fu = summary.firstUserMessage;
      const la = summary.lastAssistantMessage;
      if (fu !== undefined) {
        console.log(`First user (display): ${fu.displayText}`);
      }
      if (la !== undefined) {
        console.log(`Last assistant (display): ${la.displayText}`);
      }
      if (aiTracking !== undefined) {
        const touches = aiTracking.codeTouches.length;
        const deleted = aiTracking.deletedFiles.length;
        const tracked = aiTracking.trackedFiles.length;
        console.log(
          `AI tracking: code touches=${touches}, deleted files=${deleted}, tracked snapshots=${tracked}`,
        );
      }
    }
    return EXIT.OK;
  }

  if (sub === "watch") {
    const id = pos[0];
    if (id === undefined || id.length === 0) {
      console.error("session watch: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(id);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    let watchInterrupted = false;
    const stopWatch = (): void => {
      watchInterrupted = true;
    };
    process.once("SIGINT", stopWatch);
    process.once("SIGTERM", stopWatch);
    if (rec.identityState === "chat_only" && rec.cursorChatId !== undefined) {
      const ws = rec.workspacePath ?? workspace;
      const expected = join(
        agentTranscriptsDirForWorkspace(ws),
        `${rec.cursorChatId}.jsonl`,
      );
      const pendingEvent = {
        type: "session.pending",
        recordId: rec.recordId,
        cursorChatId: rec.cursorChatId,
        workspacePath: ws,
      } as const;
      printEvents([pendingEvent], json);
      while (!existsSync(expected) && !watchInterrupted) {
        await new Promise((r) => setTimeout(r, 750));
        await repo.importTranscriptsFromFilesystem();
      }
      if (watchInterrupted) {
        process.off("SIGINT", stopWatch);
        process.off("SIGTERM", stopWatch);
        return EXIT.OK;
      }
      const linked = repo.resolveSessionKey(id);
      const materialSessionId =
        linked?.localSessionId ?? rec.cursorChatId ?? id;
      const mat = {
        type: "session.materialized",
        recordId: rec.recordId,
        sessionId: materialSessionId,
        cursorChatId: rec.cursorChatId,
      } as const;
      printEvents([mat], json);
    }
    const updated = repo.resolveSessionKey(id);
    const path = updated?.transcriptPath;
    if (path === undefined) {
      console.error("no transcript to watch");
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
      return EXIT.TRANSCRIPT;
    }
    const sessionKey = updated?.localSessionId ?? id;
    let offset = 0;
    const pump = async (): Promise<void> => {
      if (watchInterrupted) {
        return;
      }
      const buf = await readFile(path, "utf8");
      const chunk = buf.slice(offset);
      offset = buf.length;
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        if (watchInterrupted) {
          return;
        }
        const t = parseTranscriptLine(line);
        if (t === undefined) {
          continue;
        }
        const ev =
          t.role === "user"
            ? ({
                type: "session.user_message",
                sessionId: sessionKey,
                message: t.message,
              } as const)
            : ({
                type: "session.assistant_message",
                sessionId: sessionKey,
                message: t.message,
              } as const);
        printEvents([ev], json);
      }
    };
    await pump();
    if (watchInterrupted) {
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
      return EXIT.OK;
    }
    const pollMs = 1000;
    const handle = setInterval(() => {
      void pump().catch(() => undefined);
    }, pollMs);
    if (typeof handle.unref === "function") {
      handle.unref();
    }
    return await new Promise<number>((resolve) => {
      const shutdown = (): void => {
        watchInterrupted = true;
        clearInterval(handle);
        resolve(EXIT.OK);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
    });
  }

  if (sub === "run") {
    const stream = headlessStreamMode!;
    const prompt = runHeadlessPrompt!;
    const norm = new StreamNormalizerState();
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    const exit = await runHeadlessStreaming(
      buildHeadlessRunOptions(workspace, prompt, flags),
      (line) => {
        emitStreamedAgentEvents(stream, norm.processLine(line), textState);
      },
    );
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "create") {
    try {
      const { chatId } = await createChat(workspace);
      const rec = repo.insertPendingChatRecord(chatId, workspace);
      if (json) {
        printJson({ record: rec, cursorChatId: chatId });
      } else {
        console.log(chatId);
      }
      return EXIT.OK;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      return EXIT.CURSOR;
    }
  }

  if (sub === "resume") {
    const stream = headlessStreamMode!;
    const sid = resumeSessionId!;
    const known = repo.resolveSessionKey(sid);
    const resumeWorkspace = explicitWorkspace ?? known?.workspacePath ?? workspace;
    const norm = new StreamNormalizerState();
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    const exit = await resumeStreaming(
      buildResumeRunOptions(resumeWorkspace, sid, flags),
      (line) => {
        emitStreamedAgentEvents(stream, norm.processLine(line), textState);
      },
    );
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "continue") {
    const rows = repo.listSessionsForWorkspace(workspace, 50);
    const latest = rows[0];
    if (
      latest === undefined ||
      (latest.localSessionId === undefined && latest.cursorChatId === undefined)
    ) {
      console.error("no session to continue");
      return EXIT.NOT_FOUND;
    }
    const sid = latest.localSessionId ?? latest.cursorChatId ?? "";
    const stream = headlessStreamMode!;
    const textState: TextStreamRenderState = {
      lastAssistantBySession: new Map(),
    };
    const norm = new StreamNormalizerState();
    const exit = await resumeStreaming(
      buildResumeRunOptions(workspace, sid, flags),
      (line) => {
        emitStreamedAgentEvents(stream, norm.processLine(line), textState);
      },
    );
    if (isTrustFailureMessage(exit.stderr)) {
      console.error(exit.stderr);
      return EXIT.TRUST;
    }
    await repo.importTranscriptsFromFilesystem();
    if (exit.code !== 0 && exit.code !== null) {
      console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
      return EXIT.CURSOR;
    }
    return EXIT.OK;
  }

  if (sub === "attach") {
    const sid = pos[0];
    if (sid === undefined || sid.length === 0) {
      console.error("session attach: missing session id");
      return EXIT.USAGE;
    }
    const rec = repo.resolveSessionKey(sid);
    if (rec === undefined) {
      console.error("session not found");
      return EXIT.NOT_FOUND;
    }
    const target = rec.cursorChatId ?? rec.localSessionId ?? sid;
    const attachWorkspace = explicitWorkspace ?? rec.workspacePath ?? workspace;
    const proc = spawn("cursor-agent", ["--resume", target], {
      cwd: attachWorkspace,
      stdio: "inherit",
    });
    try {
      const code = await new Promise<number>((resolve, reject) => {
        proc.once("close", (exitCode, signal) => {
          if (signal !== null) {
            resolve(EXIT.OK);
            return;
          }
          resolve(exitCode === 0 ? EXIT.OK : EXIT.CURSOR);
        });
        proc.once("error", reject);
      });
      return code;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      return EXIT.CURSOR;
    }
  }

  console.error(`Unknown session subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runGroup(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("group: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;

  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group create: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.createGroup(name);
    if (json) {
      printJson(g);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await groupsStore.listGroups();
    if (json) {
      printJson({ groups: rows });
    } else {
      for (const g of rows) {
        console.log(`${g.name}: ${g.workspaces.length} workspaces`);
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group show: missing name");
      return EXIT.USAGE;
    }
    const g = await groupsStore.getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(JSON.stringify(g, null, 2));
    }
    return EXIT.OK;
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group add: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await groupsStore.addWorkspaceToGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "remove") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group remove: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await groupsStore.removeWorkspaceFromGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group run: missing name");
      return EXIT.USAGE;
    }
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("group run: --prompt is required");
      return EXIT.USAGE;
    }
    const g = await groupsStore.getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("group run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const repo = await openRepo();
    for (const w of g.workspaces) {
      const norm = new StreamNormalizerState();
      const textState: TextStreamRenderState = {
        lastAssistantBySession: new Map(),
      };
      const exit = await runHeadlessStreaming(
        buildHeadlessRunOptions(resolve(w), prompt, flags),
        (line) => {
          emitStreamedAgentEvents(stream, norm.processLine(line), textState);
        },
      );
      if (isTrustFailureMessage(exit.stderr)) {
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        console.error(exit.stderr || `run failed in ${w}`);
        return EXIT.CURSOR;
      }
      await repo.importTranscriptsFromFilesystem();
    }
    return EXIT.OK;
  }

  console.error(`Unknown group subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runQueue(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("queue: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;

  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue create: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    const q = await queuesStore.createQueue(name, ws);
    if (json) {
      printJson(q);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await queuesStore.listQueues();
    if (json) {
      printJson({ queues: rows });
    } else {
      for (const q of rows) {
        console.log(`${q.name} (${q.workspace}): ${q.items.length} items`);
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue show: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(JSON.stringify(q, null, 2));
    }
    return EXIT.OK;
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue add: missing name");
      return EXIT.USAGE;
    }
    const prompt =
      typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("queue add: --prompt is required");
      return EXIT.USAGE;
    }
    await queuesStore.addQueueItem(name, prompt);
    return EXIT.OK;
  }
  if (sub === "remove") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue remove: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue remove: --item is required");
      return EXIT.USAGE;
    }
    await queuesStore.removeQueueItem(name, item);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue run: missing name");
      return EXIT.USAGE;
    }
    const q = await queuesStore.getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("queue run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const repo = await openRepo();
    for (const item of q.items) {
      const norm = new StreamNormalizerState();
      const textState: TextStreamRenderState = {
        lastAssistantBySession: new Map(),
      };
      const exit = await runHeadlessStreaming(
        buildHeadlessRunOptions(q.workspace, item.prompt, flags),
        (line) => {
          emitStreamedAgentEvents(stream, norm.processLine(line), textState);
        },
      );
      if (isTrustFailureMessage(exit.stderr)) {
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
        return EXIT.CURSOR;
      }
      await queuesStore.removeQueueItem(name, item.id);
      await repo.importTranscriptsFromFilesystem();
    }
    return EXIT.OK;
  }

  console.error(`Unknown queue subcommand: ${sub}`);
  return EXIT.USAGE;
}

async function runSkill(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("skill: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags(rest);
  const json = flags["json"] === true;
  const workspace = getWorkspace(flags);

  if (sub === "list") {
    const rows = await listSkillRecords({ projectRoot: workspace });
    if (json) {
      printJson({ skills: rows });
    } else {
      for (const s of rows) {
        const desc = s.description !== undefined ? `  ${s.description}` : "";
        console.log(`[${s.scope}] ${s.name}${desc}`);
      }
    }
    return EXIT.OK;
  }

  if (sub === "show") {
    const name = pos[0];
    if (name === undefined || name.length === 0) {
      console.error("skill show: missing name");
      return EXIT.USAGE;
    }
    const rec = await findSkillByName(name, { projectRoot: workspace });
    if (rec === undefined) {
      console.error("skill not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(rec);
    } else {
      console.log(`name: ${rec.name}`);
      console.log(`scope: ${rec.scope}`);
      console.log(`path: ${rec.path}`);
      console.log(`disableModelInvocation: ${rec.disableModelInvocation}`);
      if (rec.description !== undefined) {
        console.log(`description: ${rec.description}`);
      }
    }
    return EXIT.OK;
  }

  console.error(`Unknown skill subcommand: ${sub}`);
  return EXIT.USAGE;
}
