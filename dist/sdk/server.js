// @bun
// src/cursor/process-runner.ts
import { spawn as nodeSpawn } from "child_process";
import { once } from "events";
var cursorAgentSpawn = nodeSpawn;
function streamLines(proc, onLine, onStdoutChunk) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    proc.stdout?.on("data", (d) => {
      const chunk = d.toString("utf8");
      onStdoutChunk?.(chunk);
      buffer += chunk;
      let idx = buffer.indexOf(`
`);
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        onLine(line);
        idx = buffer.indexOf(`
`);
      }
    });
    proc.on("close", () => {
      if (buffer.trim().length > 0) {
        onLine(buffer);
      }
      resolve();
    });
    proc.on("error", reject);
  });
}
function appendPromptImageArgs(args, opts) {
  const img = opts.promptImages;
  if (img === undefined || img.paths.length === 0) {
    return;
  }
  for (const p of img.paths) {
    args.push(img.flag, p);
  }
}
function appendWorktreeArgs(args, opts) {
  if (opts.worktree !== undefined) {
    if (opts.worktree === true) {
      args.push("--worktree");
    } else {
      args.push("--worktree", opts.worktree);
    }
  }
  if (opts.worktreeBase !== undefined && opts.worktreeBase.length > 0) {
    args.push("--worktree-base", opts.worktreeBase);
  }
  if (opts.skipWorktreeSetup === true) {
    args.push("--skip-worktree-setup");
  }
}
var CURSOR_EFFORT_TOKENS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
var EXTRA_HIGH_EFFORT_MODEL_PREFIXES = ["gpt-5.5"];
function toCursorEffortToken(effort) {
  return effort;
}
function usesExtraHighEffortToken(modelBase) {
  return EXTRA_HIGH_EFFORT_MODEL_PREFIXES.some((prefix) => modelBase === prefix || modelBase.startsWith(`${prefix}-`));
}
function formatCursorEffortToken(modelBase, effort) {
  if (effort === "xhigh" && usesExtraHighEffortToken(modelBase)) {
    return "extra-high";
  }
  return toCursorEffortToken(effort);
}
function resolveModelForEffort(model, effort) {
  if (model === undefined || effort === undefined) {
    return model;
  }
  const fastSuffix = model.endsWith("-fast") ? "-fast" : "";
  const base = fastSuffix.length > 0 ? model.slice(0, -fastSuffix.length) : model;
  const requested = formatCursorEffortToken(base, effort);
  if (base.endsWith("-extra-high")) {
    const prefix = base.slice(0, -"extra-high".length);
    return `${prefix}${requested}${fastSuffix}`;
  }
  const tokens = base.split("-");
  const last = tokens.at(-1);
  if (last !== undefined && CURSOR_EFFORT_TOKENS.has(last)) {
    tokens[tokens.length - 1] = requested;
    return `${tokens.join("-")}${fastSuffix}`;
  }
  if (requested === "medium") {
    return model;
  }
  return `${base}-${requested}${fastSuffix}`;
}
function buildHeadlessArgs(opts) {
  const args = ["--print", "--output-format", "stream-json"];
  const model = resolveModelForEffort(opts.model, opts.effort);
  if (model !== undefined) {
    args.push("--model", model);
  }
  if (opts.mode !== undefined && opts.mode !== "default") {
    args.push("--mode", opts.mode);
  }
  if (opts.trust === true) {
    args.push("--trust");
  }
  if (opts.force === true) {
    args.push("--force");
  }
  if (opts.yolo === true) {
    args.push("--yolo");
  }
  if (opts.streamPartialOutput === true) {
    args.push("--stream-partial-output");
  }
  if (opts.sandbox !== undefined) {
    args.push("--sandbox", opts.sandbox);
  }
  if (opts.approveMcps === true) {
    args.push("--approve-mcps");
  }
  appendPromptImageArgs(args, opts);
  appendWorktreeArgs(args, opts);
  args.push("--", buildPromptWithSystemPrompt(opts.prompt, opts.systemPrompt));
  return args;
}
function buildPromptWithSystemPrompt(prompt, systemPrompt) {
  if (systemPrompt === undefined || systemPrompt.trim().length === 0) {
    return prompt;
  }
  return `${systemPrompt}

${prompt}`;
}
async function createChat(workspace) {
  const proc = cursorAgentSpawn("cursor-agent", ["create-chat"], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  proc.stderr?.on("data", (d) => {
    stderr += d.toString();
  });
  const chunks = [];
  proc.stdout?.on("data", (d) => {
    chunks.push(d);
  });
  const [exitCode] = await once(proc, "close");
  if (exitCode !== 0) {
    throw new Error(stderr.trim().length > 0 ? stderr.trim() : `create-chat exited with code ${exitCode}`);
  }
  let out = "";
  for (const c of chunks) {
    out += c.toString("utf8");
  }
  out = out.trim();
  const line = out.split(/\r?\n/).filter((l) => l.trim().length > 0).at(-1) ?? out;
  if (line.length === 0) {
    throw new Error("create-chat returned empty stdout");
  }
  return { chatId: line.trim(), stderr };
}
async function runHeadlessStreaming(opts, onLine) {
  return startHeadlessStreaming(opts, onLine).done;
}
function controlledProcess(proc, done) {
  const control = {
    done,
    ...proc.pid !== undefined ? { pid: proc.pid } : {},
    async cancel() {
      if (proc.killed) {
        return;
      }
      proc.kill("SIGTERM");
    },
    async interrupt() {
      if (proc.killed) {
        return;
      }
      proc.kill("SIGINT");
    }
  };
  return control;
}
function startHeadlessStreaming(opts, onLine) {
  const args = buildHeadlessArgs(opts);
  const proc = cursorAgentSpawn(opts.cursorBinary ?? "cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  proc.stderr?.on("data", (d) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine, (chunk) => {
    stdout += chunk;
  });
  const done = (async () => {
    const [code, signal] = await once(proc, "close");
    await linesDone;
    return { code, signal, stdout, stderr };
  })();
  return controlledProcess(proc, done);
}
function buildResumeArgs(opts) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--resume",
    opts.sessionOrChatId
  ];
  const model = resolveModelForEffort(opts.model, opts.effort);
  if (model !== undefined) {
    args.push("--model", model);
  }
  if (opts.mode !== undefined && opts.mode !== "default") {
    args.push("--mode", opts.mode);
  }
  if (opts.trust === true) {
    args.push("--trust");
  }
  if (opts.force === true) {
    args.push("--force");
  }
  if (opts.yolo === true) {
    args.push("--yolo");
  }
  if (opts.streamPartialOutput === true) {
    args.push("--stream-partial-output");
  }
  if (opts.sandbox !== undefined) {
    args.push("--sandbox", opts.sandbox);
  }
  if (opts.approveMcps === true) {
    args.push("--approve-mcps");
  }
  appendPromptImageArgs(args, opts);
  appendWorktreeArgs(args, opts);
  if (opts.prompt !== undefined && opts.prompt.length > 0) {
    args.push("--", buildPromptWithSystemPrompt(opts.prompt, opts.systemPrompt));
  }
  return args;
}
async function resumeStreaming(opts, onLine) {
  return startResumeStreaming(opts, onLine).done;
}
function startResumeStreaming(opts, onLine) {
  const args = buildResumeArgs(opts);
  const proc = cursorAgentSpawn(opts.cursorBinary ?? "cursor-agent", args, {
    cwd: opts.workspace,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  proc.stderr?.on("data", (d) => {
    stderr += d.toString();
  });
  const linesDone = streamLines(proc, onLine, (chunk) => {
    stdout += chunk;
  });
  const done = (async () => {
    const [code, signal] = await once(proc, "close");
    await linesDone;
    return { code, signal, stdout, stderr };
  })();
  return controlledProcess(proc, done);
}
function isTrustFailureMessage(text) {
  return text.includes("Workspace Trust Required");
}

// src/cursor/normalize-message.ts
var USER_QUERY_WRAP = /^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/;
function normalizeTextBlock(role, rawText) {
  if (role === "user") {
    const m = rawText.match(USER_QUERY_WRAP);
    if (m?.[1] !== undefined) {
      const inner = m[1];
      return {
        role: "user",
        rawText,
        displayText: inner,
        structured: { userQueryText: inner }
      };
    }
  }
  return { role, rawText, displayText: rawText };
}
function joinTextParts(parts) {
  let out = "";
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") {
      out += p.text;
    }
  }
  return out;
}

// src/cursor/stream-normalizer.ts
function isRecord(v) {
  return typeof v === "object" && v !== null;
}
function readString(r, key) {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}
function parseUsage(raw) {
  if (!isRecord(raw)) {
    return;
  }
  const inputTokens = raw["inputTokens"];
  const outputTokens = raw["outputTokens"];
  const cacheReadTokens = raw["cacheReadTokens"];
  const cacheWriteTokens = raw["cacheWriteTokens"];
  const totalCamel = raw["totalTokens"];
  const totalSnake = raw["total_tokens"];
  const rawTotal = typeof totalCamel === "number" ? totalCamel : typeof totalSnake === "number" ? totalSnake : undefined;
  const totalTokens = rawTotal !== undefined && Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : undefined;
  const u = {
    ...typeof inputTokens === "number" ? { inputTokens } : {},
    ...typeof outputTokens === "number" ? { outputTokens } : {},
    ...typeof cacheReadTokens === "number" ? { cacheReadTokens } : {},
    ...typeof cacheWriteTokens === "number" ? { cacheWriteTokens } : {},
    ...typeof totalTokens === "number" ? { totalTokens } : {}
  };
  if (u.inputTokens === undefined && u.outputTokens === undefined && u.cacheReadTokens === undefined && u.cacheWriteTokens === undefined && u.totalTokens === undefined) {
    return;
  }
  return u;
}
function messageFromStreamUserContent(role, msg) {
  if (!isRecord(msg)) {
    return;
  }
  const content = msg["content"];
  if (!Array.isArray(content)) {
    return;
  }
  const rawText = joinTextParts(content);
  return normalizeTextBlock(role, rawText);
}
function extendPartialAssistantText(accumulated, chunk) {
  if (chunk.length === 0) {
    return { next: accumulated, delta: "" };
  }
  if (accumulated.length > 0 && chunk.startsWith(accumulated)) {
    return { next: chunk, delta: chunk.slice(accumulated.length) };
  }
  return { next: accumulated + chunk, delta: chunk };
}
function isStreamPartialTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

class StreamNormalizerState {
  lastAssistantBySession = new Map;
  partialAssistantTextBySession = new Map;
  processLine(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [
        {
          type: "session.error",
          message: "Invalid JSON in stream-json line"
        }
      ];
    }
    if (!isRecord(parsed)) {
      return [];
    }
    const t = readString(parsed, "type");
    const sessionId = readString(parsed, "session_id");
    if (t === "system" && readString(parsed, "subtype") === "init") {
      const cwd = readString(parsed, "cwd");
      const model = readString(parsed, "model");
      if (sessionId !== undefined && cwd !== undefined) {
        const ev = model !== undefined ? { type: "session.started", sessionId, cwd, model } : { type: "session.started", sessionId, cwd };
        return [ev];
      }
      return [];
    }
    if (t === "user" && sessionId !== undefined) {
      const msg = parsed["message"];
      const nm = messageFromStreamUserContent("user", msg);
      if (nm !== undefined) {
        return [{ type: "session.user_message", sessionId, message: nm }];
      }
      return [];
    }
    if (t === "assistant" && sessionId !== undefined) {
      const msg = parsed["message"];
      const nm = messageFromStreamUserContent("assistant", msg);
      if (nm === undefined) {
        return [];
      }
      const tsMs = parsed["timestamp_ms"];
      if (isStreamPartialTimestamp(tsMs)) {
        const prevAcc = this.partialAssistantTextBySession.get(sessionId) ?? "";
        const { next, delta } = extendPartialAssistantText(prevAcc, nm.rawText);
        this.partialAssistantTextBySession.set(sessionId, next);
        if (delta.length === 0) {
          return [];
        }
        const deltaMsg = normalizeTextBlock("assistant", delta);
        return [
          { type: "session.assistant_message", sessionId, message: deltaMsg }
        ];
      }
      const partialAcc = this.partialAssistantTextBySession.get(sessionId);
      if (partialAcc !== undefined && partialAcc.length > 0) {
        if (nm.rawText === partialAcc) {
          this.partialAssistantTextBySession.delete(sessionId);
          this.lastAssistantBySession.set(sessionId, nm.rawText);
          return [];
        }
        if (nm.rawText.startsWith(partialAcc)) {
          const tail = nm.rawText.slice(partialAcc.length);
          this.partialAssistantTextBySession.delete(sessionId);
          this.lastAssistantBySession.set(sessionId, nm.rawText);
          if (tail.length === 0) {
            return [];
          }
          const tailMsg = normalizeTextBlock("assistant", tail);
          return [
            { type: "session.assistant_message", sessionId, message: tailMsg }
          ];
        }
        this.partialAssistantTextBySession.delete(sessionId);
      }
      const prev = this.lastAssistantBySession.get(sessionId);
      if (prev === nm.rawText) {
        return [];
      }
      this.lastAssistantBySession.set(sessionId, nm.rawText);
      return [{ type: "session.assistant_message", sessionId, message: nm }];
    }
    if (t === "thinking" && sessionId !== undefined) {
      const st = readString(parsed, "subtype");
      if (st === "delta") {
        return [{ type: "session.thinking", sessionId, state: "delta" }];
      }
      if (st === "completed") {
        return [{ type: "session.thinking", sessionId, state: "completed" }];
      }
      return [];
    }
    if (t === "result" && sessionId !== undefined) {
      const resultText = readString(parsed, "result") ?? "";
      const isError = parsed["is_error"] === true;
      const usage = parseUsage(parsed["usage"]);
      this.lastAssistantBySession.delete(sessionId);
      this.partialAssistantTextBySession.delete(sessionId);
      if (isError) {
        return [
          {
            type: "session.error",
            sessionId,
            message: resultText.length > 0 ? resultText : "Result error"
          }
        ];
      }
      const out = {
        type: "session.completed",
        sessionId,
        result: resultText
      };
      if (usage !== undefined) {
        return [{ ...out, usage }];
      }
      return [out];
    }
    return [];
  }
}

// src/types/agent-event.ts
function sessionIdFromEvent(event) {
  switch (event.type) {
    case "session.started":
    case "session.user_message":
    case "session.thinking":
    case "session.assistant_message":
    case "session.completed":
      return event.sessionId;
    case "session.error":
      return event.sessionId;
    case "session.pending":
      return event.cursorChatId;
    case "session.materialized":
      return event.sessionId;
    default: {
      const _exhaustive = event;
      return _exhaustive;
    }
  }
}

// src/sdk/agent-runner.ts
class AsyncEventQueue {
  values = [];
  waiters = [];
  closed = false;
  push(value) {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ done: false, value });
      return;
    }
    this.values.push(value);
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }
  next() {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

class RunningAgent {
  queue;
  process;
  completion;
  currentSessionId;
  constructor(initialSessionId, queue, process2, completion) {
    this.queue = queue;
    this.process = process2;
    this.completion = completion;
    this.currentSessionId = initialSessionId;
  }
  get sessionId() {
    return this.currentSessionId;
  }
  async* messages() {
    while (true) {
      const next = await this.queue.next();
      if (next.done === true) {
        return;
      }
      this.rememberSessionId(next.value);
      yield next.value;
    }
  }
  waitForCompletion() {
    return this.completion.then((result) => {
      this.currentSessionId = result.sessionId;
      return result;
    });
  }
  cancel() {
    return this.process.cancel();
  }
  interrupt() {
    return this.process.interrupt();
  }
  rememberSessionId(event) {
    const sessionId = sessionIdFromEvent(event);
    if (sessionId !== undefined) {
      this.currentSessionId = sessionId;
    }
  }
}
function runResult(exit, sessionId, events) {
  return {
    sessionId,
    exitCode: exit.code,
    signal: exit.signal,
    stdout: exit.stdout,
    stderr: exit.stderr,
    events
  };
}
function createRunningAgent(initialSessionId, start) {
  const normalizer = new StreamNormalizerState;
  const queue = new AsyncEventQueue;
  const events = [];
  let latestSessionId = initialSessionId;
  const process2 = start((line) => {
    for (const event of normalizer.processLine(line)) {
      const eventSessionId = sessionIdFromEvent(event);
      if (eventSessionId !== undefined) {
        latestSessionId = eventSessionId;
      }
      events.push(event);
      queue.push(event);
    }
  });
  const completion = process2.done.then((exit) => runResult(exit, latestSessionId, events)).finally(() => {
    queue.close();
  });
  return new RunningAgent(initialSessionId, queue, process2, completion);
}
function requirePrompt(request) {
  const prompt = request.prompt?.trim();
  if (prompt === undefined || prompt.length === 0) {
    throw new Error("prompt is required to start a Cursor agent run");
  }
  return prompt;
}
function createAgentRunnerFacade(options = {}) {
  const startHeadless = options.startHeadless ?? startHeadlessStreaming;
  const startResume = options.startResume ?? startResumeStreaming;
  return {
    start(request) {
      const workspace = request.cwd ?? process.cwd();
      const prompt = requirePrompt(request);
      return createRunningAgent(request.sessionId ?? "pending", (onLine) => startHeadless({
        workspace,
        prompt,
        ...request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {},
        ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {},
        ...request.model !== undefined ? { model: request.model } : {},
        ...request.effort !== undefined ? { effort: request.effort } : {},
        ...request.mode !== undefined ? { mode: request.mode } : {}
      }, onLine));
    },
    resume(request) {
      const workspace = request.cwd ?? process.cwd();
      return createRunningAgent(request.sessionId, (onLine) => startResume({
        workspace,
        sessionOrChatId: request.sessionId,
        ...request.prompt !== undefined ? { prompt: request.prompt } : {},
        ...request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {},
        ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {},
        ...request.model !== undefined ? { model: request.model } : {},
        ...request.effort !== undefined ? { effort: request.effort } : {},
        ...request.mode !== undefined ? { mode: request.mode } : {}
      }, onLine));
    }
  };
}

// src/sdk/facades.ts
import { join as join4 } from "path";

// src/activity/manager.ts
import { stat } from "fs/promises";

// src/persistence/activity-store.ts
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

// src/config/paths.ts
import { homedir } from "os";
import { join, resolve } from "path";
function expandHome(p) {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}
function envOverride(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) {
      return expandHome(value);
    }
  }
  return;
}
function getDataDir() {
  const override = envOverride("CURSOR_CLI_AGENT_DATA_DIR");
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".local/share/cursor-cli-agent");
}
function getConfigDir() {
  const override = envOverride("CURSOR_CLI_AGENT_CONFIG_DIR");
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".config/cursor-cli-agent");
}
function getCursorHome() {
  const override = envOverride("CURSOR_CLI_AGENT_CURSOR_HOME");
  if (override !== undefined) {
    return override;
  }
  return join(homedir(), ".cursor");
}
function stateDbPath() {
  return join(getDataDir(), "state.db");
}
function groupsJsonPath() {
  return join(getDataDir(), "groups.json");
}
function queuesJsonPath() {
  return join(getDataDir(), "queues.json");
}
function bookmarksJsonPath() {
  return join(getDataDir(), "bookmarks.json");
}
function activitySignalsJsonPath() {
  return join(getDataDir(), "activity-signals.json");
}
function usageEventsJsonPath() {
  return join(getDataDir(), "usage-events.json");
}
function sessionReplayForksJsonPath() {
  return join(getDataDir(), "session-replay-forks.json");
}
function daemonMetadataPath() {
  return join(getConfigDir(), "daemon.json");
}
function daemonLifecycleLogPath() {
  return join(getDataDir(), "daemon.log");
}
function cursorProjectsRoot() {
  return join(getCursorHome(), "projects");
}
function aiTrackingDbPath() {
  return join(getCursorHome(), "ai-tracking", "ai-code-tracking.db");
}
function workspaceSlugFromPath(workspacePath) {
  const abs = resolve(workspacePath);
  const trimmed = abs.replace(/^\/+/, "");
  if (trimmed.length === 0) {
    return "workspace";
  }
  return trimmed.replace(/\//g, "-");
}
function agentTranscriptsDirForWorkspace(workspacePath) {
  const slug = workspaceSlugFromPath(workspacePath);
  return join(cursorProjectsRoot(), slug, "agent-transcripts");
}

// src/persistence/activity-store.ts
function isActivitySignal(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value;
  const source = record["source"];
  const status = record["status"];
  return (source === "process" || source === "transcript" || source === "stream" || source === "stderr" || source === "stdout" || source === "index") && (status === "idle" || status === "running" || status === "waiting_trust" || status === "waiting_input" || status === "completed" || status === "failed") && typeof record["observedAt"] === "string" && (record["detail"] === undefined || typeof record["detail"] === "string") && attachmentsFieldOk(record["attachments"]);
}
function attachmentsFieldOk(value) {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const p = item;
    if (typeof p["id"] !== "string") {
      return false;
    }
  }
  return true;
}
async function load(path) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { sessions: {} };
    }
    const sessions = parsed["sessions"];
    if (typeof sessions !== "object" || sessions === null) {
      return { sessions: {} };
    }
    const entries = Object.entries(sessions).flatMap(([sessionId, signals]) => {
      if (!Array.isArray(signals)) {
        return [];
      }
      return [[sessionId, signals.filter(isActivitySignal)]];
    });
    return { sessions: Object.fromEntries(entries) };
  } catch {
    return { sessions: {} };
  }
}
async function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
  await rename(tmpPath, path);
}
function compareSignals(a, b) {
  const observed = a.observedAt.localeCompare(b.observedAt);
  if (observed !== 0) {
    return observed;
  }
  return a.status.localeCompare(b.status);
}
function createActivityStore(path = activitySignalsJsonPath()) {
  return {
    async getSignals(sessionId) {
      const data = await load(path);
      return [...data.sessions[sessionId] ?? []].sort(compareSignals);
    },
    async appendSignal(sessionId, signal) {
      const data = await load(path);
      const existing = data.sessions[sessionId] ?? [];
      await save(path, {
        sessions: {
          ...data.sessions,
          [sessionId]: [...existing, signal].sort(compareSignals)
        }
      });
    },
    async pruneSignals(before) {
      const data = await load(path);
      let pruned = 0;
      const sessions = {};
      for (const [sessionId, signals] of Object.entries(data.sessions)) {
        const kept = signals.filter((signal) => signal.observedAt >= before);
        pruned += signals.length - kept.length;
        if (kept.length > 0) {
          sessions[sessionId] = kept;
        }
      }
      await save(path, { sessions });
      return pruned;
    }
  };
}

// src/activity/manager.ts
var STATUS_TIE_BREAKER = {
  failed: 6,
  waiting_trust: 5,
  waiting_input: 4,
  running: 3,
  completed: 2,
  idle: 1
};
function indexStatusToActivity(status) {
  switch (status) {
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
    case "unknown":
      return "idle";
  }
}
function compareSignalsForProvenance(a, b) {
  const observed = b.observedAt.localeCompare(a.observedAt);
  if (observed !== 0) {
    return observed;
  }
  return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
}
function signalSelectionRank(signal) {
  if (signal.source === "process" || signal.source === "stream" || signal.source === "stderr" || signal.source === "stdout") {
    return 40;
  }
  if (signal.source === "index") {
    if (signal.status === "running" || signal.status === "failed" || signal.status === "completed") {
      return 30;
    }
    return 20;
  }
  if (signal.source === "transcript") {
    return 10;
  }
  return 0;
}
function compareSignalsForSelection(a, b) {
  if (a.status !== b.status) {
    if (a.status === "idle") {
      return 1;
    }
    if (b.status === "idle") {
      return -1;
    }
  }
  if (a.observedAt === b.observedAt) {
    const rank2 = signalSelectionRank(b) - signalSelectionRank(a);
    if (rank2 !== 0) {
      return rank2;
    }
    return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
  }
  const observed = b.observedAt.localeCompare(a.observedAt);
  if (observed !== 0) {
    return observed;
  }
  const rank = signalSelectionRank(b) - signalSelectionRank(a);
  if (rank !== 0) {
    return rank;
  }
  return STATUS_TIE_BREAKER[b.status] - STATUS_TIE_BREAKER[a.status];
}
function dedupeSignals(signals) {
  const seen = new Set;
  const deduped = [];
  for (const signal of [...signals].sort(compareSignalsForProvenance)) {
    const key = `${signal.source}\x00${signal.status}\x00${signal.observedAt}\x00${signal.detail ?? ""}\x00${signal.attachments?.map((a) => a.id).join(",") ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(signal);
  }
  return deduped;
}
function identityKeys(record) {
  return [
    record.recordId,
    ...record.localSessionId !== undefined ? [record.localSessionId] : [],
    ...record.cursorChatId !== undefined ? [record.cursorChatId] : []
  ];
}
async function transcriptSignal(record) {
  if (record.transcriptPath === undefined) {
    return null;
  }
  try {
    const info = await stat(record.transcriptPath);
    return {
      source: "transcript",
      status: "idle",
      observedAt: info.mtime.toISOString(),
      detail: record.transcriptPath
    };
  } catch {
    return null;
  }
}
async function collectSignals(store, record) {
  const storedNested = await Promise.all(identityKeys(record).map(async (key) => {
    try {
      return await store.getSignals(key);
    } catch {
      return [];
    }
  }));
  const fromTranscript = await transcriptSignal(record);
  return dedupeSignals([
    ...storedNested.flat(),
    {
      source: "index",
      status: indexStatusToActivity(record.status),
      observedAt: record.updatedAt,
      detail: `index status ${record.status}`
    },
    ...fromTranscript !== null ? [fromTranscript] : []
  ]);
}
function toActivityRecord(record, signals) {
  const selected = [...signals].sort(compareSignalsForSelection)[0] ?? {
    source: "index",
    status: "idle",
    observedAt: record.updatedAt,
    detail: "default idle fallback"
  };
  return {
    recordId: `activity:${record.recordId}`,
    ...record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {},
    ...record.cursorChatId !== undefined ? { cursorChatId: record.cursorChatId } : {},
    status: selected.status,
    updatedAt: selected.observedAt,
    signals: signals.length > 0 ? signals : [selected],
    provenance: "derived"
  };
}
function createActivityManager(options) {
  const store = options.store ?? createActivityStore();
  return {
    async getSessionActivity(sessionId) {
      const record = options.sessions.resolveSessionKey(sessionId);
      if (record === undefined) {
        return null;
      }
      return toActivityRecord(record, await collectSignals(store, record));
    },
    async listActivity(listOptions) {
      const scanLimit = Math.max(listOptions?.limit ?? 1000, 1000);
      const rows = options.sessions.listSessions(scanLimit);
      const activities = await Promise.all(rows.map(async (record) => toActivityRecord(record, await collectSignals(store, record))));
      const filtered = listOptions?.status === undefined ? activities : activities.filter((activity) => activity.status === listOptions.status);
      return listOptions?.limit === undefined ? filtered : filtered.slice(0, listOptions.limit);
    },
    async recordSignal(sessionId, signal) {
      try {
        await store.appendSignal(sessionId, signal);
      } catch {}
    }
  };
}

// src/bookmarks/manager.ts
import { randomUUID as randomUUID3 } from "crypto";

// src/cursor/transcript-reader.ts
import { readFile as readFile2 } from "fs/promises";
import { createReadStream } from "fs";
function isRecord2(v) {
  return typeof v === "object" && v !== null;
}
function parseRole(raw) {
  if (raw === "user" || raw === "assistant") {
    return raw;
  }
  return;
}
function parseSearchRole(raw) {
  if (raw === "user" || raw === "assistant" || raw === "system" || raw === "tool") {
    return raw;
  }
  return;
}
function joinSearchTextParts(parts) {
  let out = "";
  for (const part of parts) {
    if (!isRecord2(part)) {
      continue;
    }
    const type = part["type"];
    const text = part["text"];
    if (typeof text === "string" && (type === "text" || type === "input_text" || type === "output_text")) {
      out += text;
    }
  }
  return out;
}
function parseTranscriptLine(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  if (!isRecord2(parsed)) {
    return;
  }
  const role = parseRole(parsed["role"]);
  if (role === undefined) {
    return;
  }
  const message = parsed["message"];
  if (!isRecord2(message)) {
    return;
  }
  const content = message["content"];
  if (!Array.isArray(content)) {
    return;
  }
  const textParts = content;
  const rawText = joinTextParts(textParts);
  const norm = normalizeTextBlock(role, rawText);
  return { role, message: norm };
}
function parseTranscriptSearchJsonLine(json, eventOffset, byteOffset, byteLength) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  if (!isRecord2(parsed)) {
    return;
  }
  const message = parsed["message"];
  const messageRecord = isRecord2(message) ? message : undefined;
  const role = parseSearchRole(parsed["role"] ?? messageRecord?.["role"] ?? parsed["type"]);
  if (role === undefined || messageRecord === undefined) {
    return;
  }
  const content = messageRecord["content"];
  if (!Array.isArray(content)) {
    return;
  }
  const rawText = joinSearchTextParts(content);
  if (rawText.length === 0) {
    return;
  }
  const text = role === "user" || role === "assistant" ? normalizeTextBlock(role, rawText).displayText : rawText;
  return { role, rawText, text, eventOffset, byteOffset, byteLength };
}
async function readTranscriptFile(path) {
  const raw = await readFile2(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parsed = [];
  for (const line of lines) {
    const t = parseTranscriptLine(line);
    if (t !== undefined) {
      parsed.push(t);
    }
  }
  let firstUser;
  let lastAsst;
  for (const row of parsed) {
    if (row.role === "user" && firstUser === undefined) {
      firstUser = row.message;
    }
    if (row.role === "assistant") {
      lastAsst = row.message;
    }
  }
  return {
    lines: parsed,
    ...firstUser !== undefined ? { firstUserMessage: firstUser } : {},
    ...lastAsst !== undefined ? { lastAssistantMessage: lastAsst } : {}
  };
}
async function* streamTranscriptScanLines(transcriptPath) {
  const stream = createReadStream(transcriptPath, { encoding: "utf8" });
  let pending = "";
  let lineStartByte = 0;
  let eventOffset = 0;
  for await (const chunk of stream) {
    pending += chunk;
    let newlineIndex = pending.indexOf(`
`);
    while (newlineIndex >= 0) {
      const rawLine = pending.slice(0, newlineIndex);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const lineByteOffset = lineStartByte;
      const lineByteLength = Buffer.byteLength(rawLine, "utf8") + 1;
      lineStartByte += lineByteLength;
      pending = pending.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        const parsed = parseTranscriptSearchJsonLine(line, eventOffset, lineByteOffset, lineByteLength);
        yield parsed === undefined ? {
          searchable: false,
          eventOffset,
          byteOffset: lineByteOffset,
          byteLength: lineByteLength
        } : { ...parsed, searchable: true };
        eventOffset += 1;
      }
      newlineIndex = pending.indexOf(`
`);
    }
  }
  if (pending.trim().length > 0) {
    const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
    const lineByteLength = Buffer.byteLength(pending, "utf8");
    const parsed = parseTranscriptSearchJsonLine(line, eventOffset, lineStartByte, lineByteLength);
    yield parsed === undefined ? {
      searchable: false,
      eventOffset,
      byteOffset: lineStartByte,
      byteLength: lineByteLength
    } : { ...parsed, searchable: true };
  }
}
async function* streamTranscriptSearchLines(transcriptPath) {
  for await (const line of streamTranscriptScanLines(transcriptPath)) {
    if (line.searchable) {
      const { searchable: _searchable, ...searchLine } = line;
      yield searchLine;
    }
  }
}

// src/cursor/transcript-bookmark-lookup.ts
function messageIdFor(eventOffset, role) {
  return `event-${eventOffset}-${role}`;
}
function toBookmarkMessage(line) {
  return {
    messageId: messageIdFor(line.eventOffset, line.role),
    role: line.role,
    eventOffset: line.eventOffset,
    rawText: line.rawText,
    displayText: line.text
  };
}
function createTranscriptBookmarkLookup() {
  return {
    async findMessage(transcriptPath, messageId) {
      for await (const line of streamTranscriptSearchLines(transcriptPath)) {
        const message = toBookmarkMessage(line);
        if (message.messageId === messageId) {
          return message;
        }
      }
      return null;
    },
    async findRange(transcriptPath, fromMessageId, toMessageId) {
      const messages = [];
      let collecting = false;
      for await (const line of streamTranscriptSearchLines(transcriptPath)) {
        const message = toBookmarkMessage(line);
        if (message.messageId === fromMessageId) {
          collecting = true;
        }
        if (collecting) {
          messages.push(message);
        }
        if (collecting && message.messageId === toMessageId) {
          return messages;
        }
      }
      return [];
    }
  };
}

// src/persistence/bookmarks-store.ts
import { mkdirSync as mkdirSync2 } from "fs";
import { readFile as readFile3, rename as rename2, writeFile as writeFile2 } from "fs/promises";
import { randomUUID as randomUUID2 } from "crypto";
import { dirname as dirname2 } from "path";

// src/types/bookmark.ts
function isBookmarkType(value) {
  return value === "session" || value === "message" || value === "range";
}
function normalizeBookmarkTags(tags) {
  if (tags === undefined) {
    return [];
  }
  const normalized = new Set;
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (tag.length > 0) {
      normalized.add(tag);
    }
  }
  return [...normalized].sort((a, b) => a.localeCompare(b));
}
function validateCreateBookmarkInput(input) {
  const errors = [];
  if (input.sessionId.trim().length === 0) {
    errors.push("sessionId is required");
  }
  if (input.name.trim().length === 0) {
    errors.push("name is required");
  }
  switch (input.type) {
    case "session":
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for session bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for session bookmarks");
      }
      break;
    case "message":
      if (input.messageId === undefined || input.messageId.trim().length === 0) {
        errors.push("messageId is required for message bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for message bookmarks");
      }
      break;
    case "range":
      if (input.fromMessageId === undefined || input.fromMessageId.trim().length === 0) {
        errors.push("fromMessageId is required for range bookmarks");
      }
      if (input.toMessageId === undefined || input.toMessageId.trim().length === 0) {
        errors.push("toMessageId is required for range bookmarks");
      }
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for range bookmarks");
      }
      break;
  }
  return errors;
}

// src/persistence/bookmarks-store.ts
function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function isBookmarkRecord(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value;
  const type = record["type"];
  const tags = record["tags"];
  return typeof record["id"] === "string" && typeof type === "string" && isBookmarkType(type) && typeof record["sessionId"] === "string" && typeof record["name"] === "string" && Array.isArray(tags) && tags.every((tag) => typeof tag === "string") && typeof record["createdAt"] === "string" && typeof record["updatedAt"] === "string";
}
async function load2(path) {
  try {
    const raw = await readFile3(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { bookmarks: [] };
    }
    const bookmarks = parsed["bookmarks"];
    if (!Array.isArray(bookmarks)) {
      return { bookmarks: [] };
    }
    return { bookmarks: bookmarks.filter(isBookmarkRecord) };
  } catch {
    return { bookmarks: [] };
  }
}
async function saveFile(path, data) {
  mkdirSync2(dirname2(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID2().slice(0, 8)}`;
  await writeFile2(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
  await rename2(tmpPath, path);
}
function matchesFilter(bookmark, filter) {
  if (filter === undefined) {
    return true;
  }
  if (filter.sessionId !== undefined && bookmark.sessionId !== filter.sessionId) {
    return false;
  }
  if (filter.type !== undefined && bookmark.type !== filter.type) {
    return false;
  }
  if (filter.tag !== undefined && !bookmark.tags.includes(filter.tag)) {
    return false;
  }
  return true;
}
function compareBookmarks(a, b) {
  const updated = b.updatedAt.localeCompare(a.updatedAt);
  if (updated !== 0) {
    return updated;
  }
  return a.id.localeCompare(b.id);
}
function scoreBookmark(bookmark, normalizedQuery) {
  let score = 0;
  const fields = [
    [bookmark.name, 5],
    [bookmark.description, 3],
    [bookmark.sessionId, 2],
    [bookmark.messageId, 2],
    [bookmark.fromMessageId, 2],
    [bookmark.toMessageId, 2],
    [bookmark.excerpt?.displayText, 2],
    [bookmark.excerpt?.rawText, 1]
  ];
  for (const [value, weight] of fields) {
    if (value?.toLowerCase().includes(normalizedQuery) === true) {
      score += weight;
    }
  }
  for (const tag of bookmark.tags) {
    if (tag.toLowerCase().includes(normalizedQuery)) {
      score += 1;
    }
  }
  return score;
}
function sortedHits(hits) {
  return [...hits].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return compareBookmarks(a.bookmark, b.bookmark);
  });
}
function trimBookmark(record) {
  const messageId = optionalString(record.messageId);
  const fromMessageId = optionalString(record.fromMessageId);
  const toMessageId = optionalString(record.toMessageId);
  const description = optionalString(record.description);
  return {
    id: record.id,
    type: record.type,
    sessionId: record.sessionId,
    ...messageId !== undefined ? { messageId } : {},
    ...fromMessageId !== undefined ? { fromMessageId } : {},
    ...toMessageId !== undefined ? { toMessageId } : {},
    name: record.name,
    ...description !== undefined ? { description } : {},
    tags: [...record.tags],
    ...record.excerpt !== undefined ? { excerpt: record.excerpt } : {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
function createBookmarksStore(path = bookmarksJsonPath()) {
  return {
    async list(filter) {
      const data = await load2(path);
      return data.bookmarks.filter((bookmark) => matchesFilter(bookmark, filter)).sort(compareBookmarks);
    },
    async get(id) {
      const data = await load2(path);
      return data.bookmarks.find((bookmark) => bookmark.id === id) ?? null;
    },
    async save(record) {
      const data = await load2(path);
      const next = data.bookmarks.filter((bookmark) => bookmark.id !== record.id);
      await saveFile(path, { bookmarks: [...next, trimBookmark(record)] });
    },
    async delete(id) {
      const data = await load2(path);
      const next = data.bookmarks.filter((bookmark) => bookmark.id !== id);
      if (next.length === data.bookmarks.length) {
        return false;
      }
      await saveFile(path, { bookmarks: next });
      return true;
    },
    async search(query, options) {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery.length === 0) {
        return { query, hits: [], total: 0 };
      }
      const data = await load2(path);
      const hits = sortedHits(data.bookmarks.flatMap((bookmark) => {
        const score = scoreBookmark(bookmark, normalizedQuery);
        return score > 0 ? [{ bookmark, score }] : [];
      }));
      const limited = options?.limit === undefined ? hits : hits.slice(0, options.limit);
      return {
        query,
        hits: limited,
        total: hits.length,
        ...options?.limit !== undefined ? { limit: options.limit } : {}
      };
    }
  };
}

// src/bookmarks/manager.ts
class BookmarkInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "BookmarkInputError";
  }
}

class BookmarkNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "BookmarkNotFoundError";
  }
}
function optionalTrimmed(value) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
function combinedRangeExcerpt(messages) {
  return {
    rawText: messages.map((message) => message.rawText).join(`
`),
    displayText: messages.map((message) => message.displayText).join(`
`)
  };
}
function bookmarkSessionIdFor(session) {
  return session.localSessionId ?? session.cursorChatId ?? session.recordId;
}
function createBookmarkManager(dependencies) {
  const store = dependencies.store ?? createBookmarksStore();
  const transcriptLookup = dependencies.transcriptLookup ?? createTranscriptBookmarkLookup();
  const now = dependencies.now ?? (() => new Date);
  const createId = dependencies.createId ?? randomUUID3;
  return {
    async add(input) {
      const validationErrors = validateCreateBookmarkInput(input);
      if (validationErrors.length > 0) {
        throw new BookmarkInputError(validationErrors.join("; "));
      }
      const session = dependencies.sessions.resolveSessionKey(input.sessionId);
      if (session === undefined) {
        throw new BookmarkNotFoundError("session not found");
      }
      let excerpt;
      if (input.type !== "session") {
        if (session.identityState === "chat_only" || session.transcriptPath === undefined) {
          throw new BookmarkInputError("message and range bookmarks require a transcript-backed session");
        }
        if (input.type === "message") {
          const messageId2 = input.messageId;
          if (messageId2 === undefined) {
            throw new BookmarkInputError("messageId is required for message bookmarks");
          }
          const message = await transcriptLookup.findMessage(session.transcriptPath, messageId2);
          if (message === null) {
            throw new BookmarkNotFoundError("message not found");
          }
          excerpt = {
            rawText: message.rawText,
            displayText: message.displayText
          };
        } else {
          const fromMessageId2 = input.fromMessageId;
          const toMessageId2 = input.toMessageId;
          if (fromMessageId2 === undefined || toMessageId2 === undefined) {
            throw new BookmarkInputError("fromMessageId and toMessageId are required for range bookmarks");
          }
          const messages = await transcriptLookup.findRange(session.transcriptPath, fromMessageId2, toMessageId2);
          if (messages.length === 0) {
            throw new BookmarkNotFoundError("range not found");
          }
          excerpt = combinedRangeExcerpt(messages);
        }
      }
      const timestamp = now().toISOString();
      const messageId = optionalTrimmed(input.messageId);
      const fromMessageId = optionalTrimmed(input.fromMessageId);
      const toMessageId = optionalTrimmed(input.toMessageId);
      const description = optionalTrimmed(input.description);
      const record = {
        id: createId(),
        type: input.type,
        sessionId: bookmarkSessionIdFor(session),
        ...messageId !== undefined ? { messageId } : {},
        ...fromMessageId !== undefined ? { fromMessageId } : {},
        ...toMessageId !== undefined ? { toMessageId } : {},
        name: input.name.trim(),
        ...description !== undefined ? { description } : {},
        tags: normalizeBookmarkTags(input.tags),
        ...excerpt !== undefined ? { excerpt } : {},
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await store.save(record);
      return record;
    },
    list(filter) {
      if (filter?.sessionId === undefined) {
        return store.list(filter);
      }
      const session = dependencies.sessions.resolveSessionKey(filter.sessionId);
      const sessionId = session === undefined ? filter.sessionId : bookmarkSessionIdFor(session);
      return store.list({ ...filter, sessionId });
    },
    show(id) {
      return store.get(id);
    },
    delete(id) {
      return store.delete(id);
    },
    search(query, options) {
      return store.search(query, options);
    }
  };
}

// src/cursor/transcript-search.ts
var DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS = 30000;
function normalizeQuery(query) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("query must not be empty");
  }
  return normalized;
}
function validatePositiveInteger(value, label) {
  if (value !== undefined && (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive integer`);
  }
}
function validateOptions(options) {
  validatePositiveInteger(options.limit, "limit");
  validatePositiveInteger(options.maxSessions, "maxSessions");
  validatePositiveInteger(options.maxBytes, "maxBytes");
  validatePositiveInteger(options.maxEvents, "maxEvents");
  validatePositiveInteger(options.timeoutMs, "timeoutMs");
  if (!Number.isInteger(options.offset) || !Number.isFinite(options.offset) || options.offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
}
function excerptFor(text, normalizedQuery) {
  const normalizedText = text.toLowerCase();
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) {
    return text.slice(0, 160);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + normalizedQuery.length + 60);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
function messageIdFor2(eventOffset, role) {
  return `event-${eventOffset}-${role}`;
}
function toHit(record, role, text, normalizedQuery, eventOffset, byteOffset) {
  return {
    recordId: record.recordId,
    ...record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {},
    ...record.cursorChatId !== undefined ? { cursorChatId: record.cursorChatId } : {},
    transcriptPath: record.transcriptPath,
    messageId: messageIdFor2(eventOffset, role),
    role,
    excerpt: excerptFor(text, normalizedQuery),
    eventOffset,
    ...byteOffset !== undefined ? { byteOffset } : {},
    provenance: "transcript"
  };
}
function withTranscriptPath(record) {
  if (record?.transcriptPath === undefined) {
    return;
  }
  return { ...record, transcriptPath: record.transcriptPath };
}
function createTranscriptSearchService(repository) {
  return {
    async search(options) {
      validateOptions(options);
      const normalizedQuery = normalizeQuery(options.query);
      const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS;
      const budget = {
        ...options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {},
        ...options.maxEvents !== undefined ? { maxEvents: options.maxEvents } : {},
        deadlineAt: Date.now() + timeoutMs
      };
      const candidates = options.sessionId === undefined ? repository.listTranscriptBackedSessions().flatMap((candidate) => {
        const transcriptCandidate = withTranscriptPath(candidate);
        return transcriptCandidate === undefined ? [] : [transcriptCandidate];
      }) : [
        withTranscriptPath(repository.resolveSessionKey(options.sessionId))
      ].flatMap((candidate) => candidate === undefined ? [] : [candidate]);
      const allHits = [];
      let scannedSessions = 0;
      let scannedBytes = 0;
      let scannedEvents = 0;
      let truncated = false;
      let timedOut = false;
      for (const candidate of candidates) {
        if (options.maxSessions !== undefined && scannedSessions >= options.maxSessions) {
          truncated = true;
          break;
        }
        if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
          truncated = true;
          break;
        }
        if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
          truncated = true;
          break;
        }
        if (Date.now() >= budget.deadlineAt) {
          timedOut = true;
          break;
        }
        scannedSessions += 1;
        for await (const line of streamTranscriptScanLines(candidate.transcriptPath)) {
          if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
            truncated = true;
            break;
          }
          if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
            truncated = true;
            break;
          }
          if (Date.now() >= budget.deadlineAt) {
            timedOut = true;
            break;
          }
          if (budget.maxBytes !== undefined && scannedBytes + line.byteLength > budget.maxBytes) {
            truncated = true;
            break;
          }
          scannedEvents += 1;
          scannedBytes += line.byteLength;
          if (!line.searchable) {
            continue;
          }
          if (options.role !== undefined && line.role !== options.role) {
            continue;
          }
          if (!line.text.toLowerCase().includes(normalizedQuery)) {
            continue;
          }
          allHits.push(toHit(candidate, line.role, line.text, normalizedQuery, line.eventOffset, line.byteOffset));
        }
        if (truncated || timedOut) {
          break;
        }
      }
      return {
        query: options.query,
        hits: allHits.slice(options.offset, options.offset + options.limit),
        total: allHits.length,
        offset: options.offset,
        limit: options.limit,
        scannedSessions,
        scannedBytes,
        scannedEvents,
        truncated,
        timedOut
      };
    }
  };
}

// src/cursor/ai-tracking-reader.ts
import { existsSync } from "fs";
import { Database } from "bun:sqlite";
var MAX_TRACKED_PATHS = 64;
var MAX_CODE_TOUCH_ROWS = 200;
var MAX_DELETED_ROWS = 200;
var MAX_SCORED_COMMITS = 200;
function openReadonlyDb(path) {
  if (!existsSync(path)) {
    return;
  }
  try {
    return new Database(path, { readonly: true });
  } catch {
    return;
  }
}
function degraded() {
  return { rows: [], provenance: "missing_ai_tracking" };
}
function rowsResult(rows) {
  return {
    rows,
    provenance: rows.length > 0 ? "ai_tracking" : "missing_rows"
  };
}
function rowSummary(row) {
  const title = optionalString2(row["title"]);
  const tldr = optionalString2(row["tldr"]);
  const overview = optionalString2(row["overview"]);
  const summaryBullets = optionalString2(row["summaryBullets"]);
  const model = optionalString2(row["model"]);
  const mode = optionalString2(row["mode"]);
  const updatedAt = typeof row["updatedAt"] === "number" ? row["updatedAt"] : undefined;
  return {
    ...title !== undefined ? { title } : {},
    ...tldr !== undefined ? { tldr } : {},
    ...overview !== undefined ? { overview } : {},
    ...summaryBullets !== undefined ? { summaryBullets } : {},
    ...model !== undefined ? { model } : {},
    ...mode !== undefined ? { mode } : {},
    ...updatedAt !== undefined ? { updatedAt } : {}
  };
}
function optionalString2(v) {
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return;
}
function loadAiTrackingEnrichment(conversationId, dbPath = aiTrackingDbPath()) {
  if (conversationId.length === 0) {
    return;
  }
  const db = openReadonlyDb(dbPath);
  if (db === undefined) {
    return;
  }
  try {
    return loadFromDb(db, conversationId);
  } catch {
    return;
  } finally {
    db.close();
  }
}
function loadFromDb(db, conversationId) {
  const summaryRow = db.query("SELECT * FROM conversation_summaries WHERE conversationId = ? LIMIT 1").get(conversationId);
  const summary = summaryRow !== null ? rowSummary(summaryRow) : undefined;
  const codeRows = db.query(`SELECT fileName, fileExtension, model, timestamp
       FROM ai_code_hashes
       WHERE conversationId = ?
       ORDER BY COALESCE(timestamp, createdAt) DESC
       LIMIT ?`).all(conversationId, MAX_CODE_TOUCH_ROWS);
  const codeTouches = codeRows.map((r) => {
    const fileName = optionalString2(r["fileName"]);
    const fileExtension = optionalString2(r["fileExtension"]);
    const model = optionalString2(r["model"]);
    const timestamp = typeof r["timestamp"] === "number" ? r["timestamp"] : undefined;
    return {
      ...fileName !== undefined ? { fileName } : {},
      ...fileExtension !== undefined ? { fileExtension } : {},
      ...model !== undefined ? { model } : {},
      ...timestamp !== undefined ? { timestamp } : {}
    };
  });
  const deletedRows = db.query(`SELECT gitPath, deletedAt, model
       FROM ai_deleted_files
       WHERE conversationId = ?
       ORDER BY deletedAt DESC
       LIMIT ?`).all(conversationId, MAX_DELETED_ROWS);
  const deletedFiles = deletedRows.map((r) => {
    const gitPath = String(r["gitPath"] ?? "");
    const deletedAt = typeof r["deletedAt"] === "number" ? r["deletedAt"] : 0;
    const model = optionalString2(r["model"]);
    return {
      gitPath,
      deletedAt,
      ...model !== undefined ? { model } : {}
    };
  });
  const trackedRows = db.query(`SELECT gitPath, length(content) AS contentBytes, fileExtension, model, createdAt
       FROM tracked_file_content
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`).all(conversationId, MAX_TRACKED_PATHS);
  const trackedFiles = trackedRows.map((r) => {
    const gitPath = optionalString2(r["gitPath"]) ?? "";
    const fileExtension = optionalString2(r["fileExtension"]);
    const model = optionalString2(r["model"]);
    const createdAt = typeof r["createdAt"] === "number" ? r["createdAt"] : 0;
    const contentBytes = typeof r["contentBytes"] === "number" ? r["contentBytes"] : 0;
    return {
      gitPath,
      contentBytes,
      createdAt,
      ...fileExtension !== undefined ? { fileExtension } : {},
      ...model !== undefined ? { model } : {}
    };
  });
  const summaryForPayload = summary !== undefined && Object.keys(summary).length > 0 ? summary : undefined;
  const hasPayload = summaryForPayload !== undefined || codeTouches.length > 0 || deletedFiles.length > 0 || trackedFiles.length > 0;
  if (!hasPayload) {
    return;
  }
  return {
    conversationId,
    ...summaryForPayload !== undefined ? { summary: summaryForPayload } : {},
    codeTouches,
    deletedFiles,
    trackedFiles
  };
}
function createAiTrackingFileReader(dbPath = aiTrackingDbPath()) {
  return {
    listCodeTouches(conversationId) {
      return withDb(dbPath, (db) => rowsResult(readCodeTouches(db, conversationId)));
    },
    listTrackedSnapshots(conversationId, options = {}) {
      return withDb(dbPath, (db) => rowsResult(readTrackedSnapshots(db, conversationId, options)));
    },
    listDeletedFiles(conversationId) {
      return withDb(dbPath, (db) => rowsResult(readDeletedFiles(db, conversationId)));
    },
    listConversationFileRefs(conversationIds) {
      return withDb(dbPath, (db) => rowsResult(readConversationFileRefs(db, conversationIds)));
    }
  };
}
function createAiTrackingAnalyticsReader(dbPath = aiTrackingDbPath()) {
  return {
    listScoredCommits(options = {}) {
      const db = openReadonlyDb(dbPath);
      if (db === undefined) {
        return scoredCommitDegraded("missing_ai_tracking", [
          "ai-tracking database is missing or unreadable"
        ]);
      }
      try {
        return readScoredCommits(db, options);
      } catch {
        return scoredCommitDegraded("missing_scored_commits", [
          "scored_commits table or required columns are unavailable"
        ]);
      } finally {
        db.close();
      }
    }
  };
}
function withDb(dbPath, fn) {
  const db = openReadonlyDb(dbPath);
  if (db === undefined) {
    return degraded();
  }
  try {
    return fn(db);
  } catch {
    return degraded();
  } finally {
    db.close();
  }
}
function readCodeTouches(db, conversationId) {
  const rows = db.query(`SELECT fileName, fileExtension, model, timestamp
       FROM ai_code_hashes
       WHERE conversationId = ?
       ORDER BY COALESCE(timestamp, createdAt) DESC
       LIMIT ?`).all(conversationId, MAX_CODE_TOUCH_ROWS);
  return rows.map((r) => {
    const fileName = optionalString2(r["fileName"]);
    const fileExtension = optionalString2(r["fileExtension"]);
    const model = optionalString2(r["model"]);
    const timestamp = typeof r["timestamp"] === "number" ? r["timestamp"] : undefined;
    return {
      ...fileName !== undefined ? { fileName } : {},
      ...fileExtension !== undefined ? { fileExtension } : {},
      ...model !== undefined ? { model } : {},
      ...timestamp !== undefined ? { timestamp } : {}
    };
  });
}
function readDeletedFiles(db, conversationId) {
  const rows = db.query(`SELECT gitPath, deletedAt, model
       FROM ai_deleted_files
       WHERE conversationId = ?
       ORDER BY deletedAt DESC
       LIMIT ?`).all(conversationId, MAX_DELETED_ROWS);
  return rows.map((r) => {
    const gitPath = String(r["gitPath"] ?? "");
    const deletedAt = typeof r["deletedAt"] === "number" ? r["deletedAt"] : 0;
    const model = optionalString2(r["model"]);
    return {
      gitPath,
      deletedAt,
      ...model !== undefined ? { model } : {}
    };
  });
}
function readTrackedSnapshots(db, conversationId, options) {
  const contentExpr = options.includeContent === true ? ", content" : "";
  const rows = db.query(`SELECT gitPath, length(content) AS contentBytes, fileExtension, model, createdAt${contentExpr}
       FROM tracked_file_content
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`).all(conversationId, MAX_TRACKED_PATHS);
  return rows.map((r) => {
    const gitPath = optionalString2(r["gitPath"]) ?? "";
    const fileExtension = optionalString2(r["fileExtension"]);
    const model = optionalString2(r["model"]);
    const content = optionalString2(r["content"]);
    const createdAt = typeof r["createdAt"] === "number" ? r["createdAt"] : 0;
    const contentBytes = typeof r["contentBytes"] === "number" ? r["contentBytes"] : 0;
    return {
      gitPath,
      contentBytes,
      createdAt,
      ...content !== undefined ? { content } : {},
      ...fileExtension !== undefined ? { fileExtension } : {},
      ...model !== undefined ? { model } : {}
    };
  });
}
function readConversationFileRefs(db, conversationIds) {
  const refs = [];
  for (const conversationId of conversationIds) {
    for (const row of readCodeTouches(db, conversationId)) {
      if (row.fileName !== undefined) {
        refs.push({
          conversationId,
          path: row.fileName,
          operation: "touched",
          ...row.timestamp !== undefined ? { observedAt: row.timestamp } : {},
          ...row.model !== undefined ? { model: row.model } : {}
        });
      }
    }
    for (const row of readDeletedFiles(db, conversationId)) {
      refs.push({
        conversationId,
        path: row.gitPath,
        operation: "deleted",
        observedAt: row.deletedAt,
        ...row.model !== undefined ? { model: row.model } : {}
      });
    }
    for (const row of readTrackedSnapshots(db, conversationId, {})) {
      refs.push({
        conversationId,
        path: row.gitPath,
        operation: "snapshot",
        observedAt: row.createdAt,
        ...row.model !== undefined ? { model: row.model } : {}
      });
    }
  }
  return refs;
}
function readScoredCommits(db, options) {
  const columns = tableColumns(db, "scored_commits");
  if (columns.size === 0) {
    return scoredCommitDegraded("missing_scored_commits", [
      "scored_commits table is missing"
    ]);
  }
  const commitHashColumn = firstColumn(columns, [
    "commitHash",
    "commit_hash",
    "hash",
    "sha"
  ]);
  if (commitHashColumn === undefined) {
    return scoredCommitDegraded("missing_scored_commits", [
      "scored_commits commit hash column is missing"
    ]);
  }
  const branchColumn = firstColumn(columns, ["branchName", "branch_name"]);
  const messageColumn = firstColumn(columns, [
    "commitMessage",
    "commit_message",
    "message"
  ]);
  const dateColumn = firstColumn(columns, [
    "commitDate",
    "commit_date",
    "createdAt",
    "created_at",
    "timestamp"
  ]);
  const addedColumn = firstColumn(columns, [
    "composerLinesAdded",
    "composer_lines_added",
    "linesAdded",
    "lines_added"
  ]);
  const deletedColumn = firstColumn(columns, [
    "composerLinesDeleted",
    "composer_lines_deleted",
    "linesDeleted",
    "lines_deleted"
  ]);
  const v1Column = firstColumn(columns, [
    "v1AiPercentage",
    "v1_ai_percentage",
    "aiPercentage",
    "ai_percentage"
  ]);
  const v2Column = firstColumn(columns, ["v2AiPercentage", "v2_ai_percentage"]);
  const selected = [
    sqlColumn(commitHashColumn, "commitHash"),
    sqlColumn(branchColumn, "branchName"),
    sqlColumn(messageColumn, "commitMessage"),
    sqlColumn(dateColumn, "commitDate"),
    sqlColumn(addedColumn, "composerLinesAdded"),
    sqlColumn(deletedColumn, "composerLinesDeleted"),
    sqlColumn(v1Column, "v1AiPercentage"),
    sqlColumn(v2Column, "v2AiPercentage")
  ].filter((part) => part.length > 0);
  const limit = sanitizeLimit(options.limit, MAX_SCORED_COMMITS);
  const orderColumn = dateColumn ?? commitHashColumn;
  const rows = db.query(`SELECT ${selected.join(", ")}
       FROM scored_commits
       ORDER BY ${quoteIdent(orderColumn)} DESC, ${quoteIdent(commitHashColumn)} ASC
       LIMIT ?`).all(limit);
  if (rows.length === 0) {
    return scoredCommitDegraded("missing_rows", [
      "scored_commits table contains no rows"
    ]);
  }
  const completenessNotes = [];
  if (v1Column === undefined && v2Column === undefined) {
    completenessNotes.push("AI percentage columns are missing");
  }
  if (addedColumn === undefined && deletedColumn === undefined) {
    completenessNotes.push("composer line count columns are missing");
  }
  return {
    rows: rows.map((row) => rowToScoredCommit(row, completenessNotes)),
    provenance: "ai_tracking",
    completenessNotes
  };
}
function scoredCommitDegraded(provenance, completenessNotes) {
  return { rows: [], provenance, completenessNotes };
}
function tableColumns(db, table) {
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all();
  return new Set(rows.flatMap((row) => typeof row["name"] === "string" ? [row["name"]] : []));
}
function firstColumn(columns, candidates) {
  return candidates.find((candidate) => columns.has(candidate));
}
function sqlColumn(column, alias) {
  return column === undefined ? "" : `${quoteIdent(column)} AS ${quoteIdent(alias)}`;
}
function quoteIdent(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function sanitizeLimit(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, 1e4);
}
function rowToScoredCommit(row, inheritedNotes) {
  const branchName = optionalString2(row["branchName"]);
  const commitMessage = optionalString2(row["commitMessage"]);
  const commitDate = isoStringValue(row["commitDate"]);
  const composerLinesAdded = optionalNumber(row["composerLinesAdded"]);
  const composerLinesDeleted = optionalNumber(row["composerLinesDeleted"]);
  const v1AiPercentage = optionalNumber(row["v1AiPercentage"]);
  const v2AiPercentage = optionalNumber(row["v2AiPercentage"]);
  return {
    commitHash: String(row["commitHash"] ?? ""),
    ...branchName !== undefined ? { branchName } : {},
    ...commitMessage !== undefined ? { commitMessage } : {},
    ...commitDate !== undefined ? { commitDate } : {},
    ...composerLinesAdded !== undefined ? { composerLinesAdded } : {},
    ...composerLinesDeleted !== undefined ? { composerLinesDeleted } : {},
    ...v1AiPercentage !== undefined ? { v1AiPercentage } : {},
    ...v2AiPercentage !== undefined ? { v2AiPercentage } : {},
    provenance: "ai_tracking",
    completenessNotes: inheritedNotes
  };
}
function optionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return;
}
function isoStringValue(value) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return;
}

// src/file-intelligence/manager.ts
import { isAbsolute, relative } from "path";

// src/persistence/file-intelligence-index.ts
import { mkdirSync as mkdirSync3 } from "fs";
import { dirname as dirname3 } from "path";
import { Database as Database2 } from "bun:sqlite";
var MIGRATION = `
CREATE TABLE IF NOT EXISTS file_index_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  indexed_sessions INTEGER NOT NULL,
  touched_files INTEGER NOT NULL,
  deleted_files INTEGER NOT NULL,
  snapshots INTEGER NOT NULL,
  skipped_sessions INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  provenance TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_index_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  conversation_id TEXT,
  raw_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  path_kind TEXT NOT NULL,
  operation TEXT NOT NULL,
  observed_at TEXT,
  model TEXT,
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_index_entries_normalized_path
  ON file_index_entries(normalized_path);
CREATE INDEX IF NOT EXISTS idx_file_index_entries_raw_path
  ON file_index_entries(raw_path);
`;

class FileIntelligenceIndex {
  db;
  constructor(dbPath) {
    mkdirSync3(dirname3(dbPath), { recursive: true });
    this.db = new Database2(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(MIGRATION);
  }
  close() {
    this.db.close();
  }
  rebuild(input) {
    const updatedAt = new Date().toISOString();
    const touchedFiles = input.entries.filter((entry) => entry.operation === "touched").length;
    const deletedFiles = input.entries.filter((entry) => entry.operation === "deleted").length;
    const snapshots = input.entries.filter((entry) => entry.operation === "snapshot").length;
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM file_index_entries");
      this.db.run("DELETE FROM file_index_meta");
      const insert = this.db.prepare(`
INSERT INTO file_index_entries (
  session_id, record_id, conversation_id, raw_path, normalized_path, path_kind,
  operation, observed_at, model, provenance
) VALUES (
  @session_id, @record_id, @conversation_id, @raw_path, @normalized_path,
  @path_kind, @operation, @observed_at, @model, @provenance
)`);
      for (const entry of input.entries) {
        insert.run({
          "@session_id": entry.sessionId,
          "@record_id": entry.recordId,
          "@conversation_id": entry.conversationId ?? null,
          "@raw_path": entry.rawPath,
          "@normalized_path": entry.normalizedPath,
          "@path_kind": entry.pathKind,
          "@operation": entry.operation,
          "@observed_at": entry.observedAt ?? null,
          "@model": entry.model ?? null,
          "@provenance": entry.provenance
        });
      }
      this.db.prepare(`INSERT INTO file_index_meta (
             singleton_id, indexed_sessions, touched_files, deleted_files,
             snapshots, skipped_sessions, updated_at, provenance
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`).run(input.indexedSessions, touchedFiles, deletedFiles, snapshots, input.skippedSessions, updatedAt, input.provenance);
    });
    tx();
    return {
      indexedSessions: input.indexedSessions,
      touchedFiles,
      deletedFiles,
      snapshots,
      skippedSessions: input.skippedSessions,
      updatedAt,
      provenance: input.provenance
    };
  }
  findByPath(path) {
    const normalizedQuery = normalizeIndexPath(path);
    const rows = this.db.query(`SELECT * FROM file_index_entries
         WHERE normalized_path = ? OR raw_path = ?
         ORDER BY COALESCE(observed_at, ''), session_id, operation`).all(normalizedQuery, path);
    const stats = this.getStats();
    const entries = rows.map(rowToHistoryEntry);
    return {
      queryPath: path,
      entries,
      totalEntries: entries.length,
      index: stats,
      needsRebuild: stats.updatedAt === undefined,
      provenance: entries.length > 0 ? "index" : stats.provenance
    };
  }
  listEntries(limit = 1e4) {
    const rows = this.db.query(`SELECT * FROM file_index_entries
         ORDER BY normalized_path ASC, COALESCE(observed_at, '') ASC,
                  session_id ASC, operation ASC
         LIMIT ?`).all(limit);
    return rows.map(rowToHistoryEntry);
  }
  getStats() {
    const row = this.db.query("SELECT * FROM file_index_meta WHERE singleton_id = 1").get();
    if (row === null) {
      return {
        indexedSessions: 0,
        touchedFiles: 0,
        deletedFiles: 0,
        snapshots: 0,
        provenance: "missing_rows"
      };
    }
    const updatedAt = stringValue(row["updated_at"]);
    return {
      indexedSessions: numberValue(row["indexed_sessions"]),
      touchedFiles: numberValue(row["touched_files"]),
      deletedFiles: numberValue(row["deleted_files"]),
      snapshots: numberValue(row["snapshots"]),
      ...updatedAt !== undefined ? { updatedAt } : {},
      provenance: provenanceValue(row["provenance"])
    };
  }
}
function normalizeIndexPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
function rowToHistoryEntry(row) {
  const conversationId = stringValue(row["conversation_id"]);
  const observedAt = stringValue(row["observed_at"]);
  const model = stringValue(row["model"]);
  return {
    sessionId: String(row["session_id"]),
    recordId: String(row["record_id"]),
    ...conversationId !== undefined ? { conversationId } : {},
    path: {
      path: String(row["normalized_path"]),
      pathKind: pathKindValue(row["path_kind"])
    },
    operation: operationValue(row["operation"]),
    ...observedAt !== undefined ? { observedAt } : {},
    ...model !== undefined ? { model } : {},
    provenance: provenanceValue(row["provenance"])
  };
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value) {
  return typeof value === "number" ? value : 0;
}
function pathKindValue(value) {
  if (value === "workspace_relative" || value === "absolute" || value === "raw") {
    return value;
  }
  return "raw";
}
function operationValue(value) {
  if (value === "touched" || value === "deleted" || value === "snapshot" || value === "unknown") {
    return value;
  }
  return "unknown";
}
function provenanceValue(value) {
  if (value === "ai_tracking" || value === "index" || value === "missing_ai_tracking" || value === "missing_rows" || value === "unknown") {
    return value;
  }
  return "unknown";
}

// src/file-intelligence/manager.ts
class FileIntelligenceNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "FileIntelligenceNotFoundError";
  }
}
function createFileIntelligenceService(deps) {
  return new FileIntelligenceManager(deps.sessions, deps.aiTracking, deps.index);
}

class FileIntelligenceManager {
  sessions;
  aiTracking;
  index;
  constructor(sessions, aiTracking, index) {
    this.sessions = sessions;
    this.aiTracking = aiTracking;
    this.index = index;
  }
  async listFiles(sessionId) {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const result = conversationId === undefined ? { rows: [], provenance: "unknown" } : this.aiTracking.listCodeTouches(conversationId);
    const grouped = groupTouches(session, result.rows, result.provenance);
    return {
      sessionId: session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...conversationId !== undefined ? { conversationId } : {},
      files: grouped,
      totalFiles: grouped.length,
      provenance: commandProvenance(result.provenance, grouped.length)
    };
  }
  async listSnapshots(sessionId, options = {}) {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const includeContent = options.includeContent === true;
    const result = conversationId === undefined ? { rows: [], provenance: "unknown" } : this.aiTracking.listTrackedSnapshots(conversationId, {
      includeContent
    });
    const snapshots = result.rows.map((row) => snapshotToResult(session, row, result.provenance, includeContent));
    return {
      sessionId: session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...conversationId !== undefined ? { conversationId } : {},
      snapshots,
      totalSnapshots: snapshots.length,
      includeContent,
      provenance: commandProvenance(result.provenance, snapshots.length)
    };
  }
  async listDeleted(sessionId) {
    const session = this.resolveSession(sessionId);
    const conversationId = conversationIdForSession(session);
    const result = conversationId === undefined ? { rows: [], provenance: "unknown" } : this.aiTracking.listDeletedFiles(conversationId);
    const deletedFiles = result.rows.map((row) => {
      const model = row.model;
      return {
        path: normalizePathRef(session, row.gitPath),
        ...row.deletedAt > 0 ? { deletedAt: millisToIso(row.deletedAt) } : {},
        ...model !== undefined ? { model } : {},
        provenance: result.provenance
      };
    });
    return {
      sessionId: session.localSessionId ?? session.cursorChatId ?? session.recordId,
      recordId: session.recordId,
      ...conversationId !== undefined ? { conversationId } : {},
      deletedFiles,
      totalDeletedFiles: deletedFiles.length,
      provenance: commandProvenance(result.provenance, deletedFiles.length)
    };
  }
  async findFile(path) {
    return this.index.findByPath(path);
  }
  async rebuild() {
    const sessions = this.sessions.listSessions(1e4);
    if (sessions.length === 0) {
      const availability = this.aiTracking.listConversationFileRefs([]);
      return this.index.rebuild({
        entries: [],
        indexedSessions: 0,
        skippedSessions: 0,
        provenance: availability.provenance
      });
    }
    const entries = [];
    let skippedSessions = 0;
    let sawMissingAiTracking = false;
    for (const session of sessions) {
      const conversationId = conversationIdForSession(session);
      if (conversationId === undefined) {
        skippedSessions += 1;
        continue;
      }
      const refs = this.aiTracking.listConversationFileRefs([conversationId]);
      if (refs.provenance === "missing_ai_tracking") {
        sawMissingAiTracking = true;
        skippedSessions += 1;
        continue;
      }
      if (refs.rows.length === 0) {
        skippedSessions += 1;
        continue;
      }
      for (const ref of refs.rows) {
        const pathRef = normalizePathRef(session, ref.path);
        entries.push({
          sessionId: session.localSessionId ?? session.cursorChatId ?? session.recordId,
          recordId: session.recordId,
          conversationId,
          rawPath: ref.path,
          normalizedPath: normalizeIndexPath(pathRef.path),
          pathKind: pathRef.pathKind,
          operation: ref.operation,
          ...ref.observedAt !== undefined ? { observedAt: millisToIso(ref.observedAt) } : {},
          ...ref.model !== undefined ? { model: ref.model } : {},
          provenance: "ai_tracking"
        });
      }
    }
    return this.index.rebuild({
      entries,
      indexedSessions: sessions.length - skippedSessions,
      skippedSessions,
      provenance: sawMissingAiTracking && entries.length === 0 ? "missing_ai_tracking" : "ai_tracking"
    });
  }
  resolveSession(sessionId) {
    const session = this.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new FileIntelligenceNotFoundError("session not found");
    }
    return session;
  }
}
function conversationIdForSession(session) {
  return session.localSessionId ?? session.cursorChatId;
}
function groupTouches(session, rows, provenance) {
  const grouped = new Map;
  for (const row of rows) {
    if (row.fileName === undefined) {
      continue;
    }
    const path = normalizePathRef(session, row.fileName);
    const key = path.path;
    const current = grouped.get(key) ?? { path, count: 0, models: new Set };
    current.count += 1;
    if (row.timestamp !== undefined) {
      current.first = current.first === undefined ? row.timestamp : Math.min(current.first, row.timestamp);
      current.last = current.last === undefined ? row.timestamp : Math.max(current.last, row.timestamp);
    }
    if (row.model !== undefined) {
      current.models.add(row.model);
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map((entry) => ({
    path: entry.path,
    operation: "touched",
    changeCount: entry.count,
    ...entry.first !== undefined ? { firstObservedAt: millisToIso(entry.first) } : {},
    ...entry.last !== undefined ? { lastObservedAt: millisToIso(entry.last) } : {},
    models: [...entry.models].sort(),
    provenance
  })).sort((a, b) => a.path.path.localeCompare(b.path.path));
}
function snapshotToResult(session, row, provenance, includeContent) {
  return {
    path: normalizePathRef(session, row.gitPath),
    contentBytes: row.contentBytes,
    ...row.fileExtension !== undefined ? { fileExtension: row.fileExtension } : {},
    ...row.model !== undefined ? { model: row.model } : {},
    ...row.createdAt > 0 ? { createdAt: millisToIso(row.createdAt) } : {},
    ...includeContent && row.content !== undefined ? { content: row.content } : {},
    provenance
  };
}
function normalizePathRef(session, path) {
  const normalizedRaw = normalizeIndexPath(path);
  const workspace = session.workspacePath;
  if (workspace !== undefined && isAbsolute(path)) {
    const rel = normalizeIndexPath(relative(workspace, path));
    if (!rel.startsWith("../") && rel !== ".." && rel.length > 0) {
      return { path: rel, pathKind: "workspace_relative" };
    }
    return { path: normalizedRaw, pathKind: "absolute" };
  }
  if (!isAbsolute(path) && path.length > 0) {
    return { path: normalizedRaw, pathKind: "workspace_relative" };
  }
  return { path: normalizedRaw, pathKind: "raw" };
}
function millisToIso(value) {
  return new Date(value).toISOString();
}
function commandProvenance(provenance, rowCount) {
  if (provenance === "ai_tracking" && rowCount === 0) {
    return "missing_rows";
  }
  return provenance;
}
// src/group/progress.ts
var EMPTY_TOTALS = {
  pending: 0,
  running: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  unknown: 0
};
function activityStatusToWorkspaceStatus(activity, persisted) {
  if (activity === null) {
    return persisted;
  }
  switch (activity.status) {
    case "running":
      return "running";
    case "waiting_trust":
    case "waiting_input":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return persisted === "pending" ? "unknown" : persisted;
  }
}
function workspaceSessionId(workspace) {
  return workspace.localSessionId ?? workspace.cursorChatId;
}
function countTotals(workspaces) {
  const totals = { ...EMPTY_TOTALS };
  for (const workspace of workspaces) {
    totals[workspace.status] += 1;
  }
  return totals;
}
async function deriveWorkspace(workspace, deps) {
  const sessionId = workspaceSessionId(workspace);
  const activity = sessionId !== undefined ? await deps.getActivity(sessionId) : null;
  const status = activityStatusToWorkspaceStatus(activity, workspace.status);
  return {
    ...workspace,
    status,
    updatedAt: activity?.updatedAt ?? workspace.updatedAt
  };
}
async function deriveGroupProgressSnapshot(group, deps) {
  const run = group.lastRun;
  if (run === undefined) {
    return {
      group,
      totals: { ...EMPTY_TOTALS },
      provenance: "group-store+activity",
      updatedAt: deps.now()
    };
  }
  const workspaces = await Promise.all(run.workspaces.map((workspace) => deriveWorkspace(workspace, deps)));
  const derivedRun = {
    ...run,
    workspaces,
    updatedAt: workspaces.map((workspace) => workspace.updatedAt).sort().at(-1) ?? run.updatedAt
  };
  return {
    group: {
      ...group,
      lastRun: derivedRun
    },
    run: derivedRun,
    totals: countTotals(workspaces),
    provenance: "group-store+activity",
    updatedAt: derivedRun.updatedAt
  };
}

// src/queue/progress.ts
var EMPTY_TOTALS2 = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  manual: 0
};
function activityStatusToItemStatus(activity, persisted) {
  if (activity === null) {
    return persisted;
  }
  switch (activity.status) {
    case "running":
    case "waiting_trust":
    case "waiting_input":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return persisted;
  }
}
function itemSessionId(item) {
  return item.localSessionId ?? item.cursorChatId;
}
function countTotals2(items) {
  const totals = { ...EMPTY_TOTALS2 };
  for (const item of items) {
    totals[item.status] += 1;
    if (item.mode === "manual") {
      totals.manual += 1;
    }
  }
  return totals;
}
async function deriveItem(item, deps) {
  const sessionId = itemSessionId(item);
  const activity = sessionId !== undefined ? await deps.getActivity(sessionId) : null;
  const status = activityStatusToItemStatus(activity, item.status);
  return {
    ...item,
    status,
    ...activity?.updatedAt !== undefined ? { updatedAt: activity.updatedAt } : {}
  };
}
function deriveRunUpdatedAt(run, items) {
  return items.map((item) => item.updatedAt).filter((updatedAt) => updatedAt !== undefined).sort().at(-1) ?? run.updatedAt;
}
async function deriveQueueProgressSnapshot(queue, deps) {
  const items = await Promise.all(queue.items.map((item) => deriveItem(item, deps)));
  const run = queue.lastRun === undefined ? undefined : {
    ...queue.lastRun,
    updatedAt: deriveRunUpdatedAt(queue.lastRun, items)
  };
  return {
    queue: {
      ...queue,
      items,
      ...run !== undefined ? { lastRun: run } : {}
    },
    ...run !== undefined ? { run } : {},
    totals: countTotals2(items),
    provenance: "queue-store+activity",
    updatedAt: run?.updatedAt ?? queue.updatedAt ?? deps.now()
  };
}

// src/persistence/groups-store.ts
import { randomUUID as randomUUID4 } from "crypto";
import { mkdirSync as mkdirSync4 } from "fs";
import { readFile as readFile4, writeFile as writeFile3 } from "fs/promises";
import { dirname as dirname4 } from "path";
var WORKSPACE_STATUSES = new Set([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "unknown"
]);
var RUN_STATUSES = new Set([
  "running",
  "completed",
  "failed",
  "paused"
]);
var LIFECYCLE_STATES = new Set([
  "active",
  "paused",
  "completed",
  "failed"
]);
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}
function readString2(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function readStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}
function normalizeWorkspace(raw, fallbackWorkspace, now) {
  if (!isRecord3(raw)) {
    return {
      workspace: fallbackWorkspace,
      status: "unknown",
      updatedAt: now
    };
  }
  const status = raw["status"];
  const exitCode = raw["exitCode"];
  const localSessionId = readString2(raw["localSessionId"]);
  const cursorChatId = readString2(raw["cursorChatId"]);
  const startedAt = readString2(raw["startedAt"]);
  const completedAt = readString2(raw["completedAt"]);
  return {
    workspace: readString2(raw["workspace"]) ?? fallbackWorkspace,
    ...localSessionId !== undefined ? { localSessionId } : {},
    ...cursorChatId !== undefined ? { cursorChatId } : {},
    status: typeof status === "string" && WORKSPACE_STATUSES.has(status) ? status : "unknown",
    ...startedAt !== undefined ? { startedAt } : {},
    updatedAt: readString2(raw["updatedAt"]) ?? now,
    ...completedAt !== undefined ? { completedAt } : {},
    ...typeof exitCode === "number" ? { exitCode } : {}
  };
}
function normalizeRun(raw, workspaces, now) {
  if (!isRecord3(raw)) {
    return;
  }
  const status = raw["status"];
  if (typeof status !== "string" || !RUN_STATUSES.has(status)) {
    return;
  }
  const rawWorkspaces = Array.isArray(raw["workspaces"]) ? raw["workspaces"] : [];
  const promptPreview = readString2(raw["promptPreview"]);
  const completedAt = readString2(raw["completedAt"]);
  return {
    id: readString2(raw["id"]) ?? randomUUID4(),
    status,
    ...promptPreview !== undefined ? { promptPreview } : {},
    startedAt: readString2(raw["startedAt"]) ?? now,
    updatedAt: readString2(raw["updatedAt"]) ?? now,
    ...completedAt !== undefined ? { completedAt } : {},
    workspaces: rawWorkspaces.map((workspace, index) => normalizeWorkspace(workspace, workspaces[index] ?? `workspace-${index}`, now))
  };
}
function normalizeGroup(raw, now) {
  if (!isRecord3(raw)) {
    return;
  }
  const name = readString2(raw["name"]);
  if (name === undefined) {
    return;
  }
  const workspaces = readStringArray(raw["workspaces"]);
  const lifecycleState = raw["lifecycleState"];
  const normalizedLifecycle = typeof lifecycleState === "string" && LIFECYCLE_STATES.has(lifecycleState) ? lifecycleState : "active";
  const lastRun = normalizeRun(raw["lastRun"], workspaces, now);
  const createdAt = readString2(raw["createdAt"]);
  const updatedAt = readString2(raw["updatedAt"]);
  return {
    name,
    workspaces,
    lifecycleState: normalizedLifecycle,
    ...createdAt !== undefined ? { createdAt } : {},
    ...updatedAt !== undefined ? { updatedAt } : {},
    ...lastRun !== undefined ? { lastRun } : {}
  };
}
async function load3(path) {
  try {
    const raw = await readFile4(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "groups" in parsed && Array.isArray(parsed.groups)) {
      const now = new Date().toISOString();
      return {
        groups: parsed.groups.map((group) => normalizeGroup(group, now)).filter((group) => group !== undefined)
      };
    }
  } catch {}
  return { groups: [] };
}
async function save2(path, data) {
  mkdirSync4(dirname4(path), { recursive: true });
  await writeFile3(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
async function listGroups(path = groupsJsonPath()) {
  const data = await load3(path);
  return data.groups;
}
async function getGroup(name, path = groupsJsonPath()) {
  const data = await load3(path);
  return data.groups.find((g) => g.name === name);
}
async function createGroup(name, path = groupsJsonPath()) {
  const data = await load3(path);
  if (data.groups.some((g) => g.name === name)) {
    throw new Error(`group '${name}' already exists`);
  }
  const now = new Date().toISOString();
  const group = {
    name,
    workspaces: [],
    lifecycleState: "active",
    createdAt: now,
    updatedAt: now
  };
  const next = { groups: [...data.groups, group] };
  await save2(path, next);
  return group;
}
async function addWorkspaceToGroup(name, workspace, path = groupsJsonPath()) {
  const data = await load3(path);
  const idx = data.groups.findIndex((g2) => g2.name === name);
  if (idx < 0) {
    throw new Error(`group '${name}' not found`);
  }
  const g = data.groups[idx];
  if (g === undefined) {
    throw new Error(`group '${name}' not found`);
  }
  if (g.workspaces.includes(workspace)) {
    return g;
  }
  const updated = {
    ...g,
    workspaces: [...g.workspaces, workspace],
    updatedAt: new Date().toISOString()
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save2(path, { groups });
  return updated;
}
async function removeWorkspaceFromGroup(name, workspace, path = groupsJsonPath()) {
  const data = await load3(path);
  const idx = data.groups.findIndex((g2) => g2.name === name);
  if (idx < 0) {
    throw new Error(`group '${name}' not found`);
  }
  const g = data.groups[idx];
  if (g === undefined) {
    throw new Error(`group '${name}' not found`);
  }
  const updated = {
    ...g,
    workspaces: g.workspaces.filter((w) => w !== workspace),
    updatedAt: new Date().toISOString()
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save2(path, { groups });
  return updated;
}
async function deleteGroup(name, path = groupsJsonPath()) {
  const data = await load3(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    return;
  }
  const deleted = data.groups[idx];
  if (deleted === undefined) {
    return;
  }
  await save2(path, {
    groups: data.groups.filter((g) => g.name !== name)
  });
  return deleted;
}
async function pauseGroup(name, path = groupsJsonPath()) {
  return updateGroupRun(name, { lifecycleState: "paused" }, path);
}
async function resumeGroup(name, path = groupsJsonPath()) {
  return updateGroupRun(name, { lifecycleState: "active" }, path);
}
async function updateGroupRun(name, update, path = groupsJsonPath()) {
  const data = await load3(path);
  const idx = data.groups.findIndex((g) => g.name === name);
  if (idx < 0) {
    return;
  }
  const current = data.groups[idx];
  if (current === undefined) {
    return;
  }
  const updated = {
    ...current,
    ...update.lifecycleState !== undefined ? { lifecycleState: update.lifecycleState } : {},
    ...update.lastRun !== undefined ? { lastRun: update.lastRun } : {},
    updatedAt: new Date().toISOString()
  };
  const groups = [...data.groups];
  groups[idx] = updated;
  await save2(path, { groups });
  return updated;
}

// src/persistence/queues-store.ts
import { randomUUID as randomUUID5 } from "crypto";
import { mkdirSync as mkdirSync5 } from "fs";
import { readFile as readFile5, writeFile as writeFile4 } from "fs/promises";
import { dirname as dirname5, resolve as resolve2 } from "path";
var LIFECYCLE_STATES2 = new Set([
  "active",
  "paused",
  "completed",
  "failed",
  "stopped"
]);
var ITEM_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped"
]);
var ITEM_MODES = new Set(["auto", "manual"]);
var RUN_STATUSES2 = new Set([
  "running",
  "completed",
  "failed",
  "paused",
  "stopped"
]);
function isRecord4(value) {
  return typeof value === "object" && value !== null;
}
function readString3(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function readStringArray2(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}
function normalizeItem(raw, now) {
  if (!isRecord4(raw)) {
    return;
  }
  const id = readString3(raw["id"]);
  const prompt = readString3(raw["prompt"]);
  if (id === undefined || prompt === undefined) {
    return;
  }
  const status = raw["status"];
  const mode = raw["mode"];
  const localSessionId = readString3(raw["localSessionId"]);
  const cursorChatId = readString3(raw["cursorChatId"]);
  const updatedAt = readString3(raw["updatedAt"]);
  const startedAt = readString3(raw["startedAt"]);
  const completedAt = readString3(raw["completedAt"]);
  const result = isRecord4(raw["result"]) ? raw["result"] : undefined;
  const exitCode = result?.["exitCode"];
  return {
    id,
    prompt,
    status: typeof status === "string" && ITEM_STATUSES.has(status) ? status : "pending",
    mode: typeof mode === "string" && ITEM_MODES.has(mode) ? mode : "auto",
    createdAt: readString3(raw["createdAt"]) ?? now,
    ...updatedAt !== undefined ? { updatedAt } : {},
    ...startedAt !== undefined ? { startedAt } : {},
    ...completedAt !== undefined ? { completedAt } : {},
    ...localSessionId !== undefined ? { localSessionId } : {},
    ...cursorChatId !== undefined ? { cursorChatId } : {},
    ...exitCode === null || typeof exitCode === "number" ? { result: { exitCode } } : {}
  };
}
function normalizeRun2(raw, now) {
  if (!isRecord4(raw)) {
    return;
  }
  const status = raw["status"];
  if (typeof status !== "string" || !RUN_STATUSES2.has(status)) {
    return;
  }
  const completedAt = readString3(raw["completedAt"]);
  const currentItemId = readString3(raw["currentItemId"]);
  const stoppedAt = readString3(raw["stoppedAt"]);
  return {
    id: readString3(raw["id"]) ?? randomUUID5(),
    status,
    startedAt: readString3(raw["startedAt"]) ?? now,
    updatedAt: readString3(raw["updatedAt"]) ?? now,
    ...completedAt !== undefined ? { completedAt } : {},
    ...currentItemId !== undefined ? { currentItemId } : {},
    completedItemIds: readStringArray2(raw["completedItemIds"]),
    failedItemIds: readStringArray2(raw["failedItemIds"]),
    pendingItemIds: readStringArray2(raw["pendingItemIds"]),
    ...stoppedAt !== undefined ? { stoppedAt } : {}
  };
}
function normalizeQueue(raw, now) {
  if (!isRecord4(raw)) {
    return;
  }
  const name = readString3(raw["name"]);
  const workspace = readString3(raw["workspace"]);
  if (name === undefined || workspace === undefined) {
    return;
  }
  const lifecycleState = raw["lifecycleState"];
  const createdAt = readString3(raw["createdAt"]);
  const updatedAt = readString3(raw["updatedAt"]);
  const stopRequestedAt = readString3(raw["stopRequestedAt"]);
  const items = Array.isArray(raw["items"]) ? raw["items"].map((item) => normalizeItem(item, now)).filter((item) => item !== undefined) : [];
  const lastRun = normalizeRun2(raw["lastRun"], now);
  return {
    name,
    workspace,
    lifecycleState: typeof lifecycleState === "string" && LIFECYCLE_STATES2.has(lifecycleState) ? lifecycleState : "active",
    ...createdAt !== undefined ? { createdAt } : {},
    ...updatedAt !== undefined ? { updatedAt } : {},
    ...stopRequestedAt !== undefined ? { stopRequestedAt } : {},
    items,
    ...lastRun !== undefined ? { lastRun } : {}
  };
}
async function load4(path) {
  try {
    const raw = await readFile5(path, "utf8");
    const parsed = JSON.parse(raw);
    if (isRecord4(parsed) && "queues" in parsed && Array.isArray(parsed.queues)) {
      const now = new Date().toISOString();
      return {
        queues: parsed.queues.map((queue) => normalizeQueue(queue, now)).filter((queue) => queue !== undefined)
      };
    }
  } catch {}
  return { queues: [] };
}
async function save3(path, data) {
  mkdirSync5(dirname5(path), { recursive: true });
  await writeFile4(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
async function mutateQueue(name, update, path = queuesJsonPath()) {
  const data = await load4(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    return;
  }
  const current = data.queues[idx];
  if (current === undefined) {
    return;
  }
  const updated = update(current, new Date().toISOString());
  const queues = [...data.queues];
  queues[idx] = updated;
  await save3(path, { queues });
  return updated;
}
async function listQueues(path = queuesJsonPath()) {
  const data = await load4(path);
  return data.queues;
}
async function getQueue(name, path = queuesJsonPath()) {
  const data = await load4(path);
  return data.queues.find((q) => q.name === name);
}
async function createQueue(name, workspace, path = queuesJsonPath()) {
  const data = await load4(path);
  if (data.queues.some((q) => q.name === name)) {
    throw new Error(`queue '${name}' already exists`);
  }
  const now = new Date().toISOString();
  const queue = {
    name,
    workspace: resolve2(workspace),
    lifecycleState: "active",
    createdAt: now,
    updatedAt: now,
    items: []
  };
  await save3(path, { queues: [...data.queues, queue] });
  return queue;
}
async function addQueueItem(name, prompt, options) {
  let path = queuesJsonPath();
  let attachments;
  if (typeof options === "string") {
    path = options;
  } else if (options !== undefined) {
    if (options.path !== undefined) {
      path = options.path;
    }
    attachments = options.attachments !== undefined && options.attachments.length > 0 ? options.attachments : undefined;
  }
  const updated = await mutateQueue(name, (q, now) => ({
    ...q,
    lifecycleState: q.lifecycleState === "completed" ? "active" : q.lifecycleState,
    updatedAt: now,
    items: [
      ...q.items,
      {
        id: randomUUID5(),
        prompt,
        ...attachments !== undefined ? { attachments } : {},
        status: "pending",
        mode: "auto",
        createdAt: now,
        updatedAt: now
      }
    ]
  }), path);
  if (updated === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  return updated;
}
async function removeQueueItem(name, itemId, path = queuesJsonPath()) {
  const updated = await mutateQueue(name, (q, now) => ({
    ...q,
    updatedAt: now,
    items: q.items.filter((i) => i.id !== itemId)
  }), path);
  if (updated === undefined) {
    throw new Error(`queue '${name}' not found`);
  }
  return updated;
}
async function deleteQueue(name, path = queuesJsonPath()) {
  const data = await load4(path);
  const idx = data.queues.findIndex((q) => q.name === name);
  if (idx < 0) {
    return;
  }
  const deleted = data.queues[idx];
  if (deleted === undefined) {
    return;
  }
  await save3(path, { queues: data.queues.filter((q) => q.name !== name) });
  return deleted;
}
async function pauseQueue(name, path = queuesJsonPath()) {
  return updateQueueRun(name, { lifecycleState: "paused" }, path);
}
async function resumeQueue(name, path = queuesJsonPath()) {
  return updateQueueRun(name, {
    lifecycleState: "active",
    stopRequestedAt: undefined
  }, path);
}
async function requestQueueStop(name, path = queuesJsonPath()) {
  const queue = await getQueue(name, path);
  if (queue === undefined) {
    return;
  }
  if (queue.lastRun?.status !== "running") {
    return queue;
  }
  return updateQueueRun(name, {
    lifecycleState: "stopped",
    stopRequestedAt: new Date().toISOString()
  }, path);
}
async function updateQueueItem(name, itemId, patch, path = queuesJsonPath()) {
  return mutateQueue(name, (q, now) => ({
    ...q,
    updatedAt: now,
    items: q.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      const status = patch.status ?? item.status;
      const updated = {
        id: item.id,
        prompt: patch.prompt ?? item.prompt,
        status,
        mode: patch.mode ?? item.mode,
        createdAt: item.createdAt,
        updatedAt: now
      };
      if (status === "pending") {
        return updated;
      }
      return {
        ...updated,
        ...item.startedAt !== undefined ? { startedAt: item.startedAt } : {},
        ...item.completedAt !== undefined ? { completedAt: item.completedAt } : {},
        ...item.localSessionId !== undefined ? { localSessionId: item.localSessionId } : {},
        ...item.cursorChatId !== undefined ? { cursorChatId: item.cursorChatId } : {},
        ...item.result !== undefined ? { result: item.result } : {}
      };
    })
  }), path);
}
async function moveQueueItem(name, from, to, path = queuesJsonPath()) {
  return mutateQueue(name, (q, now) => {
    const item = q.items[from];
    if (item === undefined) {
      return q;
    }
    const without = q.items.filter((_, index) => index !== from);
    return {
      ...q,
      updatedAt: now,
      items: [...without.slice(0, to), item, ...without.slice(to)]
    };
  }, path);
}
async function updateQueueRun(name, update, path = queuesJsonPath()) {
  return mutateQueue(name, (q, now) => {
    const updated = {
      name: q.name,
      workspace: q.workspace,
      lifecycleState: update.lifecycleState ?? q.lifecycleState,
      ...q.createdAt !== undefined ? { createdAt: q.createdAt } : {},
      updatedAt: now,
      ...update.lastRun !== undefined ? { lastRun: update.lastRun } : q.lastRun !== undefined ? { lastRun: q.lastRun } : {},
      items: update.items ?? q.items
    };
    const hasStopRequest = Object.hasOwn(update, "stopRequestedAt");
    if (!hasStopRequest && q.stopRequestedAt !== undefined) {
      return { ...updated, stopRequestedAt: q.stopRequestedAt };
    }
    if (hasStopRequest && update.stopRequestedAt !== undefined) {
      return { ...updated, stopRequestedAt: update.stopRequestedAt };
    }
    return updated;
  }, path);
}

// src/persistence/session-index.ts
import { randomUUID as randomUUID6 } from "crypto";
import { mkdirSync as mkdirSync6 } from "fs";
import { readdir } from "fs/promises";
import { basename, dirname as dirname6, join as join3, resolve as resolve3 } from "path";
import { Database as Database3 } from "bun:sqlite";

// src/cursor/workspace-resolver.ts
import { readFile as readFile6 } from "fs/promises";
import { join as join2 } from "path";
var WORKSPACE_PATH_RE = /workspacePath=([^\s]+)/;
async function resolveWorkspacePathFromWorkerLog(workspaceSlug) {
  const logPath = join2(cursorProjectsRoot(), workspaceSlug, "worker.log");
  try {
    const text = await readFile6(logPath, "utf8");
    let last;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(WORKSPACE_PATH_RE);
      if (m?.[1] !== undefined) {
        last = m[1];
      }
    }
    return last;
  } catch {
    return;
  }
}

// src/persistence/session-index.ts
function rowToRecord(r) {
  const localSessionId = optionalString3(r["local_session_id"]);
  const cursorChatId = optionalString3(r["cursor_chat_id"]);
  const workspacePath = optionalString3(r["workspace_path"]);
  const transcriptPath = optionalString3(r["transcript_path"]);
  const materializedAt = optionalString3(r["materialized_at"]);
  const model = optionalString3(r["model"]);
  const mode = parseMode(r["mode"]);
  const firstUserText = optionalString3(r["first_user_text"]);
  const lastAssistantText = optionalString3(r["last_assistant_text"]);
  return {
    recordId: String(r["record_id"]),
    identityState: r["identity_state"],
    workspaceSlug: String(r["workspace_slug"]),
    createdAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
    source: r["source"],
    status: r["status"],
    ...localSessionId !== undefined ? { localSessionId } : {},
    ...cursorChatId !== undefined ? { cursorChatId } : {},
    ...workspacePath !== undefined ? { workspacePath } : {},
    ...transcriptPath !== undefined ? { transcriptPath } : {},
    ...materializedAt !== undefined ? { materializedAt } : {},
    ...model !== undefined ? { model } : {},
    ...mode !== undefined ? { mode } : {},
    ...firstUserText !== undefined ? { firstUserText } : {},
    ...lastAssistantText !== undefined ? { lastAssistantText } : {}
  };
}
function optionalString3(v) {
  if (typeof v === "string" && v.length > 0) {
    return v;
  }
  return;
}
function stableRecordId(existing) {
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  return randomUUID6();
}
function parseMode(v) {
  if (v === "default" || v === "plan" || v === "ask") {
    return v;
  }
  return;
}
function normalizeSearchQuery(query) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("query must not be empty");
  }
  return normalized;
}
function normalizeSearchFilters(filters) {
  const workspace = filters?.workspace === undefined ? undefined : resolve3(filters.workspace);
  return {
    ...workspace !== undefined ? { workspace } : {},
    ...filters?.model !== undefined ? { model: filters.model } : {},
    ...filters?.mode !== undefined ? { mode: filters.mode } : {},
    ...filters?.status !== undefined ? { status: filters.status } : {}
  };
}
function searchCandidateFields(record) {
  return [
    ["recordId", record.recordId],
    ["localSessionId", record.localSessionId],
    ["cursorChatId", record.cursorChatId],
    ["workspaceSlug", record.workspaceSlug],
    ["workspacePath", record.workspacePath],
    ["model", record.model],
    ["mode", record.mode],
    ["status", record.status],
    ["source", record.source],
    ["firstUserText", record.firstUserText],
    ["lastAssistantText", record.lastAssistantText]
  ];
}
function matchFieldsForRecord(record, normalizedQuery) {
  const matches = [];
  for (const [field, value] of searchCandidateFields(record)) {
    if (value?.toLowerCase().includes(normalizedQuery) === true) {
      matches.push(field);
    }
  }
  return matches;
}
function toSearchHit(record, matchFields) {
  return {
    ...record,
    matchFields,
    provenance: "index"
  };
}
async function listJsonlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join3(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files.sort();
}
var MIGRATION2 = `
CREATE TABLE IF NOT EXISTS sessions (
  record_id TEXT PRIMARY KEY NOT NULL,
  local_session_id TEXT UNIQUE,
  cursor_chat_id TEXT UNIQUE,
  identity_state TEXT NOT NULL,
  workspace_slug TEXT NOT NULL,
  workspace_path TEXT,
  transcript_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  materialized_at TEXT,
  source TEXT NOT NULL,
  model TEXT,
  mode TEXT,
  status TEXT NOT NULL,
  first_user_text TEXT,
  last_assistant_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_slug);
`;

class SessionIndexRepository {
  db;
  projectsRoot;
  constructor(dbPath, options = {}) {
    mkdirSync6(dirname6(dbPath), { recursive: true });
    this.db = new Database3(dbPath, { create: true });
    this.projectsRoot = options.cursorProjectsRoot;
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(MIGRATION2);
  }
  close() {
    this.db.close();
  }
  upsert(record) {
    const stmt = this.db.prepare(`
INSERT INTO sessions (
  record_id, local_session_id, cursor_chat_id, identity_state, workspace_slug,
  workspace_path, transcript_path, created_at, updated_at, materialized_at,
  source, model, mode, status, first_user_text, last_assistant_text
) VALUES (
  @record_id, @local_session_id, @cursor_chat_id, @identity_state, @workspace_slug,
  @workspace_path, @transcript_path, @created_at, @updated_at, @materialized_at,
  @source, @model, @mode, @status, @first_user_text, @last_assistant_text
)
ON CONFLICT(record_id) DO UPDATE SET
  local_session_id = excluded.local_session_id,
  cursor_chat_id = excluded.cursor_chat_id,
  identity_state = excluded.identity_state,
  workspace_slug = excluded.workspace_slug,
  workspace_path = excluded.workspace_path,
  transcript_path = excluded.transcript_path,
  updated_at = excluded.updated_at,
  materialized_at = excluded.materialized_at,
  source = excluded.source,
  model = excluded.model,
  mode = excluded.mode,
  status = excluded.status,
  first_user_text = excluded.first_user_text,
  last_assistant_text = excluded.last_assistant_text
`);
    stmt.run({
      "@record_id": record.recordId,
      "@local_session_id": record.localSessionId ?? null,
      "@cursor_chat_id": record.cursorChatId ?? null,
      "@identity_state": record.identityState,
      "@workspace_slug": record.workspaceSlug,
      "@workspace_path": record.workspacePath ?? null,
      "@transcript_path": record.transcriptPath ?? null,
      "@created_at": record.createdAt,
      "@updated_at": record.updatedAt,
      "@materialized_at": record.materializedAt ?? null,
      "@source": record.source,
      "@model": record.model ?? null,
      "@mode": record.mode ?? null,
      "@status": record.status,
      "@first_user_text": record.firstUserText ?? null,
      "@last_assistant_text": record.lastAssistantText ?? null
    });
  }
  findByRecordId(recordId) {
    const row = this.db.query("SELECT * FROM sessions WHERE record_id = ?").get(recordId);
    return row === null ? undefined : rowToRecord(row);
  }
  findByLocalSessionId(id) {
    const row = this.db.query("SELECT * FROM sessions WHERE local_session_id = ?").get(id);
    return row === null ? undefined : rowToRecord(row);
  }
  findByCursorChatId(id) {
    const row = this.db.query("SELECT * FROM sessions WHERE cursor_chat_id = ?").get(id);
    return row === null ? undefined : rowToRecord(row);
  }
  resolveSessionKey(key) {
    return this.findByLocalSessionId(key) ?? this.findByCursorChatId(key) ?? this.findByRecordId(key);
  }
  listSessions(limit) {
    const rows = this.db.query("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?").all(limit);
    return rows.map(rowToRecord);
  }
  listSessionsForWorkspace(workspacePath, limit) {
    const abs = resolve3(workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const rows = this.db.query(`SELECT * FROM sessions
         WHERE workspace_slug = ? OR workspace_path = ?
         ORDER BY updated_at DESC LIMIT ?`).all(slug, abs, limit);
    return rows.map(rowToRecord);
  }
  listTranscriptBackedSessions() {
    const rows = this.db.query(`SELECT * FROM sessions
         WHERE transcript_path IS NOT NULL AND transcript_path != ''
         ORDER BY updated_at DESC, record_id ASC`).all();
    return rows.map(rowToRecord);
  }
  searchSessions(options) {
    const normalizedQuery = normalizeSearchQuery(options.query);
    if (!Number.isInteger(options.limit) || !Number.isFinite(options.limit) || options.limit <= 0) {
      throw new Error("limit must be a positive integer");
    }
    if (!Number.isInteger(options.offset) || !Number.isFinite(options.offset) || options.offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }
    const limit = options.limit;
    const offset = options.offset;
    const filters = normalizeSearchFilters(options.filters);
    const clauses = [];
    const params = [];
    if (filters.workspace !== undefined) {
      clauses.push("(workspace_slug = ? OR workspace_path = ?)");
      params.push(workspaceSlugFromPath(filters.workspace), filters.workspace);
    }
    if (filters.model !== undefined) {
      clauses.push("model = ?");
      params.push(filters.model);
    }
    if (filters.mode !== undefined) {
      clauses.push("mode = ?");
      params.push(filters.mode);
    }
    if (filters.status !== undefined) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.query(`SELECT * FROM sessions ${where}
         ORDER BY updated_at DESC, record_id ASC`).all(...params);
    const hits = rows.flatMap((row) => {
      const record = rowToRecord(row);
      const matchFields = matchFieldsForRecord(record, normalizedQuery);
      return matchFields.length > 0 ? [toSearchHit(record, matchFields)] : [];
    });
    return {
      query: options.query,
      filters,
      sessions: hits.slice(offset, offset + limit),
      total: hits.length,
      offset,
      limit,
      provenance: "index"
    };
  }
  insertPendingChatRecord(cursorChatId, workspacePath) {
    const now = new Date().toISOString();
    const slug = workspaceSlugFromPath(workspacePath);
    const record = {
      recordId: randomUUID6(),
      cursorChatId,
      identityState: "chat_only",
      workspaceSlug: slug,
      workspacePath,
      createdAt: now,
      updatedAt: now,
      source: "create-chat",
      status: "pending"
    };
    this.upsert(record);
    return record;
  }
  async importTranscriptsFromFilesystem() {
    let count = 0;
    const root = this.projectsRoot ?? cursorProjectsRoot();
    let projectDirs;
    try {
      projectDirs = await readdir(root, { withFileTypes: true });
    } catch {
      return 0;
    }
    const now = new Date().toISOString();
    for (const ent of projectDirs) {
      if (!ent.isDirectory()) {
        continue;
      }
      const slug = ent.name;
      const transcriptsDir = join3(root, slug, "agent-transcripts");
      let files;
      try {
        files = (await listJsonlFiles(transcriptsDir)).map((path) => ({
          path,
          name: basename(path)
        }));
      } catch {
        continue;
      }
      const workspacePath = await resolveWorkspacePathFromWorkerLog(slug);
      for (const f of files) {
        const localSessionId = basename(f.name, ".jsonl");
        const transcriptPath = f.path;
        const summary = await readTranscriptFile(transcriptPath);
        const existing = this.findByLocalSessionId(localSessionId) ?? this.findByCursorChatId(localSessionId);
        const wasChatOnly = existing?.identityState === "chat_only";
        const cursorChatId = existing?.cursorChatId !== undefined ? existing.cursorChatId : wasChatOnly ? localSessionId : undefined;
        const wp = workspacePath ?? existing?.workspacePath;
        const fu = summary.firstUserMessage?.displayText ?? existing?.firstUserText;
        const la = summary.lastAssistantMessage?.displayText ?? existing?.lastAssistantText;
        const record = {
          recordId: stableRecordId(existing?.recordId),
          localSessionId,
          identityState: wasChatOnly ? "linked" : existing?.identityState ?? "transcript_only",
          workspaceSlug: slug,
          transcriptPath,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          materializedAt: existing?.materializedAt ?? now,
          source: existing?.source ?? "unknown",
          status: existing?.status ?? "unknown",
          ...cursorChatId !== undefined ? { cursorChatId } : {},
          ...wp !== undefined ? { workspacePath: wp } : {},
          ...fu !== undefined ? { firstUserText: fu } : {},
          ...la !== undefined ? { lastAssistantText: la } : {}
        };
        this.upsert(record);
        count += 1;
      }
    }
    return count;
  }
}

// src/sdk/facades.ts
function dataPath(stateRoot, name) {
  return join4(stateRoot, name);
}
function nullIfMissing(value) {
  return value ?? null;
}
function createDomainFacades(options = {}) {
  const stateRoot = options.stateRoot ?? getDataDir();
  const cursorHome = options.cursorHome ?? getCursorHome();
  const now = options.now ?? (() => new Date);
  const repository = new SessionIndexRepository(dataPath(stateRoot, "state.db"), { cursorProjectsRoot: join4(cursorHome, "projects") });
  const activityManager = createActivityManager({
    sessions: repository,
    store: createActivityStore(dataPath(stateRoot, "activity-signals.json"))
  });
  const bookmarkManager = createBookmarkManager({
    sessions: repository,
    store: createBookmarksStore(dataPath(stateRoot, "bookmarks.json")),
    now
  });
  const fileService = createFileIntelligenceService({
    sessions: repository,
    aiTracking: createAiTrackingFileReader(join4(cursorHome, "ai-tracking", "ai-code-tracking.db")),
    index: new FileIntelligenceIndex(dataPath(stateRoot, "file-intelligence.db"))
  });
  const transcriptSearch = createTranscriptSearchService(repository);
  const groupsPath = dataPath(stateRoot, "groups.json");
  const queuesPath = dataPath(stateRoot, "queues.json");
  const nowIso = () => now().toISOString();
  return {
    sessions: {
      async list(listOptions) {
        await repository.importTranscriptsFromFilesystem();
        return repository.listSessions(listOptions?.limit ?? 1000);
      },
      async get(sessionId) {
        await repository.importTranscriptsFromFilesystem();
        return repository.resolveSessionKey(sessionId) ?? null;
      },
      async refresh() {
        await repository.importTranscriptsFromFilesystem();
        return repository.listSessions(1000);
      }
    },
    search: {
      async sessions(options2) {
        await repository.importTranscriptsFromFilesystem();
        return repository.searchSessions(options2);
      },
      async transcripts(options2) {
        await repository.importTranscriptsFromFilesystem();
        return transcriptSearch.search(options2);
      }
    },
    groups: {
      list: () => listGroups(groupsPath),
      async get(name) {
        return nullIfMissing(await getGroup(name, groupsPath));
      },
      create: (name) => createGroup(name, groupsPath),
      addWorkspace: (name, workspace) => addWorkspaceToGroup(name, workspace, groupsPath),
      removeWorkspace: (name, workspace) => removeWorkspaceFromGroup(name, workspace, groupsPath),
      async delete(name) {
        return nullIfMissing(await deleteGroup(name, groupsPath));
      },
      async pause(name) {
        return nullIfMissing(await pauseGroup(name, groupsPath));
      },
      async resume(name) {
        return nullIfMissing(await resumeGroup(name, groupsPath));
      },
      async progress(name) {
        const group = await getGroup(name, groupsPath);
        if (group === undefined) {
          return null;
        }
        return deriveGroupProgressSnapshot(group, {
          getActivity: activityManager.getSessionActivity,
          now: nowIso
        });
      }
    },
    queues: {
      list: () => listQueues(queuesPath),
      async get(name) {
        return nullIfMissing(await getQueue(name, queuesPath));
      },
      create: (name, workspace) => createQueue(name, workspace, queuesPath),
      addItem: (name, prompt) => addQueueItem(name, prompt, queuesPath),
      async updateItem(name, itemId, patch) {
        const storePatch = {
          ...patch.prompt !== undefined ? { prompt: patch.prompt } : {},
          ...patch.status !== undefined ? { status: patch.status } : {}
        };
        return nullIfMissing(await updateQueueItem(name, itemId, storePatch, queuesPath));
      },
      removeItem: (name, itemId) => removeQueueItem(name, itemId, queuesPath),
      async moveItem(name, from, to) {
        return nullIfMissing(await moveQueueItem(name, from, to, queuesPath));
      },
      async setItemMode(name, itemId, mode) {
        return nullIfMissing(await updateQueueItem(name, itemId, { mode }, queuesPath));
      },
      async delete(name) {
        return nullIfMissing(await deleteQueue(name, queuesPath));
      },
      async pause(name) {
        return nullIfMissing(await pauseQueue(name, queuesPath));
      },
      async resume(name) {
        return nullIfMissing(await resumeQueue(name, queuesPath));
      },
      async requestStop(name) {
        return nullIfMissing(await requestQueueStop(name, queuesPath));
      },
      async progress(name) {
        const queue = await getQueue(name, queuesPath);
        if (queue === undefined) {
          return null;
        }
        return deriveQueueProgressSnapshot(queue, {
          getActivity: activityManager.getSessionActivity,
          now: nowIso
        });
      }
    },
    bookmarks: bookmarkManager,
    files: {
      list: (sessionId) => fileService.listFiles(sessionId),
      snapshots: (sessionId, snapshotOptions) => fileService.listSnapshots(sessionId, snapshotOptions),
      deleted: (sessionId) => fileService.listDeleted(sessionId),
      find: (path) => fileService.findFile(path),
      rebuild: () => fileService.rebuild()
    },
    activity: {
      get: (sessionId) => activityManager.getSessionActivity(sessionId),
      list: (activityOptions) => activityManager.listActivity(activityOptions),
      recordSignal: (sessionId, signal) => activityManager.recordSignal(sessionId, signal)
    }
  };
}

// src/sdk/helpers.ts
import { join as join5 } from "path";

// src/cursor/tool-versions.ts
import { spawn } from "child_process";
// package.json
var package_default = {
  name: "cursor-cli-agent",
  version: "0.1.0",
  description: "CLI and TypeScript SDK for cursor-agent session data and automation",
  type: "module",
  bin: {
    "cursor-cli-agent": "dist/bin.js"
  },
  main: "dist/index.js",
  module: "dist/index.js",
  types: "dist/index.d.ts",
  files: [
    "dist",
    "README.md"
  ],
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js"
    },
    "./sdk": {
      types: "./dist/sdk/index.d.ts",
      import: "./dist/sdk/index.js",
      default: "./dist/sdk/index.js"
    },
    "./sdk/testing": {
      types: "./dist/sdk/testing.d.ts",
      import: "./dist/sdk/testing.js",
      default: "./dist/sdk/testing.js"
    },
    "./server": {
      types: "./dist/sdk/server.d.ts",
      import: "./dist/sdk/server.js",
      default: "./dist/sdk/server.js"
    },
    "./types": {
      types: "./dist/sdk/types.d.ts",
      import: "./dist/sdk/types.js",
      default: "./dist/sdk/types.js"
    }
  },
  scripts: {
    dev: "bun run --watch src/bin.ts",
    build: "rm -rf dist && tsc -p tsconfig.build.json && bun build src/index.ts src/bin.ts src/sdk/index.ts src/sdk/testing.ts src/sdk/server.ts src/sdk/types.ts --outdir dist --target bun",
    prepack: "bun run build",
    start: "bun run src/bin.ts",
    test: "scripts/run-src-tests.sh",
    "test:watch": "scripts/run-src-tests.sh --watch",
    typecheck: "tsc --noEmit",
    lint: "bun run lint:biome && bun run format:check && bun run typecheck",
    "lint:biome": "biome check . --diagnostic-level=warn",
    format: 'prettier --write "src/**/*.ts"',
    "format:check": 'prettier --check "src/**/*.ts"',
    clean: "rm -rf dist"
  },
  homepage: "https://github.com/tacogips/cursor-cli-agent",
  repository: {
    type: "git",
    url: "https://github.com/tacogips/cursor-cli-agent.git"
  },
  license: "MIT",
  trustedDependencies: [],
  devDependencies: {
    "@biomejs/biome": "2.3.15",
    "@types/bun": "1.1.14",
    typescript: "5.7.2",
    prettier: "3.4.2"
  }
};

// src/cursor/tool-versions.ts
var DEFAULT_VERSION_TIMEOUT_MS = 5000;
function normalizeTimeout(value) {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_VERSION_TIMEOUT_MS;
}
function firstLine(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/)[0] ?? null;
}
function failureMessage(result) {
  if (result.timedOut) {
    return "version command timed out";
  }
  if (result.error !== undefined && result.error.length > 0) {
    return result.error;
  }
  const reason = result.signal !== null ? `signal ${result.signal}` : `exit code ${String(result.exitCode ?? "unknown")}`;
  const details = firstLine(result.stderr) ?? firstLine(result.stdout);
  return details === null ? `version command failed (${reason})` : `version command failed (${reason}): ${details}`;
}
async function defaultToolCommandRunner(command, args, options) {
  return await new Promise((resolve4) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve4(result);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (exitCode, signal) => {
      settle({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut: false
      });
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: true,
        error: `command timed out after ${options.timeoutMs}ms`
      });
    }, options.timeoutMs);
  });
}
async function readToolVersion(name, command, options = {}) {
  const checkedAt = (options.now ?? (() => new Date))().toISOString();
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const runner = options.commandRunner ?? defaultToolCommandRunner;
  const result = await runner(command, ["--version"], { timeoutMs });
  if (result.exitCode === 0 && !result.timedOut && result.error === undefined) {
    const version = firstLine(result.stdout);
    if (version !== null) {
      return {
        name,
        command,
        version,
        status: "available",
        checkedAt
      };
    }
    return {
      name,
      command,
      version: null,
      status: "unavailable",
      error: "version command succeeded but produced no output",
      checkedAt
    };
  }
  return {
    name,
    command,
    version: null,
    status: "unavailable",
    error: failureMessage(result),
    checkedAt
  };
}
async function getToolVersions(options = {}) {
  const checkedAt = (options.now ?? (() => new Date))().toISOString();
  const tools = [];
  tools.push(await readToolVersion("cursor-agent", options.cursorAgentBinary ?? "cursor-agent", options));
  if (options.includeGit === true) {
    tools.push(await readToolVersion("git", options.gitBinary ?? "git", options));
  }
  if (options.includeBun === true) {
    tools.push(await readToolVersion("bun", options.bunBinary ?? "bun", options));
  }
  return {
    packageVersion: package_default.version,
    tools,
    checkedAt
  };
}

// src/cursor/model-availability.ts
var DEFAULT_MODEL_PROBE_TIMEOUT_MS = 15000;
var MODEL_PROBE_PROMPT = "Reply with exactly OK.";
function normalizeTimeout2(value) {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_MODEL_PROBE_TIMEOUT_MS;
}
function firstLine2(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/)[0] ?? null;
}
function summarizeProbeFailure(stdout, stderr, fallback) {
  const line = firstLine2(stderr) ?? firstLine2(stdout);
  if (line !== null) {
    return line;
  }
  return fallback ?? "model probe failed";
}
function classifyFailure(message) {
  if (/auth|login|credential|billing|quota|trust|workspace|not\s+enabled/i.test(message)) {
    return `probe failure: ${message}`;
  }
  return message;
}
async function runModelProbe(model, binary, runner, options) {
  const timeoutMs = normalizeTimeout2(options.timeoutMs);
  const result = await runner(binary, [
    "--print",
    "--output-format",
    "text",
    "--model",
    model,
    "--",
    MODEL_PROBE_PROMPT
  ], {
    timeoutMs,
    ...options.workspace !== undefined ? { cwd: options.workspace } : {}
  });
  if (result.exitCode === 0 && !result.timedOut && result.error === undefined) {
    const output = firstLine2(result.stdout);
    return {
      status: "available",
      probed: true,
      ...output !== null ? { output } : {}
    };
  }
  const failure = summarizeProbeFailure(result.stdout, result.stderr, result.error);
  return {
    status: "unavailable",
    probed: true,
    error: result.timedOut ? `probe timed out after ${timeoutMs}ms` : classifyFailure(failure)
  };
}
async function checkModelAvailability(options) {
  const model = options.model.trim();
  if (model.length === 0) {
    throw new Error("model is required");
  }
  const now = options.now ?? (() => new Date);
  const checkedAt = now().toISOString();
  const runner = options.commandRunner ?? defaultToolCommandRunner;
  const cursorAgentBinary = options.cursorAgentBinary ?? "cursor-agent";
  const binary = await readToolVersion("cursor-agent", cursorAgentBinary, {
    now,
    commandRunner: runner,
    ...options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}
  });
  const reachability = options.probe === true ? await runModelProbe(model, cursorAgentBinary, runner, options) : {
    status: "not_checked",
    probed: false
  };
  return {
    model,
    binary,
    auth: {
      status: "unknown",
      detail: "Cursor has no stable local auth-status API; auth was not inferred.",
      provenance: "not_available"
    },
    modelReachability: reachability,
    checkedAt
  };
}

// src/persistence/usage-event-store.ts
import { randomUUID as randomUUID7 } from "crypto";
import { mkdirSync as mkdirSync7 } from "fs";
import { readFile as readFile7, rename as rename3, writeFile as writeFile5 } from "fs/promises";
import { dirname as dirname7, resolve as resolve4 } from "path";
function isUsageEventRecord(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value;
  if (typeof r["eventId"] !== "string" || typeof r["sessionId"] !== "string" || typeof r["model"] !== "string" || typeof r["observedAt"] !== "string" || r["source"] !== "stream_result" || r["provenance"] !== "repository_usage_events") {
    return false;
  }
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens"
  ]) {
    const n = r[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      return false;
    }
  }
  for (const key of [
    "recordId",
    "cursorChatId",
    "workspacePath",
    "workspaceSlug"
  ]) {
    const v = r[key];
    if (v !== undefined && typeof v !== "string") {
      return false;
    }
  }
  return true;
}
async function load5(path) {
  try {
    const raw = await readFile7(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { events: {} };
    }
    const events = parsed["events"];
    if (typeof events !== "object" || events === null) {
      return { events: {} };
    }
    const entries = Object.entries(events).filter(([, v]) => isUsageEventRecord(v));
    return { events: Object.fromEntries(entries) };
  } catch {
    return { events: {} };
  }
}
async function save4(path, data) {
  mkdirSync7(dirname7(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID7().slice(0, 8)}`;
  await writeFile5(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
  await rename3(tmpPath, path);
}
function compareEvents(a, b) {
  const t = a.observedAt.localeCompare(b.observedAt);
  if (t !== 0) {
    return t;
  }
  return a.eventId.localeCompare(b.eventId);
}
function matchesFilters(event, options) {
  if (options === undefined) {
    return true;
  }
  if (options.sessionId !== undefined && options.sessionId.length > 0 && event.sessionId !== options.sessionId && event.recordId !== options.sessionId && event.cursorChatId !== options.sessionId) {
    return false;
  }
  if (options.workspaceSlug !== undefined && options.workspaceSlug.length > 0) {
    if (event.workspaceSlug !== options.workspaceSlug) {
      return false;
    }
  }
  if (options.workspacePath !== undefined && options.workspacePath.length > 0) {
    const abs = resolve4(options.workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const pathMatches = event.workspacePath === abs;
    const slugMatches = event.workspaceSlug === slug;
    if (!pathMatches && !slugMatches) {
      return false;
    }
  }
  if (options.since !== undefined && event.observedAt < options.since) {
    return false;
  }
  if (options.until !== undefined && event.observedAt > options.until) {
    return false;
  }
  return true;
}
function createUsageEventStore(path = usageEventsJsonPath()) {
  const upsertEventsBatch = async (events) => {
    if (events.length === 0) {
      return;
    }
    const data = await load5(path);
    const merged = { ...data.events };
    for (const event of events) {
      merged[event.eventId] = event;
    }
    await save4(path, { events: merged });
  };
  return {
    async listEvents(options) {
      const data = await load5(path);
      return Object.values(data.events).filter((e) => matchesFilters(e, options)).sort(compareEvents);
    },
    upsertEvents: upsertEventsBatch,
    async upsertEvent(event) {
      await upsertEventsBatch([event]);
    }
  };
}

// src/usage/manager.ts
import { resolve as resolve5 } from "path";
var DEFAULT_RECENT_DAYS = 14;
function normalizeRecentDays(value) {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_RECENT_DAYS;
}
function dateKey(value) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}
function recentDateKeys(now, recentDays) {
  const lastDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const firstDay = lastDay - (recentDays - 1) * 86400000;
  const keys = [];
  for (let index = 0;index < recentDays; index += 1) {
    keys.push(new Date(firstDay + index * 86400000).toISOString().slice(0, 10));
  }
  return keys;
}
function makeRecentDays(now, recentDays) {
  return recentDateKeys(now, recentDays).map((date) => ({
    date,
    sessionCount: 0,
    activitySignalCount: 0
  }));
}
function makeUsageRecentDays(now, recentDays) {
  return recentDateKeys(now, recentDays).map((date) => ({
    date,
    tokensByModel: {}
  }));
}
function emptyUsageTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
}
function addUsageTotals(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens
  };
}
function sessionMatchesFilters(record, options) {
  if (options.sessionId !== undefined && options.sessionId.length > 0) {
    const id = options.sessionId;
    if (record.recordId !== id && record.localSessionId !== id && record.cursorChatId !== id) {
      return false;
    }
  }
  if (options.workspacePath !== undefined && options.workspacePath.length > 0) {
    const abs = resolve5(options.workspacePath);
    const slug = workspaceSlugFromPath(abs);
    const recordPath = record.workspacePath !== undefined ? resolve5(record.workspacePath) : undefined;
    if (recordPath !== abs && record.workspaceSlug !== slug) {
      return false;
    }
  }
  return true;
}
function sessionKeys(record) {
  return new Set([record.recordId, record.localSessionId, record.cursorChatId].filter((x) => x !== undefined && x.length > 0));
}
function sessionHasUsageEvent(record, events) {
  const keys = sessionKeys(record);
  return events.some((e) => keys.has(e.sessionId) || e.recordId !== undefined && keys.has(e.recordId) || e.cursorChatId !== undefined && keys.has(e.cursorChatId));
}
function aggregateSession(record, statusCounts, models, dailyByDate) {
  increment(statusCounts, record.status);
  if (record.model !== undefined && record.model.length > 0) {
    models[record.model] = (models[record.model] ?? 0) + 1;
  }
  const firstSessionDate = dateKey(record.createdAt) ?? dateKey(record.updatedAt);
  const activeDates = new Set([dateKey(record.createdAt), dateKey(record.updatedAt)].filter((date) => date !== null));
  for (const activeDate of activeDates) {
    const daily = dailyByDate.get(activeDate);
    if (daily !== undefined) {
      daily.sessionCount += 1;
    }
  }
  return firstSessionDate;
}
function conversationId(record) {
  return record.localSessionId ?? record.cursorChatId;
}
function addOptionalAiTrackingModel(record, models) {
  if (record.model !== undefined) {
    return false;
  }
  const id = conversationId(record);
  if (id === undefined) {
    return false;
  }
  const enrichment = loadAiTrackingEnrichment(id);
  const model = enrichment?.summary?.model;
  if (model === undefined || model.length === 0) {
    return false;
  }
  models[model] = (models[model] ?? 0) + 1;
  return true;
}
function aggregateActivity(activity, activityStatusCounts, dailyByDate) {
  increment(activityStatusCounts, activity.status);
  for (const signal of activity.signals) {
    const signalDate = dateKey(signal.observedAt);
    if (signalDate === null) {
      continue;
    }
    const daily = dailyByDate.get(signalDate);
    if (daily !== undefined) {
      daily.activitySignalCount += 1;
    }
  }
}
function createUsageStatsManager(managerOptions) {
  return {
    async stats(options = {}) {
      const now = options.now ?? new Date;
      const recentDays = normalizeRecentDays(options.recentDays);
      const recentDailyActivity = makeRecentDays(now, recentDays);
      const dailyByDate = new Map(recentDailyActivity.map((daily) => [daily.date, daily]));
      const allSessions = managerOptions.sessions.listSessions(1e5);
      const scopedSessions = allSessions.filter((r) => sessionMatchesFilters(r, options));
      let usageEventsReadFailed = false;
      let usageEvents = [];
      if (managerOptions.usageEvents !== undefined) {
        try {
          usageEvents = await managerOptions.usageEvents.listEvents({
            ...options.sessionId !== undefined && options.sessionId.length > 0 ? { sessionId: options.sessionId } : {},
            ...options.workspacePath !== undefined && options.workspacePath.length > 0 ? { workspacePath: options.workspacePath } : {}
          });
        } catch {
          usageEventsReadFailed = true;
          usageEvents = [];
        }
      }
      const usageRecentMutable = makeUsageRecentDays(now, recentDays);
      const usageDailyByDate = new Map(usageRecentMutable.map((d) => [d.date, d]));
      let usageTokens = emptyUsageTotals();
      const usageTokensByModel = {};
      const usageSessionIds = new Set;
      for (const ev of usageEvents) {
        usageTokens = addUsageTotals(usageTokens, ev);
        usageSessionIds.add(ev.sessionId);
        const prevModel = usageTokensByModel[ev.model] ?? emptyUsageTotals();
        usageTokensByModel[ev.model] = addUsageTotals(prevModel, ev);
        const dk = dateKey(ev.observedAt);
        if (dk !== null) {
          const bucket = usageDailyByDate.get(dk);
          if (bucket !== undefined) {
            bucket.tokensByModel[ev.model] = (bucket.tokensByModel[ev.model] ?? 0) + ev.totalTokens;
          }
        }
      }
      const usageEvidenceCoverage = (() => {
        if (usageEventsReadFailed) {
          return {
            sessionsWithUsageEvents: 0,
            knownSessionsWithoutUsageEvents: 0,
            wrapperStartedSessionsWithoutUsageEvents: 0
          };
        }
        let sessionsWithUsageEvents = 0;
        let wrapperStartedSessionsWithoutUsageEvents = 0;
        for (const record of scopedSessions) {
          const has = sessionHasUsageEvent(record, usageEvents);
          if (has) {
            sessionsWithUsageEvents += 1;
          } else if (record.source === "headless") {
            wrapperStartedSessionsWithoutUsageEvents += 1;
          }
        }
        const knownSessionsWithoutUsageEvents = scopedSessions.length - sessionsWithUsageEvents;
        return {
          sessionsWithUsageEvents,
          knownSessionsWithoutUsageEvents,
          wrapperStartedSessionsWithoutUsageEvents
        };
      })();
      const statusCounts = {};
      const activityStatusCounts = {};
      const models = {};
      let firstSessionDate = null;
      let aiTrackingModelCount = 0;
      for (const record of scopedSessions) {
        const sessionDate = aggregateSession(record, statusCounts, models, dailyByDate);
        if (options.includeAiTracking === true && addOptionalAiTrackingModel(record, models)) {
          aiTrackingModelCount += 1;
        }
        if (sessionDate !== null && (firstSessionDate === null || sessionDate < firstSessionDate)) {
          firstSessionDate = sessionDate;
        }
      }
      const completenessNotes = [];
      if (managerOptions.activity === undefined) {
        completenessNotes.push("activity manager unavailable; activity counts omitted");
      } else {
        const activityManager = managerOptions.activity;
        try {
          const activities = await Promise.all(scopedSessions.map((record) => {
            const id = record.localSessionId ?? record.cursorChatId ?? record.recordId;
            return activityManager.getSessionActivity(id);
          }));
          for (const activity of activities) {
            if (activity !== null) {
              aggregateActivity(activity, activityStatusCounts, dailyByDate);
            }
          }
        } catch {
          completenessNotes.push("activity store unavailable; activity counts may be incomplete");
        }
      }
      if (options.includeAiTracking === true) {
        completenessNotes.push(aiTrackingModelCount > 0 ? `ai-tracking enrichment added ${aiTrackingModelCount} model count(s)` : "ai-tracking enrichment requested but no additional model rows were available");
      } else {
        completenessNotes.push("ai-tracking enrichment was not requested");
      }
      if (managerOptions.usageEvents === undefined) {
        completenessNotes.push("usage event store unavailable; token totals omit persisted wrapper captures");
      } else if (usageEventsReadFailed) {
        completenessNotes.push("usage event store read failed; token totals and usage coverage omitted for this run");
      } else if (usageEvidenceCoverage.wrapperStartedSessionsWithoutUsageEvents > 0) {
        completenessNotes.push(`${usageEvidenceCoverage.wrapperStartedSessionsWithoutUsageEvents} headless session(s) in scope have no persisted usage events yet`);
      }
      const usageRecentDailyActivity = usageRecentMutable.map((d) => ({
        date: d.date,
        tokensByModel: { ...d.tokensByModel }
      }));
      return {
        totalSessions: scopedSessions.length,
        statusCounts,
        activityStatusCounts,
        firstSessionDate,
        lastComputedDate: dateKey(now) ?? now.toISOString(),
        models,
        recentDailyActivity,
        completenessNotes,
        usageTokens,
        usageSessionsObserved: usageSessionIds.size,
        usageTokensByModel,
        usageRecentDailyActivity,
        usageEvidenceCoverage,
        usageProvenance: managerOptions.usageEvents === undefined ? "unavailable" : "repository_usage_events"
      };
    }
  };
}

// src/sdk/tool-registry.ts
class ToolRegistryError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "ToolRegistryError";
  }
}
function normalizeToolName(name) {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new ToolRegistryError("tool name is required", "invalid_name");
  }
  return normalized;
}
function tool(config) {
  const name = normalizeToolName(config.name);
  return {
    name,
    ...config.description !== undefined ? { description: config.description } : {},
    ...config.inputSchema !== undefined ? { inputSchema: config.inputSchema } : {},
    async run(input, context) {
      return await config.run(input, context);
    }
  };
}

class ToolRegistry {
  tools = new Map;
  register(registeredTool) {
    const name = normalizeToolName(registeredTool.name);
    if (this.tools.has(name)) {
      throw new ToolRegistryError(`tool already registered: ${name}`, "duplicate_tool");
    }
    this.tools.set(name, {
      ...registeredTool,
      name
    });
  }
  get(name) {
    const normalized = normalizeToolName(name);
    return this.tools.get(normalized) ?? null;
  }
  list() {
    return [...this.tools.values()].map((registeredTool) => ({
      name: registeredTool.name,
      ...registeredTool.description !== undefined ? { description: registeredTool.description } : {},
      ...registeredTool.inputSchema !== undefined ? { inputSchema: registeredTool.inputSchema } : {}
    })).sort((left, right) => left.name.localeCompare(right.name));
  }
  async run(name, input, context) {
    const registered = this.get(name);
    if (registered === null) {
      throw new ToolRegistryError(`tool not found: ${name}`, "not_found");
    }
    return await registered.run(input, context);
  }
}
function createToolRegistry(tools = []) {
  const registry = new ToolRegistry;
  for (const registeredTool of tools) {
    registry.register(registeredTool);
  }
  return registry;
}

// src/sdk/helpers.ts
function dataPath2(stateRoot, name) {
  return join5(stateRoot, name);
}
function createToolHelperSdk(options = {}) {
  const stateRoot = options.stateRoot ?? getDataDir();
  const cursorHome = options.cursorHome ?? getCursorHome();
  const registry = options.registry ?? createToolRegistry();
  return {
    registry,
    versions(versionOptions) {
      return getToolVersions({
        ...options.cursorBinary !== undefined ? { cursorAgentBinary: options.cursorBinary } : {},
        ...options.now !== undefined ? { now: options.now } : {},
        ...options.commandRunner !== undefined ? { commandRunner: options.commandRunner } : {},
        ...versionOptions
      });
    },
    checkModel(modelOptions) {
      return checkModelAvailability({
        ...options.cursorBinary !== undefined ? { cursorAgentBinary: options.cursorBinary } : {},
        ...options.now !== undefined ? { now: options.now } : {},
        ...options.commandRunner !== undefined ? { commandRunner: options.commandRunner } : {},
        ...modelOptions
      });
    },
    async usageStats(usageOptions) {
      const repository = options.sessionRepository ?? new SessionIndexRepository(dataPath2(stateRoot, "state.db"), {
        cursorProjectsRoot: join5(cursorHome, "projects")
      });
      const shouldClose = options.sessionRepository === undefined;
      try {
        await repository.importTranscriptsFromFilesystem();
        const activity = options.activityManager ?? createActivityManager({
          sessions: repository,
          store: createActivityStore(dataPath2(stateRoot, "activity-signals.json"))
        });
        const usageEvents = options.usageEventStore ?? createUsageEventStore(dataPath2(stateRoot, "usage-events.json"));
        return await createUsageStatsManager({
          sessions: repository,
          activity,
          usageEvents
        }).stats({
          ...options.now !== undefined && usageOptions?.now === undefined ? { now: options.now() } : {},
          ...usageOptions
        });
      } finally {
        if (shouldClose) {
          repository.close();
        }
      }
    }
  };
}

// src/sdk/index.ts
function createCursorAgentSdk(options = {}) {
  const facades = createDomainFacades(options);
  return {
    ...facades,
    runner: createAgentRunnerFacade({
      ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {}
    }),
    tools: createToolHelperSdk(options)
  };
}

// src/types/server-event.ts
var eventSequence = 0;
function createServerEventEnvelope(event, payload, options = {}) {
  const emittedAt = options.emittedAt ?? new Date().toISOString();
  eventSequence = (eventSequence + 1) % Number.MAX_SAFE_INTEGER;
  return {
    id: options.id ?? `${Date.now().toString(36)}-${eventSequence.toString(36)}`,
    event,
    emittedAt,
    payload
  };
}
function normalizeServerEventStreamOptions(options = {}) {
  return {
    replay: options.replay ?? "latest",
    ...options.lastEventId !== undefined ? { lastEventId: options.lastEventId } : {},
    heartbeatMs: options.heartbeatMs ?? 15000,
    ...options.startOffset !== undefined ? { startOffset: options.startOffset } : {}
  };
}

// src/cursor/skill-catalog.ts
import { existsSync as existsSync2 } from "fs";
import { readFile as readFile8, readdir as readdir2 } from "fs/promises";
import { basename as basename2, dirname as dirname8, join as join6 } from "path";
function skillRoots(opts) {
  const cursor = getCursorHome();
  const out = [
    { root: join6(cursor, "skills-cursor"), scope: "builtin" },
    { root: join6(cursor, "skills"), scope: "user" }
  ];
  if (opts.projectRoot !== undefined && opts.projectRoot.length > 0) {
    out.push({
      root: join6(opts.projectRoot, ".cursor/skills"),
      scope: "project"
    });
  }
  return out;
}
async function listSkillFilesUnder(root) {
  if (!existsSync2(root)) {
    return [];
  }
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join6(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(p);
      } else if (ent.isFile() && ent.name === "SKILL.md") {
        out.push(p);
      }
    }
  };
  await walk(root);
  return out;
}
function parseSkillFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { disableModelInvocation: false };
  }
  let end = -1;
  for (let i = 1;i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { disableModelInvocation: false };
  }
  const fm = lines.slice(1, end).join(`
`);
  let name;
  let description;
  let disableModelInvocation = false;
  for (const raw of fm.split(`
`)) {
    const line = raw.trim();
    const mName = /^name:\s*(.+)$/.exec(line);
    if (mName !== null) {
      name = stripQuotes(mName[1]?.trim() ?? "");
    }
    const mDesc = /^description:\s*(.+)$/.exec(line);
    if (mDesc !== null) {
      description = stripQuotes(mDesc[1]?.trim() ?? "");
    }
    const mDis = /^disableModelInvocation:\s*(true|false)\s*$/i.exec(line);
    if (mDis !== null) {
      disableModelInvocation = mDis[1]?.toLowerCase() === "true";
    }
  }
  return {
    ...name !== undefined && name.length > 0 ? { name } : {},
    ...description !== undefined && description.length > 0 ? { description } : {},
    disableModelInvocation
  };
}
function stripQuotes(s) {
  if (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}
function fallbackName(skillPath) {
  const parent = basename2(dirname8(skillPath));
  if (parent.length > 0) {
    return parent;
  }
  return basename2(skillPath, ".md");
}
async function listSkillRecords(opts = {}) {
  const records = [];
  for (const { root, scope } of skillRoots(opts)) {
    const files = await listSkillFilesUnder(root);
    for (const path of files) {
      let text;
      try {
        text = await readFile8(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkillFrontmatter(text);
      const name = parsed.name !== undefined && parsed.name.length > 0 ? parsed.name : fallbackName(path);
      records.push({
        name,
        scope,
        path,
        disableModelInvocation: parsed.disableModelInvocation,
        ...parsed.description !== undefined && parsed.description.length > 0 ? { description: parsed.description } : {}
      });
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}
async function findSkillByName(name, opts = {}) {
  const rows = await listSkillRecords(opts);
  return rows.find((r) => r.name === name || basename2(dirname8(r.path)) === name || basename2(dirname8(r.path)).toLowerCase() === name.toLowerCase());
}

// src/compat/commands.ts
var SESSION_CANCEL_LIMITATION = {
  code: "cursor-process-supervision-pending",
  message: "Cursor process cancellation requires daemon/process-supervisor state and may not be available for imported sessions.",
  cursorSpecific: true
};
var BEST_EFFORT_STREAM_LIMITATION = {
  code: "cursor-stream-best-effort",
  message: "Cursor-local streams are derived from local files or progress snapshots and are not durable server-side event streams.",
  cursorSpecific: true
};
var FILE_INTELLIGENCE_LIMITATION = {
  code: "cursor-ai-tracking-sparse",
  message: "File intelligence depends on Cursor ai-tracking availability and may be sparse.",
  cursorSpecific: true
};
var SKILL_DISCOVERY_LIMITATION = {
  code: "cursor-skills-discovery-only",
  message: "Cursor-managed skills are discoverable but must not be mutated.",
  cursorSpecific: true
};
var NO_CURSOR_PATCH_HISTORY = {
  code: "cursor-no-patch-history",
  message: "Cursor has no confirmed local source equivalent to Codex patch history.",
  cursorSpecific: true
};
var LOCAL_OPERATOR_ONLY = {
  code: "local-operator-only",
  message: "Token lifecycle commands are local operator commands and are not exposed through the compatibility bridge.",
  cursorSpecific: false
};
var SESSION_FORK_UNPROVEN = {
  code: "cursor-session-fork-unproven",
  message: "Cursor-local replay or fork behavior is not proven for this bridge.",
  cursorSpecific: true
};
var capabilities = [
  {
    name: "version.get",
    kinds: ["query"],
    status: "supported",
    permission: "none",
    limitations: []
  },
  {
    name: "session.list",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "session.show",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "session.search",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "session.searchTranscript",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "session.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: []
  },
  {
    name: "session.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: []
  },
  {
    name: "session.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "session:create",
    limitations: []
  },
  {
    name: "session.cancel",
    kinds: ["mutation"],
    status: "degraded",
    permission: "session:cancel",
    limitations: [SESSION_CANCEL_LIMITATION]
  },
  {
    name: "session.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "session:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION]
  },
  {
    name: "session.fork",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "session:create",
    limitations: [SESSION_FORK_UNPROVEN]
  },
  {
    name: "group.list",
    kinds: ["query"],
    status: "supported",
    permission: "group:read",
    limitations: []
  },
  {
    name: "group.show",
    kinds: ["query"],
    status: "supported",
    permission: "group:read",
    limitations: []
  },
  {
    name: "group.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.remove",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.pause",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:write",
    limitations: []
  },
  {
    name: "group.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "group:run",
    limitations: []
  },
  {
    name: "group.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "group:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION]
  },
  {
    name: "queue.list",
    kinds: ["query"],
    status: "supported",
    permission: "queue:read",
    limitations: []
  },
  {
    name: "queue.show",
    kinds: ["query"],
    status: "supported",
    permission: "queue:read",
    limitations: []
  },
  {
    name: "queue.create",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.update",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.remove",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.move",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.mode",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.pause",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.resume",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:write",
    limitations: []
  },
  {
    name: "queue.run",
    kinds: ["mutation"],
    status: "supported",
    permission: "queue:run",
    limitations: []
  },
  {
    name: "queue.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "queue:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION]
  },
  {
    name: "bookmark.list",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: []
  },
  {
    name: "bookmark.get",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: []
  },
  {
    name: "bookmark.search",
    kinds: ["query"],
    status: "supported",
    permission: "bookmark:read",
    limitations: []
  },
  {
    name: "bookmark.add",
    kinds: ["mutation"],
    status: "supported",
    permission: "bookmark:write",
    limitations: []
  },
  {
    name: "bookmark.delete",
    kinds: ["mutation"],
    status: "supported",
    permission: "bookmark:write",
    limitations: []
  },
  {
    name: "files.list",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION]
  },
  {
    name: "files.find",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION]
  },
  {
    name: "files.snapshots",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION]
  },
  {
    name: "files.deleted",
    kinds: ["query"],
    status: "degraded",
    permission: "files:read",
    limitations: [FILE_INTELLIGENCE_LIMITATION]
  },
  {
    name: "files.patches",
    kinds: ["query"],
    status: "unsupported",
    permission: "files:read",
    limitations: [NO_CURSOR_PATCH_HISTORY]
  },
  {
    name: "files.rebuild",
    kinds: ["mutation"],
    status: "supported",
    permission: "files:write",
    limitations: []
  },
  {
    name: "activity.list",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "activity.show",
    kinds: ["query"],
    status: "supported",
    permission: "session:read",
    limitations: []
  },
  {
    name: "activity.watch",
    kinds: ["subscription"],
    status: "degraded",
    permission: "session:read",
    limitations: [BEST_EFFORT_STREAM_LIMITATION]
  },
  {
    name: "skill.list",
    kinds: ["query"],
    status: "degraded",
    permission: "server:read",
    limitations: [SKILL_DISCOVERY_LIMITATION]
  },
  {
    name: "token.create",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY]
  },
  {
    name: "token.list",
    kinds: ["query"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY]
  },
  {
    name: "token.revoke",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY]
  },
  {
    name: "token.rotate",
    kinds: ["mutation"],
    status: "unsupported",
    permission: "server:read",
    limitations: [LOCAL_OPERATOR_ONLY]
  }
];
var COMPAT_COMMAND_CAPABILITIES = capabilities;
var CAPABILITY_BY_NAME = new Map(capabilities.map((capability) => [capability.name, capability]));
function getCompatCommandCapability(name) {
  return CAPABILITY_BY_NAME.get(name);
}
function decideCompatCommand(name, kind) {
  const capability = getCompatCommandCapability(name);
  if (capability === undefined) {
    return { ok: false, reason: "unknown command" };
  }
  if (!capability.kinds.includes(kind)) {
    return {
      ok: false,
      capability,
      reason: `command ${name} does not support ${kind}`
    };
  }
  if (capability.status === "unsupported") {
    return {
      ok: false,
      capability,
      reason: `command ${name} is unsupported in compatibility mode`
    };
  }
  return { ok: true, capability };
}
function preferredCompatOperationKind(name) {
  return getCompatCommandCapability(name)?.kinds[0];
}

// src/types/auth-token.ts
var AUTH_PERMISSIONS = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*",
  "files:*",
  "server:read",
  "server:admin"
];
var DEFAULT_AUTH_PERMISSIONS = [
  "session:read"
];
var AUTH_PERMISSION_SET = new Set(AUTH_PERMISSIONS);
function isAuthPermission(value) {
  return AUTH_PERMISSION_SET.has(value);
}
function normalizeAuthPermissions(values) {
  const unique = new Set;
  for (const value of values) {
    const trimmed = value.trim();
    if (isAuthPermission(trimmed)) {
      unique.add(trimmed);
    }
  }
  return [...unique];
}
function invalidAuthPermissions(input) {
  const invalid = [];
  for (const value of input) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || !isAuthPermission(trimmed)) {
      invalid.push(value);
    }
  }
  return invalid;
}
function hasAuthPermission(granted, required) {
  if (granted.includes(required)) {
    return true;
  }
  if (required.startsWith("group:") && granted.includes("group:*")) {
    return true;
  }
  if (required.startsWith("queue:") && granted.includes("queue:*")) {
    return true;
  }
  if (required.startsWith("bookmark:") && granted.includes("bookmark:*")) {
    return true;
  }
  if (required.startsWith("files:") && granted.includes("files:*")) {
    return true;
  }
  if (required === "server:read" && (granted.includes("server:read") || granted.includes("server:admin"))) {
    return true;
  }
  return false;
}
// src/auth/token-manager.ts
import {
  createHash,
  randomBytes,
  randomUUID as randomUUID9,
  timingSafeEqual
} from "crypto";

// src/persistence/token-store.ts
import { constants } from "fs";
import { mkdir, readFile as readFile9, rename as rename4, writeFile as writeFile6 } from "fs/promises";
import { randomUUID as randomUUID8 } from "crypto";
import { join as join7 } from "path";
var TOKENS_FILE = "tokens.json";
function tokenFilePath(configDir) {
  return join7(configDir, TOKENS_FILE);
}
function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function createFileTokenStore(options = {}) {
  const configDir = options.configDir ?? getConfigDir();
  const path = tokenFilePath(configDir);
  return {
    async load() {
      try {
        const raw = await readFile9(path, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.tokens)) {
          return { tokens: [] };
        }
        return { tokens: parsed.tokens };
      } catch (error) {
        if (isMissingFile(error)) {
          return { tokens: [] };
        }
        throw error;
      }
    },
    async save(config) {
      await mkdir(configDir, { recursive: true });
      const tmpPath = `${path}.tmp.${randomUUID8()}`;
      const json = `${JSON.stringify(config, null, 2)}
`;
      await writeFile6(tmpPath, json, {
        encoding: "utf8",
        mode: constants.S_IRUSR | constants.S_IWUSR
      });
      await rename4(tmpPath, path);
    }
  };
}

// src/auth/token-manager.ts
class TokenInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "TokenInputError";
  }
}

class TokenNotFoundError extends Error {
  constructor(id) {
    super(`token not found: ${id}`);
    this.name = "TokenNotFoundError";
  }
}
function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}
function parseStoredToken(rawToken) {
  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const id = parts[0];
  const secret = parts[1];
  if (id === undefined || secret === undefined || id.length === 0 || secret.length === 0) {
    return null;
  }
  return { id, secret };
}
function toMetadata(record) {
  return {
    id: record.id,
    name: record.name,
    permissions: [...record.permissions],
    createdAt: record.createdAt,
    ...record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {},
    ...record.revokedAt !== undefined ? { revokedAt: record.revokedAt } : {}
  };
}
function isExpired(expiresAt) {
  if (expiresAt === undefined) {
    return false;
  }
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= Date.now();
}
function validatePermissions(permissions) {
  if (permissions === undefined) {
    return [...DEFAULT_AUTH_PERMISSIONS];
  }
  const invalid = invalidAuthPermissions(permissions);
  if (invalid.length > 0) {
    throw new TokenInputError(`invalid permissions: ${invalid.join(",")}`);
  }
  const normalized = normalizeAuthPermissions(permissions);
  if (normalized.length === 0) {
    throw new TokenInputError("at least one permission is required");
  }
  return normalized;
}
function validateExpiresAt(expiresAt) {
  if (expiresAt === undefined) {
    return;
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new TokenInputError("expiresAt must be a valid ISO 8601 timestamp");
  }
  return new Date(expiresAt).toISOString();
}
function createRawToken(id) {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${id}.${secret}`, secret };
}
function replaceToken(config, replacement) {
  return {
    tokens: config.tokens.map((token) => token.id === replacement.id ? replacement : token)
  };
}
function activateRecord(record) {
  return {
    id: record.id,
    name: record.name,
    permissions: record.permissions,
    createdAt: record.createdAt,
    ...record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {},
    tokenHash: record.tokenHash
  };
}
function createTokenManager(options = {}) {
  const store = options.store ?? createFileTokenStore(options.configDir === undefined ? {} : { configDir: options.configDir });
  return {
    async createToken(input) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new TokenInputError("name is required");
      }
      const permissions = validatePermissions(input.permissions);
      const expiresAt = validateExpiresAt(input.expiresAt);
      const id = randomUUID9();
      const raw = createRawToken(id);
      const createdAt = new Date().toISOString();
      const record = {
        id,
        name,
        permissions,
        createdAt,
        ...expiresAt !== undefined ? { expiresAt } : {},
        tokenHash: hashSecret(raw.secret)
      };
      const config = await store.load();
      await store.save({ tokens: [...config.tokens, record] });
      return { token: raw.token, metadata: toMetadata(record) };
    },
    async listTokens() {
      const config = await store.load();
      return config.tokens.map(toMetadata).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async revokeToken(id) {
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === id);
      if (record === undefined) {
        throw new TokenNotFoundError(id);
      }
      if (record.revokedAt !== undefined) {
        return toMetadata(record);
      }
      const replacement = {
        ...record,
        revokedAt: new Date().toISOString()
      };
      await store.save(replaceToken(config, replacement));
      return toMetadata(replacement);
    },
    async rotateToken(id) {
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === id);
      if (record === undefined) {
        throw new TokenNotFoundError(id);
      }
      const raw = createRawToken(id);
      const replacement = {
        ...activateRecord(record),
        tokenHash: hashSecret(raw.secret)
      };
      await store.save(replaceToken(config, replacement));
      return { token: raw.token, metadata: toMetadata(replacement) };
    },
    async verifyToken(rawToken) {
      const parsed = parseStoredToken(rawToken);
      if (parsed === null) {
        return { ok: false };
      }
      const config = await store.load();
      const record = config.tokens.find((token) => token.id === parsed.id);
      if (record === undefined || record.revokedAt !== undefined || isExpired(record.expiresAt)) {
        return { ok: false };
      }
      const encoder = new TextEncoder;
      const submitted = encoder.encode(hashSecret(parsed.secret));
      const expected = encoder.encode(record.tokenHash);
      if (submitted.length !== expected.length) {
        return { ok: false };
      }
      if (!timingSafeEqual(submitted, expected)) {
        return { ok: false };
      }
      return { ok: true, metadata: toMetadata(record) };
    }
  };
}
// src/compat/permissions.ts
function permissionForIntent(intent) {
  switch (intent) {
    case undefined:
    case "none":
      return;
    case "server:read":
      return "server:read";
    case "session:read":
      return "session:read";
    case "session:create":
      return "session:create";
    case "session:cancel":
      return "session:cancel";
    case "group:read":
    case "group:write":
    case "group:run":
      return "group:*";
    case "queue:read":
    case "queue:write":
    case "queue:run":
      return "queue:*";
    case "bookmark:read":
    case "bookmark:write":
      return "bookmark:*";
    case "files:read":
    case "files:write":
      return "files:*";
  }
}
function compatAuthPermissionForCapability(capability) {
  return permissionForIntent(capability.permission);
}
function authorizeCompatCommand(capability, context) {
  const required = compatAuthPermissionForCapability(capability);
  if (required === undefined || context.mode === "disabled") {
    return { ok: true };
  }
  if (context.tokenPermissions === undefined) {
    if (context.mode === "optional") {
      return { ok: true };
    }
    return {
      ok: false,
      status: 401,
      required,
      reason: "missing bearer token"
    };
  }
  if (!hasAuthPermission(context.tokenPermissions, required)) {
    return {
      ok: false,
      status: 403,
      required,
      reason: `missing permission: ${required}`
    };
  }
  return { ok: true };
}

// src/compat/dispatcher.ts
class CompatCommandError extends Error {
  details;
  statusCode;
  constructor(message, details, statusCode = 400) {
    super(message);
    this.name = "CompatCommandError";
    this.details = details;
    this.statusCode = statusCode;
  }
}
function objectParam(params) {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("params must be an object");
  }
  return params;
}
function stringParam(params, key) {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberParam(params, key) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function integerParam(params, key, command) {
  const value = numberParam(params, key);
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`${command}: ${key} must be a non-negative integer`);
  }
  return value;
}
function positiveLimit(params) {
  const limit = numberParam(params, "limit");
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    return 100;
  }
  return limit;
}
function requiredString(params, key, command) {
  const value = stringParam(params, key);
  if (value === undefined) {
    throw new Error(`${command}: ${key} is required`);
  }
  return value;
}
function queueItemStatusParam(params, key, command) {
  const value = stringParam(params, key);
  if (value === undefined) {
    return;
  }
  if (value === "pending" || value === "completed" || value === "failed" || value === "skipped") {
    return value;
  }
  throw new Error(`${command}: ${key} must be pending, completed, failed, or skipped`);
}
function queueItemModeParam(params, key, command) {
  const value = stringParam(params, key);
  if (value === "auto" || value === "manual") {
    return value;
  }
  throw new Error(`${command}: ${key} must be auto or manual`);
}
function runRequest(input) {
  return {
    prompt: input.prompt,
    ...input.cwd !== undefined ? { cwd: input.cwd } : {},
    ...input.model !== undefined ? { model: input.model } : {}
  };
}
function resumeRequest(input) {
  return {
    sessionId: input.sessionId,
    ...input.prompt !== undefined ? { prompt: input.prompt } : {},
    ...input.cwd !== undefined ? { cwd: input.cwd } : {}
  };
}
function commandError(request, reason, statusCode, capability, requiredPermission) {
  return new CompatCommandError(reason, {
    command: request.name,
    operationKind: request.kind,
    ...capability !== undefined ? { status: capability.status } : {},
    reason,
    cursorLimitation: capability?.limitations.some((limitation) => limitation.cursorSpecific) ?? false,
    provenance: "compat-bridge",
    ...capability !== undefined && capability.limitations.length > 0 ? { limitations: capability.limitations } : {},
    ...requiredPermission !== undefined ? { requiredPermission } : {}
  }, statusCode);
}
async function collectRun(agent) {
  return await agent.waitForCompletion();
}
async function* oneValue(value) {
  yield value;
}
function streamOptions(params) {
  const startOffset = numberParam(params, "startOffset");
  return {
    replay: "latest",
    heartbeatMs: 15000,
    ...startOffset !== undefined ? { startOffset } : {}
  };
}
function streamSignal(request) {
  return request.context.abortSignal ?? new AbortController().signal;
}
function createCompatCommandDispatcher(options = {}) {
  const sdk = options.sdk ?? createCursorAgentSdk();
  return {
    capabilities: COMPAT_COMMAND_CAPABILITIES,
    async execute(request) {
      const decision = decideCompatCommand(request.name, request.kind);
      if (!decision.ok) {
        throw commandError(request, decision.reason ?? "command cannot be executed", decision.capability?.status === "unsupported" ? 501 : 400, decision.capability);
      }
      const capability = decision.capability;
      if (capability === undefined) {
        throw commandError(request, "unknown command", 400);
      }
      const auth = authorizeCompatCommand(capability, request.context.auth ?? options.auth ?? { mode: "disabled" });
      if (!auth.ok) {
        throw commandError(request, auth.reason ?? "not authorized", auth.status ?? 403, capability, auth.required);
      }
      const params = objectParam(request.params);
      try {
        switch (request.name) {
          case "version.get":
            return {
              kind: "single",
              value: {
                packageName: "cursor-cli-agent",
                packageVersion: package_default.version,
                capabilities: COMPAT_COMMAND_CAPABILITIES,
                provenance: "compat-bridge"
              }
            };
          case "session.list":
            return {
              kind: "single",
              value: {
                sessions: await sdk.sessions.list({
                  limit: positiveLimit(params)
                }),
                provenance: "index"
              }
            };
          case "session.show":
            return {
              kind: "single",
              value: {
                session: await sdk.sessions.get(requiredString(params, "id", request.name)),
                provenance: "index"
              }
            };
          case "session.search":
            return {
              kind: "single",
              value: await sdk.search.sessions({
                query: requiredString(params, "query", request.name),
                limit: positiveLimit(params),
                offset: numberParam(params, "offset") ?? 0
              })
            };
          case "session.searchTranscript":
            return {
              kind: "single",
              value: await sdk.search.transcripts({
                query: requiredString(params, "query", request.name),
                limit: positiveLimit(params),
                offset: numberParam(params, "offset") ?? 0
              })
            };
          case "session.run":
            return {
              kind: "single",
              value: await collectRun(sdk.runner.start(runRequest({
                prompt: requiredString(params, "prompt", request.name),
                cwd: request.context.workspace,
                model: stringParam(params, "model")
              })))
            };
          case "session.resume":
            return {
              kind: "single",
              value: await collectRun(sdk.runner.resume(resumeRequest({
                sessionId: requiredString(params, "id", request.name),
                prompt: stringParam(params, "prompt"),
                cwd: request.context.workspace
              })))
            };
          case "session.create":
            return {
              kind: "single",
              value: await collectRun(sdk.runner.start(runRequest({
                prompt: requiredString(params, "prompt", request.name),
                cwd: request.context.workspace
              })))
            };
          case "session.cancel":
            throw commandError(request, "session cancellation is degraded until daemon process supervision owns active runs", 409, capability);
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
                  provenance: "compat-bridge"
                })
              };
            }
            return {
              kind: "stream",
              values: streams.watchSession(id, streamOptions(params), streamSignal(request))
            };
          }
          case "group.list":
            return {
              kind: "single",
              value: {
                groups: await sdk.groups.list(),
                provenance: "compat-bridge"
              }
            };
          case "group.show":
            return {
              kind: "single",
              value: {
                group: await sdk.groups.get(requiredString(params, "name", request.name)),
                provenance: "compat-bridge"
              }
            };
          case "group.create": {
            const group = await sdk.groups.create(requiredString(params, "name", request.name));
            const workspaces = params["workspaces"];
            if (Array.isArray(workspaces)) {
              let current = group;
              for (const workspace of workspaces) {
                if (typeof workspace === "string" && workspace.length > 0) {
                  current = await sdk.groups.addWorkspace(group.name, workspace);
                }
              }
              return { kind: "single", value: current };
            }
            return { kind: "single", value: group };
          }
          case "group.add":
            return {
              kind: "single",
              value: await sdk.groups.addWorkspace(requiredString(params, "name", request.name), requiredString(params, "workspace", request.name))
            };
          case "group.remove":
            return {
              kind: "single",
              value: await sdk.groups.removeWorkspace(requiredString(params, "name", request.name), requiredString(params, "workspace", request.name))
            };
          case "group.pause":
            return {
              kind: "single",
              value: await sdk.groups.pause(requiredString(params, "name", request.name))
            };
          case "group.resume":
            return {
              kind: "single",
              value: await sdk.groups.resume(requiredString(params, "name", request.name))
            };
          case "group.delete":
            return {
              kind: "single",
              value: await sdk.groups.delete(requiredString(params, "name", request.name))
            };
          case "group.run":
            return {
              kind: "single",
              value: await collectRun(sdk.runner.start(runRequest({
                prompt: requiredString(params, "prompt", request.name),
                cwd: stringParam(params, "workspace") ?? request.context.workspace
              })))
            };
          case "group.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchGroup(requiredString(params, "name", request.name), streamOptions(params), streamSignal(request))
              };
            }
            return {
              kind: "stream",
              values: oneValue(await sdk.groups.progress(requiredString(params, "name", request.name)))
            };
          case "queue.list":
            return {
              kind: "single",
              value: {
                queues: await sdk.queues.list(),
                provenance: "compat-bridge"
              }
            };
          case "queue.show":
            return {
              kind: "single",
              value: {
                queue: await sdk.queues.get(requiredString(params, "name", request.name)),
                provenance: "compat-bridge"
              }
            };
          case "queue.create":
            return {
              kind: "single",
              value: await sdk.queues.create(requiredString(params, "name", request.name), stringParam(params, "workspace") ?? request.context.workspace ?? process.cwd())
            };
          case "queue.add":
            return {
              kind: "single",
              value: await sdk.queues.addItem(requiredString(params, "name", request.name), requiredString(params, "prompt", request.name))
            };
          case "queue.remove":
            return {
              kind: "single",
              value: await sdk.queues.removeItem(requiredString(params, "name", request.name), requiredString(params, "item", request.name))
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
              ...prompt !== undefined ? { prompt } : {},
              ...status !== undefined ? { status } : {}
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
            if (existing.items.length === 0 || from >= existing.items.length || to >= existing.items.length) {
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
              value: await sdk.queues.pause(requiredString(params, "name", request.name))
            };
          case "queue.resume":
            return {
              kind: "single",
              value: await sdk.queues.resume(requiredString(params, "name", request.name))
            };
          case "queue.delete":
            return {
              kind: "single",
              value: await sdk.queues.delete(requiredString(params, "name", request.name))
            };
          case "queue.run":
            return {
              kind: "single",
              value: await collectRun(sdk.runner.start(runRequest({
                prompt: requiredString(params, "prompt", request.name),
                cwd: stringParam(params, "workspace") ?? request.context.workspace
              })))
            };
          case "queue.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchQueue(requiredString(params, "name", request.name), streamOptions(params), streamSignal(request))
              };
            }
            return {
              kind: "stream",
              values: oneValue(await sdk.queues.progress(requiredString(params, "name", request.name)))
            };
          case "bookmark.list":
            return {
              kind: "single",
              value: {
                bookmarks: await sdk.bookmarks.list(),
                provenance: "compat-bridge"
              }
            };
          case "bookmark.get":
            return {
              kind: "single",
              value: {
                bookmark: await sdk.bookmarks.show(requiredString(params, "id", request.name))
              }
            };
          case "bookmark.search":
            return {
              kind: "single",
              value: await sdk.bookmarks.search(requiredString(params, "query", request.name), { limit: positiveLimit(params) })
            };
          case "bookmark.add":
            return {
              kind: "single",
              value: await sdk.bookmarks.add({
                type: "session",
                sessionId: requiredString(params, "sessionId", request.name),
                name: requiredString(params, "name", request.name)
              })
            };
          case "bookmark.delete":
            return {
              kind: "single",
              value: {
                deleted: await sdk.bookmarks.delete(requiredString(params, "id", request.name))
              }
            };
          case "files.list":
            return {
              kind: "single",
              value: await sdk.files.list(requiredString(params, "sessionId", request.name))
            };
          case "files.find":
            return {
              kind: "single",
              value: await sdk.files.find(requiredString(params, "path", request.name))
            };
          case "files.snapshots":
            return {
              kind: "single",
              value: await sdk.files.snapshots(requiredString(params, "sessionId", request.name))
            };
          case "files.deleted":
            return {
              kind: "single",
              value: await sdk.files.deleted(requiredString(params, "sessionId", request.name))
            };
          case "files.rebuild":
            return { kind: "single", value: await sdk.files.rebuild() };
          case "activity.list":
            return {
              kind: "single",
              value: {
                activity: await sdk.activity.list({
                  limit: positiveLimit(params)
                }),
                provenance: "compat-bridge"
              }
            };
          case "activity.show":
            return {
              kind: "single",
              value: await sdk.activity.get(requiredString(params, "id", request.name))
            };
          case "activity.watch":
            if (options.streams !== undefined) {
              return {
                kind: "stream",
                values: options.streams.watchActivity(stringParam(params, "id"), streamOptions(params), streamSignal(request))
              };
            }
            return {
              kind: "stream",
              values: oneValue(await sdk.activity.get(requiredString(params, "id", request.name)))
            };
          case "skill.list":
            return {
              kind: "single",
              value: {
                skills: await listSkillRecords({
                  projectRoot: request.context.workspace ?? process.cwd()
                }),
                limitations: capability.limitations,
                provenance: "compat-bridge"
              }
            };
          default:
            throw commandError(request, `command ${request.name} is not implemented by the compatibility dispatcher`, 501, capability);
        }
      } catch (error) {
        if (error instanceof CompatCommandError) {
          throw error;
        }
        throw commandError(request, error instanceof Error ? error.message : "compat command failed", 400, capability);
      }
    }
  };
}
function createDefaultCompatCommandDispatcher(context = {}) {
  const sdk = createCursorAgentSdk({
    ...context.dataDir !== undefined ? { stateRoot: context.dataDir } : {},
    ...context.cursorHome !== undefined ? { cursorHome: context.cursorHome } : {}
  });
  return createCompatCommandDispatcher({
    sdk,
    ...context.auth !== undefined ? { auth: context.auth } : {}
  });
}

// src/server/http-errors.ts
import { randomUUID as randomUUID10 } from "crypto";
var STATUS_BY_CODE = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500
};

class HttpError extends Error {
  code;
  details;
  constructor(code, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.details = options.details;
  }
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function errorResponse(error) {
  const envelope = {
    error: {
      code: error.code,
      message: error.message,
      ...error.details !== undefined ? { details: error.details } : {},
      requestId: randomUUID10()
    }
  };
  const headers = {
    "content-type": "application/json; charset=utf-8"
  };
  if (error.code === "UNAUTHORIZED") {
    headers["www-authenticate"] = "Bearer";
  }
  return new Response(JSON.stringify(envelope), {
    status: STATUS_BY_CODE[error.code],
    headers
  });
}
function toHttpError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError("INTERNAL_ERROR", "internal server error");
}

// src/server/auth.ts
function parseBearerToken(request) {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}
function contextFor(config, token) {
  return {
    mode: config.authMode,
    ...token !== undefined ? { token } : {}
  };
}
async function authenticateRequest(request, config) {
  if (config.authMode === "disabled") {
    return contextFor(config, undefined);
  }
  const bearer = parseBearerToken(request);
  if (bearer === undefined) {
    if (config.authMode === "optional") {
      return contextFor(config, undefined);
    }
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
  const result = await createTokenManager({
    configDir: config.configDir
  }).verifyToken(bearer);
  if (!result.ok || result.metadata === undefined) {
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
  return contextFor(config, result.metadata);
}
function requireAuthPermission(context, permission) {
  if (context.mode === "disabled") {
    return;
  }
  if (context.token === undefined) {
    throw new HttpError("UNAUTHORIZED", "missing or invalid bearer token");
  }
  if (!hasAuthPermission(context.token.permissions, permission)) {
    throw new HttpError("FORBIDDEN", `missing permission: ${permission}`);
  }
}

// src/server/app-server-compat.ts
function createAppServerCompatMetadata(dispatcher) {
  const limitationCodes = new Set;
  for (const capability of dispatcher.capabilities) {
    for (const limitation of capability.limitations) {
      limitationCodes.add(limitation.code);
    }
  }
  return {
    mode: "compat-local",
    capabilities: dispatcher.capabilities.map((capability) => capability.name),
    limitations: [...limitationCodes].sort()
  };
}
async function handleAppServerCompatRoute(request, context) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/compat/app-server") {
    return;
  }
  if (context.config.compatGraphql !== true) {
    return;
  }
  if (request.method !== "GET") {
    return jsonResponse({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "method not allowed"
      }
    }, 405);
  }
  const auth = await authenticateRequest(request, context.config);
  const dispatcher = createCompatCommandDispatcher({
    sdk: createCursorAgentSdk({
      stateRoot: context.config.dataDir,
      cursorHome: context.config.cursorHome
    }),
    streams: context.streams,
    auth: {
      mode: auth.mode,
      ...auth.token !== undefined ? { tokenPermissions: auth.token.permissions } : {}
    }
  });
  return jsonResponse(createAppServerCompatMetadata(dispatcher));
}

// src/sdk/server.ts
function eventEnvelope(event, payload) {
  return {
    id: `${event}:${Date.now().toString(36)}`,
    event,
    emittedAt: new Date().toISOString(),
    payload
  };
}
function createResourceHandlers(sdk) {
  return {
    sessions: sdk.sessions,
    search: sdk.search,
    groups: sdk.groups,
    queues: sdk.queues,
    bookmarks: sdk.bookmarks,
    files: sdk.files,
    activity: sdk.activity
  };
}
function createEventStreamSource(sdk) {
  return {
    async* watchActivity(sessionId, options = {}) {
      normalizeServerEventStreamOptions(options);
      const payload = sessionId === undefined ? await sdk.activity.list() : await sdk.activity.get(sessionId);
      yield eventEnvelope("activity.updated", {
        ...sessionId !== undefined ? { sessionId } : {},
        activities: payload === null ? [] : Array.isArray(payload) ? payload : [payload],
        provenance: "derived"
      });
    },
    async* watchSession(sessionId, options = {}) {
      normalizeServerEventStreamOptions(options);
      const session = await sdk.sessions.get(sessionId);
      if (session === null) {
        yield eventEnvelope("session.error", {
          type: "session.error",
          sessionId,
          message: "session not found"
        });
        return;
      }
      if (session.identityState === "chat_only") {
        yield eventEnvelope("session.pending", { session });
        return;
      }
      yield eventEnvelope("session.materialized", {
        previousSession: session,
        session
      });
    }
  };
}
var sdkServerHelpers = {
  createResourceHandlers,
  createEventStreamSource
};
export {
  sdkServerHelpers,
  createResourceHandlers,
  createEventStreamSource,
  createAppServerCompatMetadata
};
