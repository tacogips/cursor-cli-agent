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
var EFFORT_SUFFIX_EXEMPT_MODEL_PREFIXES = ["composer-"];
function modelSupportsEffortSuffix(model) {
  const fastSuffix = model.endsWith("-fast") ? "-fast" : "";
  const base = fastSuffix.length > 0 ? model.slice(0, -fastSuffix.length) : model;
  return !EFFORT_SUFFIX_EXEMPT_MODEL_PREFIXES.some((prefix) => base === prefix || base.startsWith(prefix));
}
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
  if (!modelSupportsEffortSuffix(model)) {
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
function buildSpawnEnv(opts) {
  const env = { ...process.env };
  if (opts.env !== undefined) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }
  if (opts.cursorApiKey !== undefined && opts.cursorApiKey.length > 0) {
    env["CURSOR_API_KEY"] = opts.cursorApiKey;
  }
  if (opts.cursorAuthToken !== undefined && opts.cursorAuthToken.length > 0) {
    env["CURSOR_AUTH_TOKEN"] = opts.cursorAuthToken;
  }
  return env;
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
async function createChat(workspace, opts) {
  const proc = cursorAgentSpawn("cursor-agent", ["create-chat"], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildSpawnEnv(opts ?? {})
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
    stdio: ["ignore", "pipe", "pipe"],
    env: buildSpawnEnv(opts)
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
    stdio: ["ignore", "pipe", "pipe"],
    env: buildSpawnEnv(opts)
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
function mergeOptionalEnv(base, overlay) {
  if (base === undefined && overlay === undefined) {
    return;
  }
  return { ...base, ...overlay };
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
      const resolvedApiKey = request.cursorApiKey ?? options.cursorApiKey;
      const resolvedAuthToken = request.cursorAuthToken ?? options.cursorAuthToken;
      const resolvedEnv = mergeOptionalEnv(options.cursorAgentEnv, request.cursorAgentEnv);
      return createRunningAgent(request.sessionId ?? "pending", (onLine) => startHeadless({
        workspace,
        prompt,
        ...request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {},
        ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {},
        ...request.model !== undefined ? { model: request.model } : {},
        ...request.effort !== undefined ? { effort: request.effort } : {},
        ...request.mode !== undefined ? { mode: request.mode } : {},
        ...resolvedApiKey !== undefined ? { cursorApiKey: resolvedApiKey } : {},
        ...resolvedAuthToken !== undefined ? { cursorAuthToken: resolvedAuthToken } : {},
        ...resolvedEnv !== undefined ? { env: resolvedEnv } : {}
      }, onLine));
    },
    resume(request) {
      const workspace = request.cwd ?? process.cwd();
      const resolvedApiKey = request.cursorApiKey ?? options.cursorApiKey;
      const resolvedAuthToken = request.cursorAuthToken ?? options.cursorAuthToken;
      const resolvedEnv = mergeOptionalEnv(options.cursorAgentEnv, request.cursorAgentEnv);
      return createRunningAgent(request.sessionId, (onLine) => startResume({
        workspace,
        sessionOrChatId: request.sessionId,
        ...request.prompt !== undefined ? { prompt: request.prompt } : {},
        ...request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {},
        ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {},
        ...request.model !== undefined ? { model: request.model } : {},
        ...request.effort !== undefined ? { effort: request.effort } : {},
        ...request.mode !== undefined ? { mode: request.mode } : {},
        ...resolvedApiKey !== undefined ? { cursorApiKey: resolvedApiKey } : {},
        ...resolvedAuthToken !== undefined ? { cursorAuthToken: resolvedAuthToken } : {},
        ...resolvedEnv !== undefined ? { env: resolvedEnv } : {}
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
function resolveSpawnEnv(provided) {
  if (provided === undefined) {
    return { ...process.env };
  }
  const env = { ...process.env };
  for (const [k, v] of Object.entries(provided)) {
    if (v !== undefined) {
      env[k] = v;
    }
  }
  return env;
}
async function defaultToolCommandRunner(command, args, options) {
  return await new Promise((resolve4) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: resolveSpawnEnv(options.env)
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
function buildProbeEnv(options) {
  if (options.cursorApiKey === undefined && options.cursorAuthToken === undefined && options.env === undefined) {
    return;
  }
  const env = { ...process.env };
  if (options.env !== undefined) {
    for (const [k, v] of Object.entries(options.env)) {
      if (v !== undefined) {
        env[k] = v;
      }
    }
  }
  if (options.cursorApiKey !== undefined && options.cursorApiKey.length > 0) {
    env["CURSOR_API_KEY"] = options.cursorApiKey;
  }
  if (options.cursorAuthToken !== undefined && options.cursorAuthToken.length > 0) {
    env["CURSOR_AUTH_TOKEN"] = options.cursorAuthToken;
  }
  return env;
}
async function runModelProbe(model, binary, runner, options) {
  const timeoutMs = normalizeTimeout2(options.timeoutMs);
  const probeEnv = buildProbeEnv(options);
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
    ...options.workspace !== undefined ? { cwd: options.workspace } : {},
    ...probeEnv !== undefined ? { env: probeEnv } : {}
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
        ...options.cursorApiKey !== undefined ? { cursorApiKey: options.cursorApiKey } : {},
        ...options.cursorAuthToken !== undefined ? { cursorAuthToken: options.cursorAuthToken } : {},
        ...options.cursorAgentEnv !== undefined ? { env: options.cursorAgentEnv } : {},
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
// src/cursor/auth-keepalive.ts
var DEFAULT_KEEPALIVE_INTERVAL_MS = 20 * 60 * 1000;
var MIN_KEEPALIVE_INTERVAL_MS = 60 * 1000;
function clampIntervalMs(value) {
  const v = value ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  if (!Number.isFinite(v) || v < MIN_KEEPALIVE_INTERVAL_MS) {
    return MIN_KEEPALIVE_INTERVAL_MS;
  }
  return Math.floor(v);
}

class CursorAuthKeepAlive {
  options;
  timer;
  _status;
  constructor(options) {
    this.options = options;
    this._status = { running: false, probeCount: 0 };
  }
  start() {
    if (this._status.running) {
      return;
    }
    this._status = { ...this._status, running: true };
    const intervalMs = clampIntervalMs(this.options.intervalMs);
    const setIntervalFn = this.options.setInterval ?? globalThis.setInterval.bind(globalThis);
    this.timer = setIntervalFn(() => {
      this.probeNow();
    }, intervalMs);
  }
  stop() {
    if (!this._status.running) {
      return;
    }
    this._status = { ...this._status, running: false };
    const clearIntervalFn = this.options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
    if (this.timer !== undefined) {
      clearIntervalFn(this.timer);
      this.timer = undefined;
    }
  }
  async probeNow() {
    const now = this.options.now ?? (() => new Date);
    try {
      const result = await checkModelAvailability({
        model: this.options.model,
        probe: true,
        ...this.options.cursorAgentBinary !== undefined ? { cursorAgentBinary: this.options.cursorAgentBinary } : {},
        ...this.options.cursorApiKey !== undefined ? { cursorApiKey: this.options.cursorApiKey } : {},
        ...this.options.cursorAuthToken !== undefined ? { cursorAuthToken: this.options.cursorAuthToken } : {},
        ...this.options.env !== undefined ? { env: this.options.env } : {},
        ...this.options.workspace !== undefined ? { workspace: this.options.workspace } : {},
        ...this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {},
        now,
        ...this.options.commandRunner !== undefined ? { commandRunner: this.options.commandRunner } : {}
      });
      if (result.modelReachability.status === "unavailable") {
        throw new Error(result.modelReachability.error ?? "model probe returned unavailable");
      }
      this._status = {
        ...this._status,
        lastSuccessAt: now().toISOString(),
        probeCount: this._status.probeCount + 1
      };
    } catch (err) {
      this._status = {
        ...this._status,
        lastFailureAt: now().toISOString(),
        lastFailureMessage: err instanceof Error ? err.message : String(err),
        probeCount: this._status.probeCount + 1
      };
    }
  }
  status() {
    return { ...this._status };
  }
}
// src/cursor/auth-env.ts
function resolveCursorAuthEnv(options = {}) {
  const apiKey = options.cursorApiKey !== undefined && options.cursorApiKey.length > 0 ? options.cursorApiKey : typeof process.env["CURSOR_API_KEY"] === "string" && process.env["CURSOR_API_KEY"].length > 0 ? process.env["CURSOR_API_KEY"] : undefined;
  const authToken = options.cursorAuthToken !== undefined && options.cursorAuthToken.length > 0 ? options.cursorAuthToken : typeof process.env["CURSOR_AUTH_TOKEN"] === "string" && process.env["CURSOR_AUTH_TOKEN"].length > 0 ? process.env["CURSOR_AUTH_TOKEN"] : undefined;
  return {
    ...apiKey !== undefined ? { cursorApiKey: apiKey } : {},
    ...authToken !== undefined ? { cursorAuthToken: authToken } : {}
  };
}

// src/sdk/index.ts
function createCursorAgentSdk(options = {}) {
  const facades = createDomainFacades(options);
  return {
    ...facades,
    runner: createAgentRunnerFacade({
      ...options.cursorBinary !== undefined ? { cursorBinary: options.cursorBinary } : {},
      ...options.cursorApiKey !== undefined ? { cursorApiKey: options.cursorApiKey } : {},
      ...options.cursorAgentEnv !== undefined ? { cursorAgentEnv: options.cursorAgentEnv } : {}
    }),
    tools: createToolHelperSdk(options)
  };
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
// src/graphql/index.ts
var SCHEMA = {
  description: "Compatibility GraphQL schema with JSON, ping, and command fields.",
  queryType: "Query",
  mutationType: "Mutation",
  subscriptionType: "Subscription"
};
function errorResult(error) {
  return { data: null, errors: [error] };
}
function operationKindFor(document) {
  const trimmed = document.trimStart();
  if (trimmed.startsWith("mutation")) {
    return "mutation";
  }
  if (trimmed.startsWith("subscription")) {
    return "subscription";
  }
  return "query";
}
function parseCommandName(document) {
  return /command\s*\(\s*name\s*:\s*"([^"]+)"/.exec(document)?.[1];
}
function parseInlineJsonParams(document) {
  const match = /params\s*:\s*(\{[\s\S]*\})\s*\)/.exec(document);
  if (match?.[1] === undefined) {
    return;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return;
  }
}
function parseOperation(document, variables) {
  const trimmed = document.trim();
  if (trimmed.length === 0) {
    throw new Error("GraphQL document is empty");
  }
  const kind = operationKindFor(trimmed);
  if (/\bping\b/.test(trimmed)) {
    return { kind, field: "ping" };
  }
  if (!/\bcommand\s*\(/.test(trimmed)) {
    throw new Error("GraphQL document must select ping or command");
  }
  const commandName = parseCommandName(trimmed);
  if (commandName === undefined) {
    throw new Error("command field requires a string name argument");
  }
  const params = trimmed.includes("params: $param") ? variables?.["param"] : trimmed.includes("params:") ? parseInlineJsonParams(trimmed) : undefined;
  return { kind, field: "command", commandName, params };
}
function toGraphqlError(error) {
  if (error instanceof CompatCommandError) {
    return {
      message: error.message,
      extensions: {
        code: "COMPAT_COMMAND_ERROR",
        httpStatus: error.statusCode,
        ...error.details
      }
    };
  }
  return {
    message: error instanceof Error ? error.message : "GraphQL execution failed",
    extensions: { code: "GRAPHQL_EXECUTION_ERROR" }
  };
}
async function* streamExecutionResults(values) {
  try {
    for await (const value of values) {
      yield { data: { command: value } };
    }
  } catch (error) {
    yield errorResult(toGraphqlError(error));
  }
}
function getGraphqlSchema() {
  return SCHEMA;
}
async function executeGraphqlOperation(request) {
  let operation;
  try {
    operation = parseOperation(request.document, request.variables);
  } catch (error) {
    return errorResult({
      message: error instanceof Error ? error.message : "GraphQL parse failed",
      extensions: { code: "GRAPHQL_PARSE_ERROR" }
    });
  }
  if (operation.field === "ping") {
    return { data: { ping: true } };
  }
  if (operation.commandName === undefined) {
    return errorResult({
      message: "command field requires name",
      extensions: { code: "GRAPHQL_VALIDATION_ERROR" }
    });
  }
  try {
    const result = await request.dispatcher.execute({
      kind: operation.kind,
      name: operation.commandName,
      params: operation.params,
      context: request.context ?? {}
    });
    if (result.kind === "stream") {
      return streamExecutionResults(result.values);
    }
    return { data: { command: result.value } };
  } catch (error) {
    return errorResult(toGraphqlError(error));
  }
}
function isGraphqlAsyncResult(result) {
  return Symbol.asyncIterator in result;
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
// src/cli/cli.ts
import { spawn as spawn4 } from "child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync11 } from "fs";
import { readFile as readFile15 } from "fs/promises";
import { join as join10, resolve as resolve9 } from "path";

// src/cursor/attachment-capability.ts
import { spawn as spawn2 } from "child_process";
import { once as once2 } from "events";
var probeCache = new Map;
function parseHelp(stdout, checkedAt) {
  const candidates = [
    "--image",
    "--attach",
    "--file"
  ];
  for (const flag of candidates) {
    const esc = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[\\s])${esc}(?=[\\s]|$)`, "m");
    if (re.test(stdout)) {
      return {
        imageFlag: flag,
        status: "supported",
        detectedFrom: "help",
        checkedAt
      };
    }
  }
  return {
    status: "unsupported",
    detectedFrom: "help",
    checkedAt
  };
}
async function probeCursorAttachmentCapabilities(options) {
  if (options.forceStatus !== undefined) {
    const checkedAt2 = options.now().toISOString();
    return {
      status: options.forceStatus,
      detectedFrom: "override",
      ...options.forceStatus === "supported" ? {
        imageFlag: "--image"
      } : {},
      checkedAt: checkedAt2
    };
  }
  if (options.helpTextOverride !== undefined) {
    const checkedAt2 = options.now().toISOString();
    const cap = parseHelp(options.helpTextOverride, checkedAt2);
    return { ...cap, detectedFrom: "override", checkedAt: checkedAt2 };
  }
  const binary = options.cursorBinary ?? "cursor-agent";
  if (!options.bypassCache) {
    const existing = probeCache.get(binary);
    if (existing !== undefined) {
      return existing;
    }
  }
  const checkedAt = options.now().toISOString();
  const runProbe = async () => {
    const proc = spawn2(binary, ["--help"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (c) => {
      stdout += c;
    });
    proc.stderr?.on("data", (c) => {
      stdout += c;
    });
    try {
      const [code] = await once2(proc, "close");
      if (code !== 0) {
        return { status: "unknown", detectedFrom: "help", checkedAt };
      }
      return parseHelp(stdout, checkedAt);
    } catch {
      return { status: "unknown", detectedFrom: "help", checkedAt };
    }
  };
  const pending = runProbe();
  if (!options.bypassCache) {
    probeCache.set(binary, pending);
  }
  return pending;
}

// src/cursor/activity-signals.ts
var TRUST_PATTERNS = [
  /workspace trust required/i,
  /workspace trust/i,
  /trust.*required/i,
  /approval required/i,
  /requires approval/i,
  /approve.*workspace/i
];
var INPUT_PATTERNS = [
  /waiting for (user )?input/i,
  /interactive prompt/i,
  /please respond/i,
  /requires (user )?input/i,
  /clarification required/i
];
function nowIso() {
  return new Date().toISOString();
}
function matchPattern(text, patterns) {
  return patterns.find((pattern) => pattern.test(text))?.source;
}
function classifyTextSignal(text, source) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const trust = matchPattern(trimmed, TRUST_PATTERNS);
  if (trust !== undefined) {
    return {
      source,
      status: "waiting_trust",
      observedAt: nowIso(),
      detail: `matched ${trust}`
    };
  }
  const input = matchPattern(trimmed, INPUT_PATTERNS);
  if (input !== undefined) {
    return {
      source,
      status: "waiting_input",
      observedAt: nowIso(),
      detail: `matched ${input}`
    };
  }
  return null;
}
function createActivitySignalClassifier() {
  return {
    classifyStreamEvent(event) {
      const observedAt = nowIso();
      switch (event.type) {
        case "session.started":
          return {
            source: "stream",
            status: "running",
            observedAt,
            detail: `started in ${event.cwd}`
          };
        case "session.thinking":
        case "session.assistant_message":
        case "session.user_message":
          return {
            source: "stream",
            status: "running",
            observedAt,
            detail: event.type
          };
        case "session.completed":
          return {
            source: "stream",
            status: "completed",
            observedAt,
            detail: "stream completed"
          };
        case "session.error":
          return {
            source: "stream",
            status: "failed",
            observedAt,
            detail: event.message
          };
        case "session.pending":
        case "session.materialized":
          return null;
      }
    },
    classifyProcessResult(exitCode, stderr, stdout) {
      const stderrSignal = stderr === undefined ? null : classifyTextSignal(stderr, "stderr");
      if (stderrSignal !== null) {
        return stderrSignal;
      }
      const stdoutSignal = stdout === undefined ? null : classifyTextSignal(stdout, "stdout");
      if (stdoutSignal !== null) {
        return stdoutSignal;
      }
      if (exitCode === null) {
        return {
          source: "process",
          status: "failed",
          observedAt: nowIso(),
          detail: "process closed without an exit code"
        };
      }
      if (exitCode === 0) {
        return {
          source: "process",
          status: "completed",
          observedAt: nowIso(),
          detail: "process exited with code 0"
        };
      }
      return {
        source: "process",
        status: "failed",
        observedAt: nowIso(),
        detail: `process exited with code ${exitCode}`
      };
    }
  };
}

// src/cursor/prompt-attachments.ts
import { createHash as createHash2, randomUUID as randomUUID11 } from "crypto";
import { createReadStream as createReadStream2 } from "fs";
import { lstat } from "fs/promises";
import { isAbsolute as isAbsolute2, resolve as resolve6, sep } from "path";
function looksLikeRemoteOrSpecial(pathStr) {
  if (pathStr.length === 0) {
    return true;
  }
  if (pathStr === "-" || pathStr === "--") {
    return true;
  }
  const lower = pathStr.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("file://") || lower.startsWith("data:")) {
    return true;
  }
  if (pathStr.startsWith("\\\\")) {
    return true;
  }
  return false;
}
function mediaTypeFromName(pathStr) {
  const lower = pathStr.toLowerCase();
  if (lower.endsWith(".png"))
    return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    return "image/jpeg";
  if (lower.endsWith(".webp"))
    return "image/webp";
  if (lower.endsWith(".gif"))
    return "image/gif";
  return;
}
function sniffMediaType(head) {
  if (head.length >= 8 && head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71 && head[4] === 13 && head[5] === 10 && head[6] === 26 && head[7] === 10) {
    return "image/png";
  }
  if (head.length >= 3 && head[0] === 255 && head[1] === 216 && head[2] === 255) {
    return "image/jpeg";
  }
  if (head.length >= 12 && head[0] === 71 && head[1] === 73 && head[2] === 70 && head[3] === 56 && (head[4] === 57 || head[4] === 55) && head[5] === 97) {
    return "image/gif";
  }
  if (head.length >= 12 && head[0] === 82 && head[1] === 73 && head[2] === 70 && head[3] === 70 && head[8] === 87 && head[9] === 69 && head[10] === 66 && head[11] === 80) {
    return "image/webp";
  }
  return;
}
async function sha256File(pathStr) {
  const hash = createHash2("sha256");
  try {
    const stream = createReadStream2(pathStr);
    await new Promise((resolveP, reject) => {
      stream.on("error", reject);
      stream.on("data", (c) => {
        if (typeof c === "string") {
          hash.update(c);
        } else {
          hash.update(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
        }
      });
      stream.on("close", () => resolveP());
    });
    return hash.digest("hex");
  } catch {
    return;
  }
}
async function readHeadSafe(pathStr, maxLen) {
  const buf = new Uint8Array(maxLen);
  const stream = createReadStream2(pathStr, { start: 0, end: maxLen - 1 });
  let offset = 0;
  for await (const chunk of stream) {
    const c = chunk;
    for (let i = 0;i < c.length && offset < buf.length; i += 1) {
      buf[offset] = c.readUInt8(i);
      offset += 1;
    }
  }
  return buf.subarray(0, offset);
}
function resolveAgainstWorkspace(workspace, originalPath) {
  return resolve6(workspace, originalPath);
}
async function validatePromptAttachments(inputs, options) {
  const recordedAt = options.now().toISOString();
  const seenResolved = new Set;
  const attachments = [];
  const imagePaths = [];
  for (const input of inputs) {
    if (input.kind !== "image") {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: input.path,
          detail: "only image attachments are supported"
        }
      };
    }
    const originalPath = input.path.trim();
    if (looksLikeRemoteOrSpecial(originalPath)) {
      return {
        ok: false,
        error: {
          code: "invalid_scheme",
          path: originalPath,
          detail: "only local filesystem image paths are allowed"
        }
      };
    }
    const resolvedPath = resolveAgainstWorkspace(options.workspace, originalPath);
    if (!isAbsolute2(originalPath)) {
      const workspaceAbs = resolve6(options.workspace);
      if (resolvedPath !== workspaceAbs && !resolvedPath.startsWith(workspaceAbs + sep)) {
        return {
          ok: false,
          error: {
            code: "unsafe_path",
            path: originalPath,
            detail: "relative path escapes workspace boundary"
          }
        };
      }
    }
    let st;
    try {
      st = await lstat(resolvedPath);
    } catch {
      return {
        ok: false,
        error: {
          code: "stat_failed",
          path: originalPath,
          detail: `cannot stat ${resolvedPath}`
        }
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: {
          code: "not_regular_file",
          path: originalPath,
          detail: "path must be a regular file"
        }
      };
    }
    const byName = mediaTypeFromName(resolvedPath);
    const head = await readHeadSafe(resolvedPath, 32);
    const byMagic = sniffMediaType(head);
    if (byMagic !== undefined && byName !== undefined && byMagic !== byName) {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: originalPath,
          detail: `file magic (${byMagic}) does not match declared extension type (${byName})`
        }
      };
    }
    const mediaType = byMagic !== undefined ? byMagic : byName;
    if (mediaType === undefined) {
      return {
        ok: false,
        error: {
          code: "unsupported_media",
          path: originalPath,
          detail: "not a recognized PNG/JPEG/WebP/GIF image"
        }
      };
    }
    const hex = await sha256File(resolvedPath);
    if (hex === undefined) {
      return {
        ok: false,
        error: {
          code: "hash_failed",
          path: originalPath,
          detail: "failed to read file content for hashing"
        }
      };
    }
    if (!seenResolved.has(resolvedPath)) {
      seenResolved.add(resolvedPath);
      attachments.push({
        id: randomUUID11(),
        kind: "image",
        source: options.source,
        originalPath,
        resolvedPath,
        mediaType,
        sizeBytes: st.size,
        sha256: hex,
        status: "validated",
        recordedAt
      });
      imagePaths.push(resolvedPath);
    }
  }
  return {
    ok: true,
    value: { attachments, imagePaths }
  };
}

// src/cursor/session-replay-fork.ts
import { randomUUID as randomUUID12 } from "crypto";

// src/cursor/replay-prompt.ts
import { createHash as createHash3 } from "crypto";
var REPLAY_FORK_LIMITATIONS = [
  "Cursor native fork semantics are not available through the confirmed local CLI surface.",
  "Replayed context is plain transcript text, not hidden model state.",
  "Tool calls, tool outputs, approvals, file diffs, attachments, and transient runtime state may be absent or incomplete.",
  "The new session may answer differently from the source session because the model receives a synthetic replay prompt.",
  "Transcript files are local Cursor state and may be incomplete until materialization finishes."
];
function buildReplayForkPrompt(source, slice, continuationPrompt, context) {
  const lines = [
    "You are continuing a Cursor agent conversation via BEST-EFFORT REPLAY.",
    "This is not a native fork; prior tool calls, approvals, hidden system state, and attachments may be missing.",
    "",
    `Source record: ${source.recordId}`,
    ...source.localSessionId !== undefined ? [`Source local session: ${source.localSessionId}`] : [],
    ...source.cursorChatId !== undefined ? [`Source Cursor chat: ${source.cursorChatId}`] : [],
    ""
  ];
  if (context.omittedNonReplayableCount > 0) {
    lines.push(`Note: ${context.omittedNonReplayableCount} non-user/assistant transcript event(s) were omitted from this replay.`);
  }
  if (context.omittedReplayableTailCount > 0) {
    lines.push(`Note: ${context.omittedReplayableTailCount} later user/assistant message(s) were excluded by the selected fork boundary.`);
  }
  lines.push("", "--- Prior conversation (transcript text only) ---", "");
  for (const row of slice) {
    lines.push(`[${row.role.toUpperCase()}] ${row.messageId}`, row.displayText, "");
  }
  lines.push("--- User continuation ---", continuationPrompt);
  const fullPrompt = lines.join(`
`);
  const promptHash = createHash3("sha256").update(fullPrompt, "utf8").digest("hex");
  const promptPreview = fullPrompt.length > 240 ? `${fullPrompt.slice(0, 240)}...` : fullPrompt;
  return { fullPrompt, promptPreview, promptHash };
}

// src/cursor/transcript-message-id.ts
function stableTranscriptMessageId(eventOffset, role) {
  return `event-${eventOffset}-${role}`;
}

// src/cursor/session-replay-slice.ts
async function scanReplayableTranscriptRows(transcriptPath) {
  const rows = [];
  let omittedNonReplayableCount = 0;
  for await (const line of streamTranscriptSearchLines(transcriptPath)) {
    if (line.role !== "user" && line.role !== "assistant") {
      omittedNonReplayableCount += 1;
      continue;
    }
    rows.push({
      messageId: stableTranscriptMessageId(line.eventOffset, line.role),
      role: line.role,
      displayText: line.text,
      eventOffset: line.eventOffset
    });
  }
  return { rows, omittedNonReplayableCount };
}
function sliceReplayableRowsForFork(scan, boundary) {
  const nth = boundary?.nthMessage;
  const mid = boundary?.throughMessageId;
  if (nth !== undefined && mid !== undefined) {
    return { error: "conflicting_boundary" };
  }
  let slice = scan.rows;
  if (mid !== undefined) {
    const idx = scan.rows.findIndex((r) => r.messageId === mid);
    if (idx < 0) {
      return { error: "boundary_not_found" };
    }
    slice = scan.rows.slice(0, idx + 1);
  } else if (nth !== undefined) {
    if (!Number.isInteger(nth) || nth <= 0) {
      return { error: "invalid_nth" };
    }
    slice = scan.rows.slice(0, nth);
    if (slice.length < nth) {
      return { error: "invalid_nth" };
    }
  }
  if (slice.length === 0) {
    return { error: "empty_slice" };
  }
  const omittedReplayableTailCount = scan.rows.length - slice.length;
  return {
    slice,
    omittedNonReplayableCount: scan.omittedNonReplayableCount,
    omittedReplayableTailCount
  };
}

// src/cursor/session-replay-fork.ts
class SessionReplayForkError extends Error {
  code;
  sliceCode;
  constructor(code, message, sliceCode) {
    super(message);
    this.code = code;
    this.sliceCode = sliceCode;
    this.name = "SessionReplayForkError";
  }
}
function sliceErrorMessage(code) {
  switch (code) {
    case "empty_slice":
      return "replay slice is empty";
    case "boundary_not_found":
      return "fork boundary message id not found in transcript";
    case "invalid_nth":
      return "fork --nth-message is out of range for replayable messages";
    case "conflicting_boundary":
      return "conflicting fork boundary selectors";
    default: {
      const _e = code;
      return _e;
    }
  }
}
function buildForkPoint(slice, request) {
  const last = slice[slice.length - 1];
  if (last === undefined) {
    throw new SessionReplayForkError("slice_error", "empty replay slice");
  }
  return {
    ...request.throughMessageId !== undefined ? { messageId: request.throughMessageId } : {},
    ...request.nthMessage !== undefined ? { nthMessage: request.nthMessage } : {},
    ...request.throughMessageId === undefined && request.nthMessage === undefined ? { nthMessage: slice.length } : {},
    eventOffset: last.eventOffset,
    role: last.role,
    inclusive: true
  };
}
function buildReplayPlan(sliceLen, omittedNonReplayable, omittedReplayableTail, promptPreview) {
  const omittedMessageCount = omittedNonReplayable + omittedReplayableTail;
  return {
    messageCount: sliceLen,
    omittedMessageCount,
    truncated: omittedNonReplayable > 0 || omittedReplayableTail > 0,
    promptPreview
  };
}
async function executeSessionReplayFork(request, headlessBase, deps) {
  const run = deps.runHeadless ?? runHeadlessStreaming;
  const now = deps.now ?? (() => new Date);
  const repo = deps.sessions;
  const source = repo.resolveSessionKey(request.sourceSessionId);
  if (source === undefined) {
    throw new SessionReplayForkError("not_found", "session not found");
  }
  if (source.identityState === "chat_only" || source.transcriptPath === undefined) {
    throw new SessionReplayForkError("transcript_unavailable", "source session has no materialized transcript to replay");
  }
  const scan = await scanReplayableTranscriptRows(source.transcriptPath);
  const boundary = request.throughMessageId !== undefined ? { throughMessageId: request.throughMessageId } : request.nthMessage !== undefined ? { nthMessage: request.nthMessage } : undefined;
  const sliced = sliceReplayableRowsForFork(scan, boundary);
  if ("error" in sliced) {
    throw new SessionReplayForkError("slice_error", sliceErrorMessage(sliced.error), sliced.error);
  }
  const { fullPrompt, promptPreview, promptHash } = buildReplayForkPrompt(source, sliced.slice, request.continuationPrompt, {
    omittedNonReplayableCount: sliced.omittedNonReplayableCount,
    omittedReplayableTailCount: sliced.omittedReplayableTailCount
  });
  const forkPoint = buildForkPoint(sliced.slice, request);
  const replay = buildReplayPlan(sliced.slice.length, sliced.omittedNonReplayableCount, sliced.omittedReplayableTailCount, promptPreview);
  const warnings = [];
  if (sliced.omittedNonReplayableCount > 0) {
    warnings.push(`Omitted ${sliced.omittedNonReplayableCount} non-replayable transcript row(s).`);
  }
  if (sliced.omittedReplayableTailCount > 0) {
    warnings.push(`Excluded ${sliced.omittedReplayableTailCount} replayable message(s) after the fork boundary.`);
  }
  const replayForkId = randomUUID12();
  const createdAt = now().toISOString();
  let provenance = {
    replayForkId,
    sourceRecordId: source.recordId,
    ...source.localSessionId !== undefined ? { sourceLocalSessionId: source.localSessionId } : {},
    ...source.cursorChatId !== undefined ? { sourceCursorChatId: source.cursorChatId } : {},
    promptHash,
    createdAt,
    semantics: "replay_not_native_fork"
  };
  const limitations = [...REPLAY_FORK_LIMITATIONS];
  if (request.dryRun) {
    return {
      mode: "best_effort_replay",
      sourceSession: source,
      forkPoint,
      replay,
      provenance,
      limitations,
      warnings
    };
  }
  const norm = new StreamNormalizerState;
  let lastStreamSessionId;
  const exit = await run({ ...headlessBase, prompt: fullPrompt }, (line) => {
    for (const event of norm.processLine(line)) {
      deps.onNormalizedEvents?.([event]);
      const sid = sessionIdFromEvent(event);
      if (sid !== undefined) {
        lastStreamSessionId = sid;
      }
    }
  });
  if (isTrustFailureMessage(exit.stderr)) {
    throw new SessionReplayForkError("trust_required", exit.stderr.trim().length > 0 ? exit.stderr.trim() : "cursor-agent trust approval required");
  }
  if (exit.code !== 0 && exit.code !== null) {
    throw new SessionReplayForkError("cursor_failed", exit.stderr.trim().length > 0 ? exit.stderr.trim() : `cursor-agent exited with code ${exit.code}`);
  }
  let newRecord;
  try {
    await repo.importTranscriptsFromFilesystem();
    const newSid = lastStreamSessionId;
    newRecord = newSid !== undefined ? repo.resolveSessionKey(newSid) : undefined;
    provenance = {
      ...provenance,
      ...newRecord?.recordId !== undefined ? { newRecordId: newRecord.recordId } : {},
      ...newRecord?.localSessionId !== undefined ? { newLocalSessionId: newRecord.localSessionId } : {}
    };
    if (newRecord?.recordId === undefined) {
      warnings.push("Could not link a new session record after replay run; provenance may lack new session ids.");
    }
  } catch {
    warnings.push("Failed to import transcripts after replay run; provenance may lack new session ids.");
  }
  await deps.store.record(provenance);
  return {
    mode: "best_effort_replay",
    sourceSession: source,
    forkPoint,
    replay,
    ...newRecord !== undefined ? { newSession: newRecord } : {},
    provenance,
    limitations,
    warnings
  };
}

// src/markdown/parser.ts
var HEADING_PATTERN = /^(#{1,6})(?:[ \t]+(.*))?$/;
var TASK_PATTERN = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/;
function parseHeadings(lines) {
  const headings = [];
  for (let index = 0;index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const match = HEADING_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    headings.push({
      heading: (match[2] ?? "").trim(),
      level: match[1]?.length ?? 0,
      lineIndex: index
    });
  }
  return headings;
}
function buildSectionRanges(lines) {
  const headings = parseHeadings(lines);
  if (headings.length === 0) {
    return [
      {
        heading: "",
        level: 0,
        startLine: 1,
        endLine: lines.length
      }
    ];
  }
  return headings.map((heading, index) => ({
    heading: heading.heading,
    level: heading.level,
    startLine: heading.lineIndex + 1,
    endLine: (headings[index + 1]?.lineIndex ?? lines.length) - 1 + 1
  }));
}
function sectionContent(lines, range) {
  if (range.level === 0) {
    return lines.join(`
`);
  }
  return lines.slice(range.startLine, range.endLine).join(`
`);
}
function sectionForLine(sections, lineNumber) {
  for (const section of sections) {
    if (lineNumber >= section.startLine && lineNumber <= section.endLine) {
      return section;
    }
  }
  return;
}
function parseMarkdownTasks(input) {
  const lines = input.markdown.split(/\r?\n/);
  const ranges = buildSectionRanges(lines);
  const sections = ranges.map((range) => ({
    messageId: input.messageId,
    heading: range.heading,
    level: range.level,
    content: sectionContent(lines, range),
    startLine: range.startLine,
    endLine: range.endLine
  }));
  const tasks = [];
  for (let index = 0;index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const match = TASK_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    const lineNumber = index + 1;
    const section = sectionForLine(ranges, lineNumber);
    tasks.push({
      recordId: input.recordId,
      ...input.localSessionId !== undefined ? { localSessionId: input.localSessionId } : {},
      ...input.cursorChatId !== undefined ? { cursorChatId: input.cursorChatId } : {},
      transcriptPath: input.transcriptPath,
      messageId: input.messageId,
      role: "assistant",
      ...section !== undefined && section.heading.length > 0 ? { sectionHeading: section.heading } : {},
      text: (match[2] ?? "").trim(),
      checked: match[1] !== " ",
      lineNumber,
      eventOffset: input.eventOffset,
      ...input.byteOffset !== undefined ? { byteOffset: input.byteOffset } : {},
      provenance: "transcript"
    });
  }
  return { sections, tasks };
}

// src/markdown/transcript-tasks.ts
class MarkdownTaskNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarkdownTaskNotFoundError";
  }
}
function canonicalSessionId(record) {
  return record.localSessionId ?? record.cursorChatId ?? record.recordId;
}
function messageIdFor3(eventOffset, role) {
  return `event-${eventOffset}-${role}`;
}
function emptyResult(record, options) {
  return {
    recordId: record.recordId,
    ...record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {},
    ...record.cursorChatId !== undefined ? { cursorChatId: record.cursorChatId } : {},
    sessionId: canonicalSessionId(record),
    ...record.transcriptPath !== undefined ? { transcriptPath: record.transcriptPath } : {},
    ...options.messageId !== undefined ? { messageId: options.messageId } : {},
    sections: [],
    tasks: [],
    totalTasks: 0,
    provenance: "transcript"
  };
}
function createTranscriptMarkdownTaskExtractor(repository) {
  return {
    async extract(options) {
      const record = repository.resolveSessionKey(options.sessionId);
      if (record === undefined) {
        throw new MarkdownTaskNotFoundError("session not found");
      }
      if (record.identityState === "chat_only" || record.transcriptPath === undefined) {
        return emptyResult(record, options);
      }
      const sections = [];
      const tasks = [];
      for await (const line of streamTranscriptSearchLines(record.transcriptPath)) {
        if (line.role !== "assistant") {
          continue;
        }
        const messageId = messageIdFor3(line.eventOffset, line.role);
        if (options.messageId !== undefined && messageId !== options.messageId) {
          continue;
        }
        const parsed = parseMarkdownTasks({
          recordId: record.recordId,
          ...record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {},
          ...record.cursorChatId !== undefined ? { cursorChatId: record.cursorChatId } : {},
          transcriptPath: record.transcriptPath,
          messageId,
          eventOffset: line.eventOffset,
          ...line.byteOffset !== undefined ? { byteOffset: line.byteOffset } : {},
          markdown: line.text
        });
        sections.push(...parsed.sections);
        tasks.push(...parsed.tasks);
      }
      const filteredTasks = options.checked === undefined ? tasks : tasks.filter((task) => task.checked === options.checked);
      return {
        recordId: record.recordId,
        ...record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {},
        ...record.cursorChatId !== undefined ? { cursorChatId: record.cursorChatId } : {},
        transcriptPath: record.transcriptPath,
        sessionId: canonicalSessionId(record),
        ...options.messageId !== undefined ? { messageId: options.messageId } : {},
        sections,
        tasks: filteredTasks,
        totalTasks: filteredTasks.length,
        provenance: "transcript"
      };
    }
  };
}

// src/persistence/repository-analytics-index.ts
import { mkdirSync as mkdirSync8 } from "fs";
import { dirname as dirname9 } from "path";
import { Database as Database4 } from "bun:sqlite";
var MIGRATION3 = `
CREATE TABLE IF NOT EXISTS repository_analytics_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  indexed_commits INTEGER NOT NULL,
  indexed_sessions INTEGER NOT NULL,
  indexed_files INTEGER NOT NULL,
  skipped_rows INTEGER NOT NULL,
  total_composer_lines INTEGER NOT NULL,
  weighted_v1_ai_percentage REAL,
  weighted_v2_ai_percentage REAL,
  updated_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_commits (
  commit_hash TEXT PRIMARY KEY,
  branch_name TEXT,
  commit_message TEXT,
  commit_date TEXT,
  composer_lines_added INTEGER,
  composer_lines_deleted INTEGER,
  v1_ai_percentage REAL,
  v2_ai_percentage REAL,
  provenance TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_sessions (
  session_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  conversation_id TEXT,
  workspace_path TEXT,
  touched_files INTEGER NOT NULL,
  deleted_files INTEGER NOT NULL,
  snapshots INTEGER NOT NULL,
  unknown_files INTEGER NOT NULL,
  provenance_json TEXT NOT NULL,
  completeness_notes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_analytics_files (
  path TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL,
  touched_count INTEGER NOT NULL,
  deleted_count INTEGER NOT NULL,
  snapshot_count INTEGER NOT NULL,
  first_observed_at TEXT,
  last_observed_at TEXT,
  provenance_json TEXT NOT NULL
);
`;

class RepositoryAnalyticsIndex {
  db;
  constructor(dbPath) {
    mkdirSync8(dirname9(dbPath), { recursive: true });
    this.db = new Database4(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(MIGRATION3);
  }
  close() {
    this.db.close();
  }
  rebuild(input) {
    const updatedAt = new Date().toISOString();
    const commits = uniqueCommits(input.commits);
    const summary = summarizeCommits(commits);
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM repository_analytics_commits");
      this.db.run("DELETE FROM repository_analytics_sessions");
      this.db.run("DELETE FROM repository_analytics_files");
      this.db.run("DELETE FROM repository_analytics_meta");
      const insertCommit = this.db.prepare(`
INSERT INTO repository_analytics_commits (
  commit_hash, branch_name, commit_message, commit_date,
  composer_lines_added, composer_lines_deleted, v1_ai_percentage,
  v2_ai_percentage, provenance, completeness_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const commit of commits) {
        insertCommit.run(commit.commitHash, commit.branchName ?? null, commit.commitMessage ?? null, commit.commitDate ?? null, commit.composerLinesAdded ?? null, commit.composerLinesDeleted ?? null, commit.v1AiPercentage ?? null, commit.v2AiPercentage ?? null, commit.provenance, JSON.stringify(commit.completenessNotes));
      }
      const insertSession = this.db.prepare(`
INSERT INTO repository_analytics_sessions (
  session_id, record_id, conversation_id, workspace_path, touched_files,
  deleted_files, snapshots, unknown_files, provenance_json,
  completeness_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const session of input.sessions) {
        insertSession.run(session.sessionId, session.recordId, session.conversationId ?? null, session.workspacePath ?? null, session.touchedFiles, session.deletedFiles, session.snapshots, session.unknownFiles, JSON.stringify(session.provenance), JSON.stringify(session.completenessNotes));
      }
      const insertFile = this.db.prepare(`
INSERT INTO repository_analytics_files (
  path, sessions, touched_count, deleted_count, snapshot_count,
  first_observed_at, last_observed_at, provenance_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const file of input.files) {
        insertFile.run(file.path, file.sessions, file.touchedCount, file.deletedCount, file.snapshotCount, file.firstObservedAt ?? null, file.lastObservedAt ?? null, JSON.stringify(file.provenance));
      }
      this.db.prepare(`INSERT INTO repository_analytics_meta (
            singleton_id, indexed_commits, indexed_sessions, indexed_files,
            skipped_rows, total_composer_lines, weighted_v1_ai_percentage,
            weighted_v2_ai_percentage, updated_at, provenance_json,
            completeness_notes_json
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(commits.length, input.sessions.length, input.files.length, input.skippedRows, summary.totalComposerLines, summary.weightedV1AiPercentage ?? null, summary.weightedV2AiPercentage ?? null, updatedAt, JSON.stringify(input.provenance), JSON.stringify([
        ...input.completenessNotes,
        ...summary.completenessNotes
      ]));
    });
    tx();
    return {
      indexedCommits: commits.length,
      indexedSessions: input.sessions.length,
      indexedFiles: input.files.length,
      skippedRows: input.skippedRows,
      updatedAt,
      provenance: input.provenance,
      completenessNotes: input.completenessNotes
    };
  }
  getSummary() {
    const row = this.db.query("SELECT * FROM repository_analytics_meta WHERE singleton_id = 1").get();
    if (row === null) {
      return {
        totalCommits: 0,
        scoredCommits: 0,
        totalComposerLines: 0,
        provenance: ["missing_rows"],
        completenessNotes: ["repository analytics index has not been rebuilt"]
      };
    }
    const weightedV1AiPercentage = optionalNumber2(row["weighted_v1_ai_percentage"]);
    const weightedV2AiPercentage = optionalNumber2(row["weighted_v2_ai_percentage"]);
    const updatedAt = stringValue2(row["updated_at"]);
    return {
      totalCommits: numberValue2(row["indexed_commits"]),
      scoredCommits: numberValue2(row["indexed_commits"]),
      totalComposerLines: numberValue2(row["total_composer_lines"]),
      ...weightedV1AiPercentage !== undefined ? { weightedV1AiPercentage } : {},
      ...weightedV2AiPercentage !== undefined ? { weightedV2AiPercentage } : {},
      ...updatedAt !== undefined ? { updatedAt } : {},
      provenance: provenanceList(row["provenance_json"]),
      completenessNotes: stringList(row["completeness_notes_json"])
    };
  }
  listCommits(options = {}) {
    const limit = sanitizeLimit2(options.limit, 200);
    const rows = this.db.query(`SELECT * FROM repository_analytics_commits
         ORDER BY COALESCE(commit_date, '') DESC, commit_hash ASC
         LIMIT ?`).all(limit);
    const commits = rows.map(rowToCommit);
    return {
      commits,
      totalCommits: commits.length,
      provenance: commits.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes: commits.length > 0 ? [] : ["repository analytics index has no commits"]
    };
  }
  listSessions(options = {}) {
    const limit = sanitizeLimit2(options.limit, 200);
    const rows = this.db.query(`SELECT * FROM repository_analytics_sessions
         ORDER BY touched_files + deleted_files + snapshots DESC, session_id ASC
         LIMIT ?`).all(limit);
    const sessions = rows.map(rowToSession);
    return {
      sessions,
      totalSessions: sessions.length,
      provenance: sessions.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes: sessions.length > 0 ? [] : ["repository analytics index has no sessions"]
    };
  }
  listFiles(options = {}) {
    const limit = sanitizeLimit2(options.limit, 200);
    const rows = this.db.query(`SELECT * FROM repository_analytics_files
         ORDER BY touched_count + deleted_count + snapshot_count DESC, path ASC
         LIMIT ?`).all(limit);
    const files = rows.map(rowToFile);
    return {
      files,
      totalFiles: files.length,
      provenance: files.length > 0 ? ["index"] : ["missing_rows"],
      completenessNotes: files.length > 0 ? [] : ["repository analytics index has no files"]
    };
  }
}
function uniqueCommits(commits) {
  const byHash = new Map;
  for (const commit of commits) {
    if (commit.commitHash.length === 0) {
      continue;
    }
    const existing = byHash.get(commit.commitHash);
    if (existing === undefined || (commit.commitDate ?? "").localeCompare(existing.commitDate ?? "") > 0) {
      byHash.set(commit.commitHash, commit);
    }
  }
  return [...byHash.values()];
}
function summarizeCommits(commits) {
  let totalComposerLines = 0;
  let v1Weight = 0;
  let v1Lines = 0;
  let v1Unweighted = 0;
  let v1Count = 0;
  let v2Weight = 0;
  let v2Lines = 0;
  let v2Unweighted = 0;
  let v2Count = 0;
  for (const commit of commits) {
    const lines = (commit.composerLinesAdded ?? 0) + (commit.composerLinesDeleted ?? 0);
    totalComposerLines += lines;
    if (commit.v1AiPercentage !== undefined) {
      v1Unweighted += commit.v1AiPercentage;
      v1Count += 1;
      if (lines > 0) {
        v1Weight += commit.v1AiPercentage * lines;
        v1Lines += lines;
      }
    }
    if (commit.v2AiPercentage !== undefined) {
      v2Unweighted += commit.v2AiPercentage;
      v2Count += 1;
      if (lines > 0) {
        v2Weight += commit.v2AiPercentage * lines;
        v2Lines += lines;
      }
    }
  }
  const usedUnweightedV1 = v1Lines === 0 && v1Count > 0;
  const usedUnweightedV2 = v2Lines === 0 && v2Count > 0;
  return {
    totalComposerLines,
    ...v1Lines > 0 ? { weightedV1AiPercentage: v1Weight / v1Lines } : usedUnweightedV1 ? { weightedV1AiPercentage: v1Unweighted / v1Count } : {},
    ...v2Lines > 0 ? { weightedV2AiPercentage: v2Weight / v2Lines } : usedUnweightedV2 ? { weightedV2AiPercentage: v2Unweighted / v2Count } : {},
    completenessNotes: [
      ...usedUnweightedV1 ? [
        "v1 AI percentage uses unweighted average because composer line counts are missing"
      ] : [],
      ...usedUnweightedV2 ? [
        "v2 AI percentage uses unweighted average because composer line counts are missing"
      ] : []
    ]
  };
}
function rowToCommit(row) {
  const branchName = stringValue2(row["branch_name"]);
  const commitMessage = stringValue2(row["commit_message"]);
  const commitDate = stringValue2(row["commit_date"]);
  const composerLinesAdded = optionalNumber2(row["composer_lines_added"]);
  const composerLinesDeleted = optionalNumber2(row["composer_lines_deleted"]);
  const v1AiPercentage = optionalNumber2(row["v1_ai_percentage"]);
  const v2AiPercentage = optionalNumber2(row["v2_ai_percentage"]);
  return {
    commitHash: String(row["commit_hash"] ?? ""),
    ...branchName !== undefined ? { branchName } : {},
    ...commitMessage !== undefined ? { commitMessage } : {},
    ...commitDate !== undefined ? { commitDate } : {},
    ...composerLinesAdded !== undefined ? { composerLinesAdded } : {},
    ...composerLinesDeleted !== undefined ? { composerLinesDeleted } : {},
    ...v1AiPercentage !== undefined ? { v1AiPercentage } : {},
    ...v2AiPercentage !== undefined ? { v2AiPercentage } : {},
    provenance: provenanceValue2(row["provenance"]),
    completenessNotes: stringList(row["completeness_notes_json"])
  };
}
function rowToSession(row) {
  const conversationId2 = stringValue2(row["conversation_id"]);
  const workspacePath = stringValue2(row["workspace_path"]);
  return {
    sessionId: String(row["session_id"] ?? ""),
    recordId: String(row["record_id"] ?? ""),
    ...conversationId2 !== undefined ? { conversationId: conversationId2 } : {},
    ...workspacePath !== undefined ? { workspacePath } : {},
    touchedFiles: numberValue2(row["touched_files"]),
    deletedFiles: numberValue2(row["deleted_files"]),
    snapshots: numberValue2(row["snapshots"]),
    unknownFiles: numberValue2(row["unknown_files"]),
    provenance: provenanceList(row["provenance_json"]),
    completenessNotes: stringList(row["completeness_notes_json"])
  };
}
function rowToFile(row) {
  const firstObservedAt = stringValue2(row["first_observed_at"]);
  const lastObservedAt = stringValue2(row["last_observed_at"]);
  return {
    path: String(row["path"] ?? ""),
    sessions: numberValue2(row["sessions"]),
    touchedCount: numberValue2(row["touched_count"]),
    deletedCount: numberValue2(row["deleted_count"]),
    snapshotCount: numberValue2(row["snapshot_count"]),
    ...firstObservedAt !== undefined ? { firstObservedAt } : {},
    ...lastObservedAt !== undefined ? { lastObservedAt } : {},
    provenance: provenanceList(row["provenance_json"])
  };
}
function stringValue2(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function optionalNumber2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function numberValue2(value) {
  return optionalNumber2(value) ?? 0;
}
function stringList(value) {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.flatMap((item) => typeof item === "string" ? [item] : []) : [];
  } catch {
    return [];
  }
}
function provenanceList(value) {
  const parsed = stringList(value);
  return parsed.flatMap((item) => isRepositoryAnalyticsProvenance(item) ? [item] : []);
}
function provenanceValue2(value) {
  return typeof value === "string" && isRepositoryAnalyticsProvenance(value) ? value : "unknown";
}
function isRepositoryAnalyticsProvenance(value) {
  return value === "ai_tracking" || value === "file_intelligence" || value === "git" || value === "index" || value === "missing_ai_tracking" || value === "missing_scored_commits" || value === "missing_file_intelligence" || value === "missing_rows" || value === "unknown";
}
function sanitizeLimit2(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, 1e4);
}

// src/persistence/session-replay-forks-store.ts
import { randomUUID as randomUUID13 } from "crypto";
import { mkdirSync as mkdirSync9 } from "fs";
import { readFile as readFile10, rename as rename5, writeFile as writeFile7 } from "fs/promises";
import { dirname as dirname10 } from "path";
function isSerializedProvenance(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value;
  return typeof r["replayForkId"] === "string" && typeof r["sourceRecordId"] === "string" && typeof r["promptHash"] === "string" && typeof r["createdAt"] === "string" && r["semantics"] === "replay_not_native_fork";
}
async function load6(path) {
  try {
    const raw = await readFile10(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { forks: [] };
    }
    const forksRaw = parsed["forks"];
    if (!Array.isArray(forksRaw)) {
      return { forks: [] };
    }
    return { forks: forksRaw.filter(isSerializedProvenance) };
  } catch {
    return { forks: [] };
  }
}
async function save5(path, data) {
  mkdirSync9(dirname10(path), { recursive: true });
  const tmpPath = `${path}.tmp.${randomUUID13().slice(0, 8)}`;
  await writeFile7(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
  await rename5(tmpPath, path);
}
function createReplayForkStore(path = sessionReplayForksJsonPath()) {
  return {
    async record(provenance) {
      const data = await load6(path);
      const deduped = data.forks.filter((f) => f.replayForkId !== provenance.replayForkId);
      await save5(path, { forks: [...deduped, provenance] });
    },
    async findByReplayForkId(id) {
      const data = await load6(path);
      return data.forks.find((f) => f.replayForkId === id);
    },
    async listForSource(sourceRecordId) {
      const data = await load6(path);
      return data.forks.filter((f) => f.sourceRecordId === sourceRecordId);
    }
  };
}

// src/repository-analytics/manager.ts
function createRepositoryAnalyticsService(deps) {
  return new RepositoryAnalyticsManager(deps.sessions, deps.aiTracking, deps.fileIntelligence, deps.fileIndex, deps.analyticsIndex);
}

class RepositoryAnalyticsManager {
  sessions;
  aiTracking;
  fileIntelligence;
  fileIndex;
  analyticsIndex;
  constructor(sessions, aiTracking, fileIntelligence, fileIndex, analyticsIndex) {
    this.sessions = sessions;
    this.aiTracking = aiTracking;
    this.fileIntelligence = fileIntelligence;
    this.fileIndex = fileIndex;
    this.analyticsIndex = analyticsIndex;
  }
  async getSummary() {
    return this.analyticsIndex.getSummary();
  }
  async listCommits(options = {}) {
    return this.analyticsIndex.listCommits(options);
  }
  async listSessions(options = {}) {
    return this.analyticsIndex.listSessions(options);
  }
  async listFiles(options = {}) {
    return this.analyticsIndex.listFiles(options);
  }
  async rebuild() {
    const commitResult = this.aiTracking.listScoredCommits({ limit: 1e4 });
    const fileStats = await this.fileIntelligence.rebuild();
    const fileEntries = this.fileIndex.listEntries(1e5);
    const sessions = this.sessions.listSessions(1e4);
    const sessionAnalytics = aggregateSessions(sessions, fileEntries);
    const fileAnalytics = aggregateFiles(fileEntries);
    const provenance = uniqueProvenance([
      commitResult.provenance,
      fileStats.provenance === "ai_tracking" ? "file_intelligence" : mapFileProvenance(fileStats.provenance),
      ...fileEntries.length > 0 ? ["file_intelligence"] : []
    ]);
    const completenessNotes = [
      ...commitResult.completenessNotes,
      ...fileEntries.length === 0 ? ["file-intelligence index has no file rows"] : []
    ];
    return this.analyticsIndex.rebuild({
      commits: commitResult.rows,
      sessions: sessionAnalytics,
      files: fileAnalytics,
      skippedRows: fileStats.skippedSessions,
      provenance,
      completenessNotes
    });
  }
}
function aggregateSessions(sessions, entries) {
  const bySession = new Map;
  for (const entry of entries) {
    const current = bySession.get(entry.sessionId) ?? [];
    current.push(entry);
    bySession.set(entry.sessionId, current);
  }
  return sessions.map((session) => {
    const sessionId = session.localSessionId ?? session.cursorChatId ?? session.recordId;
    const rows = bySession.get(sessionId) ?? [];
    const conversationId2 = session.localSessionId ?? session.cursorChatId;
    return {
      sessionId,
      recordId: session.recordId,
      ...conversationId2 !== undefined ? { conversationId: conversationId2 } : {},
      ...session.workspacePath !== undefined ? { workspacePath: session.workspacePath } : {},
      touchedFiles: rows.filter((row) => row.operation === "touched").length,
      deletedFiles: rows.filter((row) => row.operation === "deleted").length,
      snapshots: rows.filter((row) => row.operation === "snapshot").length,
      unknownFiles: rows.filter((row) => row.operation === "unknown").length,
      provenance: rows.length > 0 ? ["file_intelligence"] : ["missing_file_intelligence"],
      completenessNotes: rows.length > 0 ? [] : ["no file-intelligence rows for session"]
    };
  }).sort((a, b) => b.touchedFiles + b.deletedFiles + b.snapshots - (a.touchedFiles + a.deletedFiles + a.snapshots) || a.sessionId.localeCompare(b.sessionId));
}
function aggregateFiles(entries) {
  const byPath = new Map;
  for (const entry of entries) {
    const current = byPath.get(entry.path.path) ?? {
      sessions: new Set,
      touchedCount: 0,
      deletedCount: 0,
      snapshotCount: 0
    };
    current.sessions.add(entry.sessionId);
    if (entry.operation === "touched") {
      current.touchedCount += 1;
    } else if (entry.operation === "deleted") {
      current.deletedCount += 1;
    } else if (entry.operation === "snapshot") {
      current.snapshotCount += 1;
    }
    if (entry.observedAt !== undefined) {
      current.firstObservedAt = current.firstObservedAt === undefined ? entry.observedAt : minIso(current.firstObservedAt, entry.observedAt);
      current.lastObservedAt = current.lastObservedAt === undefined ? entry.observedAt : maxIso(current.lastObservedAt, entry.observedAt);
    }
    byPath.set(entry.path.path, current);
  }
  return [...byPath.entries()].map(([path, value]) => ({
    path,
    sessions: value.sessions.size,
    touchedCount: value.touchedCount,
    deletedCount: value.deletedCount,
    snapshotCount: value.snapshotCount,
    ...value.firstObservedAt !== undefined ? { firstObservedAt: value.firstObservedAt } : {},
    ...value.lastObservedAt !== undefined ? { lastObservedAt: value.lastObservedAt } : {},
    provenance: ["file_intelligence"]
  })).sort((a, b) => b.touchedCount + b.deletedCount + b.snapshotCount - (a.touchedCount + a.deletedCount + a.snapshotCount) || a.path.localeCompare(b.path));
}
function mapFileProvenance(provenance) {
  if (provenance === "missing_ai_tracking") {
    return "missing_ai_tracking";
  }
  if (provenance === "missing_rows") {
    return "missing_rows";
  }
  if (provenance === "index") {
    return "file_intelligence";
  }
  return "unknown";
}
function uniqueProvenance(values) {
  return [...new Set(values)];
}
function minIso(a, b) {
  return a.localeCompare(b) <= 0 ? a : b;
}
function maxIso(a, b) {
  return a.localeCompare(b) >= 0 ? a : b;
}
// src/cursor/transcript-tail.ts
import { readFile as readFile11, stat as stat2 } from "fs/promises";
async function fileSize(path) {
  try {
    return (await stat2(path)).size;
  } catch {
    return 0;
  }
}
function waitForPoll(ms, signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve7) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve7();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve7();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function* tailTranscript(transcriptPath, options) {
  if (options.startOffset !== undefined && (!Number.isInteger(options.startOffset) || options.startOffset < 0)) {
    throw new Error("startOffset must be a non-negative integer");
  }
  const pollMs = options.pollMs ?? 250;
  let offset = options.startOffset ?? await fileSize(transcriptPath);
  let pending = "";
  let pendingByteOffset = offset;
  while (!options.signal.aborted) {
    let buffer;
    try {
      buffer = await readFile11(transcriptPath);
    } catch {
      buffer = undefined;
    }
    if (buffer !== undefined) {
      if (buffer.length < offset) {
        offset = buffer.length;
        pending = "";
        pendingByteOffset = offset;
      }
      if (buffer.length > offset) {
        const chunk = buffer.subarray(offset).toString("utf8");
        pending += chunk;
        offset = buffer.length;
        let newlineIndex = pending.indexOf(`
`);
        while (newlineIndex >= 0) {
          const rawLine = pending.slice(0, newlineIndex);
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          const lineByteLength = Buffer.byteLength(rawLine, "utf8") + 1;
          const byteOffset = pendingByteOffset;
          pendingByteOffset += lineByteLength;
          pending = pending.slice(newlineIndex + 1);
          if (line.trim().length > 0) {
            const parsed = parseTranscriptLine(line);
            if (parsed !== undefined) {
              yield { byteOffset, byteLength: lineByteLength, line: parsed };
            }
          }
          newlineIndex = pending.indexOf(`
`);
        }
      }
    }
    await waitForPoll(pollMs, options.signal);
  }
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

// src/server/event-broker.ts
function wakeSubscriber(subscriber) {
  const wake = subscriber.wake;
  subscriber.wake = undefined;
  wake?.();
}

class InMemoryEventBroker {
  latestByTopic = new Map;
  subscribersByTopic = new Map;
  publish(topic, event) {
    this.latestByTopic.set(topic, event);
    const subscribers = this.subscribersByTopic.get(topic);
    if (subscribers === undefined) {
      return;
    }
    for (const subscriber of subscribers) {
      if (subscriber.closed) {
        continue;
      }
      subscriber.queue.push(event);
      wakeSubscriber(subscriber);
    }
  }
  subscribe(topic, options, signal) {
    const subscriber = {
      queue: [],
      closed: signal.aborted,
      wake: undefined
    };
    if (!subscriber.closed && options.replay === "latest") {
      const latest = this.latestByTopic.get(topic);
      if (latest !== undefined && latest.id !== options.lastEventId) {
        subscriber.queue.push(latest);
      }
    }
    if (!subscriber.closed) {
      let subscribers = this.subscribersByTopic.get(topic);
      if (subscribers === undefined) {
        subscribers = new Set;
        this.subscribersByTopic.set(topic, subscribers);
      }
      subscribers.add(subscriber);
    }
    const cleanup = () => {
      if (subscriber.closed) {
        return;
      }
      subscriber.closed = true;
      const subscribers = this.subscribersByTopic.get(topic);
      subscribers?.delete(subscriber);
      if (subscribers?.size === 0) {
        this.subscribersByTopic.delete(topic);
      }
      wakeSubscriber(subscriber);
    };
    signal.addEventListener("abort", cleanup, { once: true });
    const self = this;
    async function* iterator() {
      try {
        while (true) {
          const next = subscriber.queue.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (subscriber.closed) {
            return;
          }
          await new Promise((resolve7) => {
            subscriber.wake = resolve7;
          });
        }
      } finally {
        signal.removeEventListener("abort", cleanup);
        cleanup();
        self.removeTopicIfEmpty(topic);
      }
    }
    return iterator();
  }
  subscriberCount(topic) {
    return this.subscribersByTopic.get(topic)?.size ?? 0;
  }
  removeTopicIfEmpty(topic) {
    const subscribers = this.subscribersByTopic.get(topic);
    if (subscribers?.size === 0) {
      this.subscribersByTopic.delete(topic);
    }
  }
}
function createEventBroker() {
  return new InMemoryEventBroker;
}

// src/server/event-streams.ts
var DEFAULT_STREAM_POLL_MS = 1000;
function waitForPoll2(ms, signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve7) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve7();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve7();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function sessionEventId(session, byteOffset) {
  return `session:${session.recordId}:${byteOffset}`;
}
function transcriptEventName(role) {
  return role === "user" ? "session.user_message" : "session.assistant_message";
}
async function* pollLatest(signal, pollMs, load7) {
  while (!signal.aborted) {
    yield await load7();
    await waitForPoll2(pollMs, signal);
  }
}
function createEventStreamService(dependencies) {
  const activity = dependencies.activity ?? createActivityManager({ sessions: dependencies.sessions });
  const broker = dependencies.broker ?? createEventBroker();
  const getGroup2 = dependencies.getGroup ?? getGroup;
  const getQueue2 = dependencies.getQueue ?? getQueue;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pollMs = dependencies.pollMs ?? DEFAULT_STREAM_POLL_MS;
  const publishersByTopic = new Map;
  function brokeredTopic(topic, options, signal, source) {
    const subscription = broker.subscribe(topic, options, signal);
    let publisher = publishersByTopic.get(topic);
    if (publisher === undefined) {
      const controller = new AbortController;
      publisher = { controller, refs: 0 };
      publishersByTopic.set(topic, publisher);
      (async () => {
        try {
          for await (const event of source(controller.signal)) {
            if (controller.signal.aborted) {
              break;
            }
            broker.publish(topic, event);
          }
        } catch {} finally {
          publishersByTopic.delete(topic);
        }
      })();
    }
    publisher.refs += 1;
    return async function* () {
      try {
        for await (const event of subscription) {
          if (event.id !== options.lastEventId) {
            yield event;
          }
        }
      } finally {
        publisher.refs -= 1;
        if (publisher.refs <= 0) {
          publisher.controller.abort();
          publishersByTopic.delete(topic);
        }
      }
    }();
  }
  function sessionTopic(id, options) {
    return `session:${id}:${options.startOffset ?? "tail"}`;
  }
  async function resolveSession(id) {
    await dependencies.sessions.importTranscriptsFromFilesystem();
    return dependencies.sessions.resolveSessionKey(id);
  }
  async function* watchMaterializingSession(id, pendingSession, options, signal) {
    yield createServerEventEnvelope("session.pending", { session: pendingSession }, {
      id: `session:${pendingSession.recordId}:pending`,
      emittedAt: now()
    });
    while (!signal.aborted) {
      await waitForPoll2(pollMs, signal);
      const materialized = await resolveSession(id);
      if (materialized?.transcriptPath === undefined || materialized.recordId !== pendingSession.recordId) {
        continue;
      }
      yield createServerEventEnvelope("session.materialized", { previousSession: pendingSession, session: materialized }, {
        id: `session:${materialized.recordId}:materialized`,
        emittedAt: now()
      });
      yield* watchTranscriptSession(materialized, options, signal);
      return;
    }
  }
  async function* watchTranscriptSession(session, options, signal) {
    if (session.transcriptPath === undefined) {
      return;
    }
    for await (const event of tailTranscript(session.transcriptPath, {
      ...options.startOffset !== undefined ? { startOffset: options.startOffset } : {},
      pollMs,
      signal
    })) {
      yield createServerEventEnvelope(transcriptEventName(event.line.role), {
        session,
        byteOffset: event.byteOffset,
        byteLength: event.byteLength,
        message: event.line.message
      }, {
        id: sessionEventId(session, event.byteOffset),
        emittedAt: now()
      });
    }
  }
  return {
    async* watchSession(id, options, signal) {
      const session = await resolveSession(id);
      if (session === undefined) {
        throw new HttpError("NOT_FOUND", "session not found");
      }
      yield* brokeredTopic(sessionTopic(id, options), options, signal, (s) => session.transcriptPath === undefined ? watchMaterializingSession(id, session, options, s) : watchTranscriptSession(session, options, s));
    },
    async* watchActivity(id, options, signal) {
      if (id !== undefined && await activity.getSessionActivity(id) === null) {
        throw new HttpError("NOT_FOUND", "session not found");
      }
      yield* brokeredTopic(`activity:${id ?? "all"}`, options, signal, (s) => async function* () {
        for await (const activities of pollLatest(s, pollMs, async () => {
          if (id === undefined) {
            return activity.listActivity();
          }
          const one = await activity.getSessionActivity(id);
          if (one === null) {
            throw new HttpError("NOT_FOUND", "session not found");
          }
          return [one];
        })) {
          yield createServerEventEnvelope("activity.updated", {
            ...id !== undefined ? { sessionId: id } : {},
            activities,
            provenance: "derived"
          }, { id: `activity:${id ?? "all"}:${now()}`, emittedAt: now() });
        }
      }());
    },
    async* watchGroup(name, options, signal) {
      if (await getGroup2(name) === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      yield* brokeredTopic(`group:${name}`, options, signal, (s) => async function* () {
        for await (const snapshot of pollLatest(s, pollMs, async () => {
          const group = await getGroup2(name);
          if (group === undefined) {
            throw new HttpError("NOT_FOUND", "group not found");
          }
          return deriveGroupProgressSnapshot(group, {
            getActivity: activity.getSessionActivity,
            now
          });
        })) {
          yield createServerEventEnvelope("group.progress", snapshot, {
            id: `group:${name}:${snapshot.updatedAt}`,
            emittedAt: now()
          });
        }
      }());
    },
    async* watchQueue(name, options, signal) {
      if (await getQueue2(name) === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      yield* brokeredTopic(`queue:${name}`, options, signal, (s) => async function* () {
        for await (const snapshot of pollLatest(s, pollMs, async () => {
          const queue = await getQueue2(name);
          if (queue === undefined) {
            throw new HttpError("NOT_FOUND", "queue not found");
          }
          return deriveQueueProgressSnapshot(queue, {
            getActivity: activity.getSessionActivity,
            now
          });
        })) {
          yield createServerEventEnvelope("queue.progress", snapshot, {
            id: `queue:${name}:${snapshot.updatedAt}`,
            emittedAt: now()
          });
        }
      }());
    }
  };
}

// src/server/permissions.ts
function routePermissionForRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/health" || pathname === "/api/version") {
    return;
  }
  if (pathname === "/api/sessions" && request.method === "POST") {
    return { permission: "session:create" };
  }
  if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/cancel")) {
    return { permission: "session:cancel" };
  }
  if (pathname === "/api/sessions" || pathname.startsWith("/api/sessions/") || pathname === "/api/search/sessions" || pathname === "/api/search/transcripts" || pathname === "/api/events/activity" || pathname.startsWith("/api/events/activity/") || pathname.startsWith("/api/events/sessions/")) {
    return { permission: "session:read" };
  }
  if (pathname.startsWith("/api/events/groups/")) {
    return { permission: "group:*" };
  }
  if (pathname.startsWith("/api/events/queues/")) {
    return { permission: "queue:*" };
  }
  if (pathname === "/api/repository/analytics") {
    return { permission: "server:read" };
  }
  if (pathname.startsWith("/api/groups")) {
    return { permission: "group:*" };
  }
  if (pathname.startsWith("/api/queues")) {
    return { permission: "queue:*" };
  }
  if (pathname === "/api/activity" || pathname.startsWith("/api/activity/")) {
    return { permission: "session:read" };
  }
  if (pathname.startsWith("/api/bookmarks")) {
    return { permission: "bookmark:*" };
  }
  if (pathname.startsWith("/api/files/")) {
    return { permission: "files:*" };
  }
  if (pathname.startsWith("/api/admin")) {
    return { permission: "server:admin" };
  }
  return;
}

// src/server/request.ts
function parsePositiveInteger(url, name, defaultValue) {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError("INVALID_REQUEST", `${name} must be a positive integer`);
  }
  return parsed;
}
function parseOptionalPositiveInteger(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) {
    return;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError("INVALID_REQUEST", `${name} must be a positive integer`);
  }
  return parsed;
}
function parseNonNegativeInteger(url, name, defaultValue) {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError("INVALID_REQUEST", `${name} must be a non-negative integer`);
  }
  return parsed;
}
function parseRequiredString(url, name) {
  const value = url.searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    throw new HttpError("INVALID_REQUEST", `${name} is required`);
  }
  return value;
}
function parseOptionalString(url, name) {
  const value = url.searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    return;
  }
  return value;
}
function parseTranscriptRole(url) {
  const role = parseOptionalString(url, "role");
  if (role === undefined) {
    return;
  }
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  throw new HttpError("INVALID_REQUEST", "role must be user, assistant, system, or tool");
}
function parseReplayMode(url, name, defaultValue) {
  const value = url.searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }
  if (value === "latest" || value === "none") {
    return value;
  }
  throw new HttpError("INVALID_REQUEST", `${name} must be latest or none`);
}

// src/server/sse.ts
var EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no"
};
function sanitizeSseField(value) {
  return value.replaceAll("\r", "").replaceAll(`
`, "");
}
function formatSseEvent(event) {
  return [
    `id: ${sanitizeSseField(event.id)}`,
    `event: ${sanitizeSseField(event.event)}`,
    `data: ${JSON.stringify(event)}`,
    "",
    ""
  ].join(`
`);
}
function createSseResponse(events, options) {
  const now = options.now ?? (() => new Date().toISOString());
  let heartbeatTimer;
  const encoder = new TextEncoder;
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const writer = {
        async write(event) {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
          } catch {
            closed = true;
            options.onCancel?.();
          }
        },
        async close() {
          if (closed) {
            return;
          }
          closed = true;
          try {
            controller.close();
          } catch {}
        }
      };
      const close = async () => {
        if (heartbeatTimer !== undefined) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        await writer?.close();
      };
      options.signal.addEventListener("abort", () => {
        close();
      }, { once: true });
      heartbeatTimer = setInterval(() => {
        writer.write(createServerEventEnvelope("server.heartbeat", { now: now() }));
      }, options.heartbeatMs);
      try {
        for await (const event of events) {
          if (options.signal.aborted) {
            break;
          }
          await writer.write(event);
        }
      } finally {
        await close();
      }
    },
    cancel() {
      closed = true;
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      options.onCancel?.();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: EVENT_STREAM_HEADERS
  });
}

// src/server/routes/events.ts
function decodeRouteParameter(raw, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError("INVALID_REQUEST", `invalid ${label}`);
  }
  if (decoded.length === 0 || decoded.includes("/")) {
    throw new HttpError("INVALID_REQUEST", `invalid ${label}`);
  }
  return decoded;
}
function createRouteAbortSignal(request) {
  const controller = new AbortController;
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, abort };
}
function getLastEventId(request, url) {
  const headerValue = request.headers.get("last-event-id");
  if (headerValue !== null && headerValue.trim().length > 0) {
    return headerValue;
  }
  return url.searchParams.get("lastEventId") ?? undefined;
}
function parseEventOptions(request, url) {
  const replay = parseReplayMode(url, "replay", "latest");
  const heartbeatMs = parsePositiveInteger(url, "heartbeatMs", 15000);
  const startOffset = url.searchParams.has("startOffset") ? parseNonNegativeInteger(url, "startOffset", 0) : undefined;
  const lastEventId = getLastEventId(request, url);
  return normalizeServerEventStreamOptions({
    replay,
    heartbeatMs,
    ...startOffset !== undefined ? { startOffset } : {},
    ...lastEventId !== undefined ? { lastEventId } : {}
  });
}
function isEventRoutePath(pathname) {
  return pathname === "/api/events/activity" || pathname.startsWith("/api/events/");
}
async function handleEventRoute(request, dependencies) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!isEventRoutePath(pathname)) {
    return;
  }
  if (request.method !== "GET") {
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  const options = parseEventOptions(request, url);
  const routeSignal = createRouteAbortSignal(request);
  let stream;
  if (pathname === "/api/events/activity") {
    stream = dependencies.streams.watchActivity(undefined, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/activity/")) {
    const id = decodeRouteParameter(pathname.slice("/api/events/activity/".length), "session id");
    if (dependencies.sessionExists !== undefined && !await dependencies.sessionExists(id)) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    stream = dependencies.streams.watchActivity(id, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/sessions/")) {
    const id = decodeRouteParameter(pathname.slice("/api/events/sessions/".length), "session id");
    if (dependencies.sessionExists !== undefined && !await dependencies.sessionExists(id)) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    stream = dependencies.streams.watchSession(id, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/groups/")) {
    const name = decodeRouteParameter(pathname.slice("/api/events/groups/".length), "group name");
    if (dependencies.groupExists !== undefined && !await dependencies.groupExists(name)) {
      throw new HttpError("NOT_FOUND", "group not found");
    }
    stream = dependencies.streams.watchGroup(name, options, routeSignal.signal);
  } else if (pathname.startsWith("/api/events/queues/")) {
    const name = decodeRouteParameter(pathname.slice("/api/events/queues/".length), "queue name");
    if (dependencies.queueExists !== undefined && !await dependencies.queueExists(name)) {
      throw new HttpError("NOT_FOUND", "queue not found");
    }
    stream = dependencies.streams.watchQueue(name, options, routeSignal.signal);
  } else {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  return createSseResponse(stream, {
    heartbeatMs: options.heartbeatMs,
    signal: routeSignal.signal,
    onCancel: routeSignal.abort
  });
}

// src/server/graphql-route.ts
function responseStatus(result) {
  const first = result.errors?.[0];
  const status = first?.extensions?.["httpStatus"];
  return typeof status === "number" && status >= 400 && status <= 599 ? status : 200;
}
function createRouteAbortSignal2(request) {
  const controller = new AbortController;
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, abort };
}
function createGraphqlStreamResponse(results, abort) {
  const encoder = new TextEncoder;
  let closed = false;
  return new Response(new ReadableStream({
    async start(controller) {
      try {
        for await (const result of results) {
          if (closed) {
            break;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(result)}
`));
        }
      } finally {
        closed = true;
        abort();
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      closed = true;
      abort();
    }
  }), {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform"
    }
  });
}
async function readGraphqlBody(request) {
  const body = await request.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("GraphQL request body must be an object");
  }
  const record = body;
  const query = record["query"] ?? record["document"];
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("GraphQL request body requires query or document");
  }
  const variables = record["variables"];
  if (variables === undefined) {
    return { document: query };
  }
  if (variables === null || typeof variables !== "object" || Array.isArray(variables)) {
    throw new Error("GraphQL variables must be an object");
  }
  return {
    document: query,
    variables
  };
}
function dispatcherFor(context, tokenPermissions) {
  return createCompatCommandDispatcher({
    sdk: createCursorAgentSdk({
      stateRoot: context.config.dataDir,
      cursorHome: context.config.cursorHome
    }),
    streams: context.streams,
    auth: {
      mode: context.config.authMode,
      ...tokenPermissions !== undefined ? { tokenPermissions } : {}
    }
  });
}
async function handleGraphqlRoute(request, context) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/graphql") {
    return;
  }
  if (context.config.compatGraphql !== true) {
    return;
  }
  if (request.method !== "POST") {
    return jsonResponse({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "method not allowed"
      }
    }, 405);
  }
  const routeSignal = createRouteAbortSignal2(request);
  try {
    const auth = await authenticateRequest(request, context.config);
    const body = await readGraphqlBody(request);
    const result = await executeGraphqlOperation({
      document: body.document,
      ...body.variables !== undefined ? { variables: body.variables } : {},
      context: {
        dataDir: context.config.dataDir,
        configDir: context.config.configDir,
        cursorHome: context.config.cursorHome,
        auth: {
          mode: auth.mode,
          ...auth.token !== undefined ? { tokenPermissions: auth.token.permissions } : {}
        },
        abortSignal: routeSignal.signal
      },
      dispatcher: dispatcherFor(context, auth.token?.permissions)
    });
    if (isGraphqlAsyncResult(result)) {
      return createGraphqlStreamResponse(result, routeSignal.abort);
    }
    return jsonResponse(result, responseStatus(result));
  } catch (error) {
    routeSignal.abort();
    const httpError = toHttpError(error);
    if (httpError.code === "UNAUTHORIZED" || httpError.code === "FORBIDDEN") {
      return errorResponse(httpError);
    }
    return jsonResponse({
      errors: [
        {
          message: error instanceof Error ? error.message : "GraphQL route failed",
          extensions: { code: "GRAPHQL_ROUTE_ERROR" }
        }
      ],
      data: null
    }, 400);
  }
}

// src/server/resource-routes.ts
import { join as join8 } from "path";
function createResourceServices(config, sessions) {
  const fileIndex = new FileIntelligenceIndex(join8(config.dataDir, "file-intelligence.db"));
  const aiDb = join8(config.cursorHome, "ai-tracking", "ai-code-tracking.db");
  const aiTracking = createAiTrackingFileReader(aiDb);
  const analyticsIndex = new RepositoryAnalyticsIndex(join8(config.dataDir, "repository-analytics.db"));
  const files = createFileIntelligenceService({
    sessions,
    aiTracking,
    index: fileIndex
  });
  const analytics = createRepositoryAnalyticsService({
    sessions,
    aiTracking: createAiTrackingAnalyticsReader(aiDb),
    fileIntelligence: files,
    fileIndex,
    analyticsIndex
  });
  return {
    bookmarks: createBookmarkManager({ sessions }),
    activity: createActivityManager({ sessions }),
    files,
    fileIndex,
    analytics
  };
}
function decodeResourceUrlSegment(raw) {
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.length === 0 || decoded.includes("/") || decoded.includes("\x00") || decoded === "." || decoded === "..") {
      throw new HttpError("INVALID_REQUEST", "invalid path segment");
    }
    return decoded;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError("INVALID_REQUEST", "invalid path segment");
  }
}
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError("INVALID_REQUEST", "invalid JSON body");
  }
}
function isRecord5(value) {
  return typeof value === "object" && value !== null;
}
function readStringField(body, key) {
  const v = body[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function readStringArrayField(body, key) {
  const v = body[key];
  if (!Array.isArray(v)) {
    return;
  }
  return v.filter((item) => typeof item === "string");
}
function httpErrorFromPersistenceMessage(message) {
  if (message.includes("already exists")) {
    return new HttpError("CONFLICT", message);
  }
  if (message.includes("not found")) {
    return new HttpError("NOT_FOUND", message);
  }
  return new HttpError("INTERNAL_ERROR", message);
}
function catchPersistence(promise) {
  return promise.catch((error) => {
    if (error instanceof Error) {
      throw httpErrorFromPersistenceMessage(error.message);
    }
    throw error;
  });
}
function isDelegatedResourcePath(pathname) {
  return pathname === "/api/repository/analytics" || pathname.startsWith("/api/groups") || pathname.startsWith("/api/queues") || pathname.startsWith("/api/bookmarks") || pathname.startsWith("/api/files/") || pathname === "/api/activity" || pathname.startsWith("/api/activity/");
}
function mapDomainError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof BookmarkInputError) {
    return new HttpError("INVALID_REQUEST", error.message);
  }
  if (error instanceof BookmarkNotFoundError) {
    return new HttpError("NOT_FOUND", error.message);
  }
  if (error instanceof FileIntelligenceNotFoundError) {
    return new HttpError("NOT_FOUND", error.message);
  }
  if (error instanceof Error) {
    return httpErrorFromPersistenceMessage(error.message);
  }
  return new HttpError("INTERNAL_ERROR", "unexpected error");
}
async function refreshSessions(repository) {
  await repository.importTranscriptsFromFilesystem();
}
function bucketSessions(sessions) {
  const byStatus = {};
  const byIdentityState = {};
  for (const s of sessions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byIdentityState[s.identityState] = (byIdentityState[s.identityState] ?? 0) + 1;
  }
  return { byStatus, byIdentityState };
}
function bucketLifecycle(records) {
  const out = {};
  for (const r of records) {
    out[r.lifecycleState] = (out[r.lifecycleState] ?? 0) + 1;
  }
  return out;
}
async function dispatchResourceRoutes(request, ctx) {
  const pathname = new URL(request.url).pathname;
  if (!isDelegatedResourcePath(pathname)) {
    return;
  }
  const { sessions, resources } = ctx;
  try {
    if (pathname === "/api/repository/analytics" && request.method === "GET") {
      await refreshSessions(sessions);
      const allSessions = sessions.listSessions(500000);
      const groups = await listGroups();
      const queues = await listQueues();
      const bookmarks = await resources.bookmarks.list();
      const activities = await resources.activity.listActivity({
        limit: 50000
      });
      const fileStats = resources.fileIndex.getStats();
      const gitSummary = await resources.analytics.getSummary();
      return jsonResponse({
        sessions: {
          total: allSessions.length,
          ...bucketSessions(allSessions),
          provenance: "index"
        },
        groups: {
          total: groups.length,
          lifecycle: bucketLifecycle(groups)
        },
        queues: {
          total: queues.length,
          lifecycle: bucketLifecycle(queues)
        },
        bookmarks: {
          total: bookmarks.length
        },
        activity: {
          total: activities.length,
          buckets: activities.reduce((acc, a) => {
            acc[a.status] = (acc[a.status] ?? 0) + 1;
            return acc;
          }, {})
        },
        fileIndex: fileStats,
        gitDerived: gitSummary,
        generatedAt: new Date().toISOString(),
        provenance: ["index", "local_stores"]
      });
    }
    if (pathname.startsWith("/api/groups")) {
      return await dispatchGroupRoutes(request, ctx);
    }
    if (pathname.startsWith("/api/queues")) {
      return await dispatchQueueRoutes(request);
    }
    if (pathname.startsWith("/api/bookmarks")) {
      await refreshSessions(sessions);
      return await dispatchBookmarkRoutes(request, resources.bookmarks);
    }
    if (pathname.startsWith("/api/files/")) {
      await refreshSessions(sessions);
      return await dispatchFileRoutes(request, resources.files);
    }
    if (pathname === "/api/activity" || pathname.startsWith("/api/activity/")) {
      await refreshSessions(sessions);
      return await dispatchActivityRoutes(request, resources.activity, sessions);
    }
    return;
  } catch (error) {
    throw mapDomainError(error);
  }
}
async function dispatchGroupRoutes(request, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const { resources } = ctx;
  if (pathname === "/api/groups") {
    if (request.method === "GET") {
      const items = await listGroups();
      return jsonResponse({
        items,
        total: items.length,
        provenance: "groups_store"
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord5(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const name = readStringField(body, "name");
      if (name === undefined) {
        throw new HttpError("INVALID_REQUEST", "name is required");
      }
      const group = await catchPersistence(createGroup(name));
      const workspaces = readStringArrayField(body, "workspaces");
      let updated = group;
      if (workspaces !== undefined) {
        for (const w of workspaces) {
          updated = await catchPersistence(addWorkspaceToGroup(name, w));
        }
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  const prefix = "/api/groups/";
  if (!pathname.startsWith(prefix)) {
    return;
  }
  const rest = pathname.slice(prefix.length);
  const segments = rest.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const groupName = decodeResourceUrlSegment(segments[0] ?? "");
  if (segments.length === 1) {
    if (request.method === "GET") {
      const group = await getGroup(groupName);
      if (group === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: group, provenance: "groups_store" });
    }
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (!isRecord5(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      let updated = await getGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      const remove = readStringArrayField(body, "removeWorkspaces");
      if (remove !== undefined) {
        for (const w of remove) {
          updated = await catchPersistence(removeWorkspaceFromGroup(groupName, w));
        }
      }
      const add = readStringArrayField(body, "addWorkspaces");
      if (add !== undefined) {
        for (const w of add) {
          updated = await catchPersistence(addWorkspaceToGroup(groupName, w));
        }
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteGroup(groupName);
      if (deleted === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({
        deleted: true,
        data: deleted,
        provenance: "groups_store"
      });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  if (segments.length === 2) {
    const action = segments[1];
    if (action === "progress") {
      if (request.method !== "GET") {
        throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
      }
      const group = await getGroup(groupName);
      if (group === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      const snapshot = await deriveGroupProgressSnapshot(group, {
        getActivity: (id) => resources.activity.getSessionActivity(id),
        now: () => new Date().toISOString()
      });
      return jsonResponse({ data: snapshot, provenance: "group_progress" });
    }
    if (action === "pause" && request.method === "POST") {
      const updated = await pauseGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (action === "resume" && request.method === "POST") {
      const updated = await resumeGroup(groupName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "group not found");
      }
      return jsonResponse({ data: updated, provenance: "groups_store" });
    }
    if (action === "runs" && request.method === "POST") {
      throw new HttpError("NOT_IMPLEMENTED", "group runs are not available via HTTP; use the CLI `group run` command");
    }
  }
  throw new HttpError("NOT_FOUND", "route not found");
}
async function dispatchQueueRoutes(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/queues") {
    if (request.method === "GET") {
      const items = await listQueues();
      return jsonResponse({
        items,
        total: items.length,
        provenance: "queues_store"
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord5(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const name = readStringField(body, "name");
      const workspace = readStringField(body, "workspace");
      if (name === undefined || workspace === undefined) {
        throw new HttpError("INVALID_REQUEST", "name and workspace are required");
      }
      const queue = await catchPersistence(createQueue(name, workspace));
      return jsonResponse({ data: queue, provenance: "queues_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  const prefix = "/api/queues/";
  if (!pathname.startsWith(prefix)) {
    return;
  }
  const rest = pathname.slice(prefix.length);
  const segments = rest.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const queueName = decodeResourceUrlSegment(segments[0] ?? "");
  if (segments.length === 1) {
    if (request.method === "GET") {
      const queue = await getQueue(queueName);
      if (queue === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: queue, provenance: "queues_store" });
    }
    if (request.method === "DELETE") {
      const deleted = await deleteQueue(queueName);
      if (deleted === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({
        deleted: true,
        data: deleted,
        provenance: "queues_store"
      });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  if (segments.length === 2 && segments[1] === "items" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isRecord5(body)) {
      throw new HttpError("INVALID_REQUEST", "expected object body");
    }
    const prompt = readStringField(body, "prompt");
    if (prompt === undefined) {
      throw new HttpError("INVALID_REQUEST", "prompt is required");
    }
    const updated = await catchPersistence(addQueueItem(queueName, prompt));
    return jsonResponse({ data: updated, provenance: "queues_store" });
  }
  if (segments.length === 3 && segments[1] === "items") {
    const itemId = decodeResourceUrlSegment(segments[2] ?? "");
    if (request.method === "PATCH") {
      const body = await readJsonBody(request);
      if (!isRecord5(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const patch = {};
      const p = readStringField(body, "prompt");
      if (p !== undefined) {
        patch.prompt = p;
      }
      const st = readStringField(body, "status");
      if (st === "pending" || st === "completed" || st === "failed" || st === "skipped" || st === "running") {
        patch.status = st;
      }
      const mode = readStringField(body, "mode");
      if (mode === "auto" || mode === "manual") {
        patch.mode = mode;
      }
      const updated = await catchPersistence(updateQueueItem(queueName, itemId, patch));
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue or item not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (request.method === "DELETE") {
      const updated = await catchPersistence(removeQueueItem(queueName, itemId));
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
  }
  if (segments.length === 4 && segments[1] === "items" && segments[3] === "move" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isRecord5(body)) {
      throw new HttpError("INVALID_REQUEST", "expected object body");
    }
    const from = body["from"];
    const to = body["to"];
    if (typeof from !== "number" || typeof to !== "number") {
      throw new HttpError("INVALID_REQUEST", "from and to must be numeric indices");
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
      throw new HttpError("INVALID_REQUEST", "invalid from/to indices");
    }
    const updated = await catchPersistence(moveQueueItem(queueName, from, to));
    if (updated === undefined) {
      throw new HttpError("NOT_FOUND", "queue not found");
    }
    return jsonResponse({ data: updated, provenance: "queues_store" });
  }
  if (segments.length === 2) {
    const action = segments[1];
    if (action === "pause" && request.method === "POST") {
      const updated = await pauseQueue(queueName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (action === "resume" && request.method === "POST") {
      const updated = await resumeQueue(queueName);
      if (updated === undefined) {
        throw new HttpError("NOT_FOUND", "queue not found");
      }
      return jsonResponse({ data: updated, provenance: "queues_store" });
    }
    if (action === "runs" && request.method === "POST") {
      throw new HttpError("NOT_IMPLEMENTED", "queue runs are not available via HTTP; use the CLI `queue run` command");
    }
  }
  throw new HttpError("NOT_FOUND", "route not found");
}
async function dispatchBookmarkRoutes(request, bookmarks) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/bookmarks") {
    if (request.method === "GET") {
      const sessionId = parseOptionalString(url, "session");
      const typeRaw = parseOptionalString(url, "type");
      const tag = parseOptionalString(url, "tag");
      if (typeRaw !== undefined && !isBookmarkType(typeRaw)) {
        throw new HttpError("INVALID_REQUEST", "invalid bookmark type filter");
      }
      const filter = sessionId === undefined && typeRaw === undefined && tag === undefined ? undefined : {
        ...sessionId !== undefined ? { sessionId } : {},
        ...typeRaw !== undefined ? { type: typeRaw } : {},
        ...tag !== undefined ? { tag } : {}
      };
      const items = await bookmarks.list(filter);
      return jsonResponse({
        items,
        total: items.length,
        provenance: "bookmarks_store"
      });
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord5(body)) {
        throw new HttpError("INVALID_REQUEST", "expected object body");
      }
      const typeField = readStringField(body, "type");
      if (typeField === undefined || !isBookmarkType(typeField)) {
        throw new HttpError("INVALID_REQUEST", "type must be one of: session, message, range");
      }
      const sessionId = readStringField(body, "sessionId");
      if (sessionId === undefined) {
        throw new HttpError("INVALID_REQUEST", "sessionId is required");
      }
      const name = readStringField(body, "name");
      if (name === undefined) {
        throw new HttpError("INVALID_REQUEST", "name is required");
      }
      const messageId = readStringField(body, "messageId");
      const fromMessageId = readStringField(body, "fromMessageId");
      const toMessageId = readStringField(body, "toMessageId");
      const description = readStringField(body, "description");
      const tags = readStringArrayField(body, "tags");
      const input = {
        type: typeField,
        sessionId,
        name,
        ...messageId !== undefined ? { messageId } : {},
        ...fromMessageId !== undefined ? { fromMessageId } : {},
        ...toMessageId !== undefined ? { toMessageId } : {},
        ...description !== undefined ? { description } : {},
        ...tags !== undefined ? { tags } : {}
      };
      const created = await bookmarks.add(input);
      return jsonResponse({ data: created, provenance: "bookmarks_store" });
    }
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  if (pathname === "/api/bookmarks/search") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const q = parseRequiredString(url, "q");
    const limit = parseOptionalPositiveInteger(url, "limit") ?? 20;
    const result = await bookmarks.search(q, { limit });
    return jsonResponse({ ...result, provenance: "bookmarks_store" });
  }
  const prefix = "/api/bookmarks/";
  if (!pathname.startsWith(prefix)) {
    return;
  }
  const id = decodeResourceUrlSegment(pathname.slice(prefix.length));
  if (id === "search" || id.includes("/")) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  if (request.method === "GET") {
    const record = await bookmarks.show(id);
    if (record === null) {
      throw new HttpError("NOT_FOUND", "bookmark not found");
    }
    return jsonResponse({ data: record, provenance: "bookmarks_store" });
  }
  if (request.method === "DELETE") {
    const ok = await bookmarks.delete(id);
    if (!ok) {
      throw new HttpError("NOT_FOUND", "bookmark not found");
    }
    return jsonResponse({
      deleted: true,
      data: { id },
      provenance: "bookmarks_store"
    });
  }
  throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
}
async function dispatchFileRoutes(request, files) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/files/rebuild") {
    if (request.method !== "POST") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const stats = await files.rebuild();
    return jsonResponse({ data: stats, provenance: "file_intelligence" });
  }
  if (pathname === "/api/files/find") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const pathQuery = parseRequiredString(url, "path");
    const result = await files.findFile(pathQuery);
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }
  const sessionsPrefix = "/api/files/sessions/";
  if (!pathname.startsWith(sessionsPrefix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const after = pathname.slice(sessionsPrefix.length);
  const parts = after.split("/").filter((s) => s.length > 0);
  if (parts.length < 1) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const sessionId = decodeResourceUrlSegment(parts[0] ?? "");
  if (parts.length === 1) {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const summary = await files.listFiles(sessionId);
    return jsonResponse({ ...summary, provenance: "file_intelligence" });
  }
  if (parts.length === 2 && parts[1] === "snapshots") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const include = parseOptionalString(url, "includeContent") === "true" || url.searchParams.get("includeContent") === "1";
    const result = await files.listSnapshots(sessionId, {
      includeContent: include
    });
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }
  if (parts.length === 2 && parts[1] === "deleted") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const result = await files.listDeleted(sessionId);
    return jsonResponse({ ...result, provenance: "file_intelligence" });
  }
  throw new HttpError("NOT_FOUND", "route not found");
}
async function dispatchActivityRoutes(request, activity, sessions) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/activity") {
    if (request.method !== "GET") {
      throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
    }
    const status = parseOptionalString(url, "status");
    const limit = parsePositiveInteger(url, "limit", 50);
    const validStatuses = new Set([
      "idle",
      "running",
      "waiting_trust",
      "waiting_input",
      "completed",
      "failed"
    ]);
    const st = status !== undefined && validStatuses.has(status) ? status : undefined;
    const items = await activity.listActivity(st === undefined ? { limit } : { status: st, limit });
    return jsonResponse({
      items,
      total: items.length,
      provenance: "activity_store"
    });
  }
  const prefix = "/api/activity/sessions/";
  if (!pathname.startsWith(prefix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const sessionId = decodeResourceUrlSegment(pathname.slice(prefix.length));
  if (sessionId.includes("/")) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  if (request.method !== "GET") {
    throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
  }
  if (sessions.resolveSessionKey(sessionId) === undefined) {
    throw new HttpError("NOT_FOUND", "session not found");
  }
  const detail = await activity.getSessionActivity(sessionId);
  if (detail === null) {
    return jsonResponse({
      sessionId,
      activity: null,
      provenance: "activity_store"
    });
  }
  return jsonResponse({ data: detail, provenance: "activity_store" });
}

// src/server/routes.ts
var API_VERSION = "v1";
function sessionIdentifierFromPath(pathname, suffix = "") {
  const prefix = "/api/sessions/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    throw new HttpError("NOT_FOUND", "route not found");
  }
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length);
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError("INVALID_REQUEST", "invalid session id");
  }
  if (decoded.length === 0 || decoded.includes("/")) {
    throw new HttpError("INVALID_REQUEST", "invalid session id");
  }
  return decoded;
}
async function refreshSessions2(repository) {
  await repository.importTranscriptsFromFilesystem();
}
async function dispatchGet(request, context) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const eventRoute = await handleEventRoute(request, {
    streams: context.streams,
    sessionExists: async (id) => {
      await refreshSessions2(context.sessions);
      return context.sessions.resolveSessionKey(id) !== undefined;
    },
    groupExists: async (name) => await getGroup(name) !== undefined,
    queueExists: async (name) => await getQueue(name) !== undefined
  });
  if (eventRoute !== undefined) {
    return eventRoute;
  }
  if (pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - context.startedAt.getTime()) / 1000)),
      startedAt: context.startedAt.toISOString(),
      now: new Date().toISOString(),
      version: context.config.packageVersion
    });
  }
  if (pathname === "/api/version") {
    return jsonResponse({
      packageName: "cursor-cli-agent",
      packageVersion: context.config.packageVersion,
      apiVersion: API_VERSION
    });
  }
  if (pathname === "/api/sessions") {
    await refreshSessions2(context.sessions);
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const workspace = parseOptionalString(url, "workspace");
    const sessions = workspace === undefined ? context.sessions.listSessions(limit + offset) : context.sessions.listSessionsForWorkspace(workspace, limit + offset);
    return jsonResponse({
      sessions: sessions.slice(offset, offset + limit),
      total: sessions.length,
      offset,
      limit,
      provenance: "index"
    });
  }
  if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/messages")) {
    await refreshSessions2(context.sessions);
    const sessionId = sessionIdentifierFromPath(pathname, "/messages");
    const session = context.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    if (session.transcriptPath === undefined) {
      return jsonResponse({
        session,
        messages: [],
        total: 0,
        provenance: "transcript"
      });
    }
    const transcript = await readTranscriptFile(session.transcriptPath);
    return jsonResponse({
      session,
      messages: transcript.lines.map((line, index) => ({
        id: `event-${index}-${line.role}`,
        role: line.role,
        message: line.message
      })),
      total: transcript.lines.length,
      provenance: "transcript"
    });
  }
  if (pathname.startsWith("/api/sessions/")) {
    await refreshSessions2(context.sessions);
    const sessionId = sessionIdentifierFromPath(pathname);
    const session = context.sessions.resolveSessionKey(sessionId);
    if (session === undefined) {
      throw new HttpError("NOT_FOUND", "session not found");
    }
    return jsonResponse({ session, provenance: "index" });
  }
  if (pathname === "/api/search/sessions") {
    await refreshSessions2(context.sessions);
    const q = parseRequiredString(url, "q");
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const workspace = parseOptionalString(url, "workspace");
    const result = context.sessions.searchSessions({
      query: q,
      limit,
      offset,
      filters: {
        ...workspace !== undefined ? { workspace } : {}
      }
    });
    return jsonResponse(result);
  }
  if (pathname === "/api/search/transcripts") {
    await refreshSessions2(context.sessions);
    const q = parseRequiredString(url, "q");
    const limit = parsePositiveInteger(url, "limit", 20);
    const offset = parseNonNegativeInteger(url, "offset", 0);
    const sessionId = parseOptionalString(url, "session");
    const role = parseTranscriptRole(url);
    const maxSessions = parseOptionalPositiveInteger(url, "maxSessions");
    const maxBytes = parseOptionalPositiveInteger(url, "maxBytes");
    const maxEvents = parseOptionalPositiveInteger(url, "maxEvents");
    const result = await createTranscriptSearchService(context.sessions).search({
      query: q,
      limit,
      offset,
      timeoutMs: DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
      ...sessionId !== undefined ? { sessionId } : {},
      ...role !== undefined ? { role } : {},
      ...maxSessions !== undefined ? { maxSessions } : {},
      ...maxBytes !== undefined ? { maxBytes } : {},
      ...maxEvents !== undefined ? { maxEvents } : {}
    });
    return jsonResponse(result);
  }
  throw new HttpError("NOT_FOUND", "route not found");
}
function isKnownPath(pathname) {
  return pathname === "/api/health" || pathname === "/api/version" || pathname === "/api/sessions" || pathname.startsWith("/api/sessions/") || isEventRoutePath(pathname) || pathname === "/api/search/sessions" || pathname === "/api/search/transcripts" || isDelegatedResourcePath(pathname);
}
function createHttpRouteHandler(context) {
  const resources = context.resources ?? createResourceServices(context.config, context.sessions);
  const resolvedContext = {
    ...context,
    streams: context.streams ?? createEventStreamService({ sessions: context.sessions }),
    resources
  };
  return async (request) => {
    try {
      const graphqlRoute = await handleGraphqlRoute(request, {
        config: resolvedContext.config,
        streams: resolvedContext.streams
      });
      if (graphqlRoute !== undefined) {
        return graphqlRoute;
      }
      const appServerCompatRoute = await handleAppServerCompatRoute(request, {
        config: resolvedContext.config,
        streams: resolvedContext.streams
      });
      if (appServerCompatRoute !== undefined) {
        return appServerCompatRoute;
      }
      const permission = routePermissionForRequest(request);
      if (permission !== undefined) {
        const auth = await authenticateRequest(request, resolvedContext.config);
        requireAuthPermission(auth, permission.permission);
      }
      const resourceResponse = await dispatchResourceRoutes(request, {
        config: resolvedContext.config,
        startedAt: resolvedContext.startedAt,
        sessions: resolvedContext.sessions,
        resources: resolvedContext.resources
      });
      if (resourceResponse !== undefined) {
        return resourceResponse;
      }
      const url = new URL(request.url);
      if (request.method !== "GET" && isKnownPath(url.pathname)) {
        throw new HttpError("METHOD_NOT_ALLOWED", "method not allowed");
      }
      if (request.method !== "GET") {
        throw new HttpError("NOT_FOUND", "route not found");
      }
      return await dispatchGet(request, resolvedContext);
    } catch (error) {
      return errorResponse(toHttpError(error));
    }
  };
}
// src/server/server.ts
import { mkdirSync as mkdirSync10 } from "fs";
import { createServer } from "net";
import { join as join9 } from "path";
async function resolveListenPort(port, host) {
  if (port !== 0) {
    return port;
  }
  return await new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, host, () => {
      const address = probe.address();
      probe.close((error) => {
        if (error !== undefined) {
          rejectPort(error);
          return;
        }
        if (typeof address === "object" && address !== null) {
          resolvePort(address.port);
          return;
        }
        rejectPort(new Error("failed to allocate server port"));
      });
    });
  });
}
async function startHttpServer(config) {
  mkdirSync10(config.dataDir, { recursive: true });
  const sessions = new SessionIndexRepository(join9(config.dataDir, "state.db"));
  let server;
  try {
    const startedAt = new Date;
    const listenPort = await resolveListenPort(config.port, config.host);
    server = Bun.serve({
      hostname: config.host,
      port: listenPort,
      fetch: createHttpRouteHandler({ config, startedAt, sessions })
    });
  } catch (error) {
    sessions.close();
    throw error;
  }
  const host = server.hostname;
  const port = server.port;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    async stop() {
      server.stop(true);
      sessions.close();
    }
  };
}
// src/server/types.ts
var LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function isLoopbackHost(host) {
  if (LOOPBACK_HOSTS.has(host)) {
    return true;
  }
  if (host.startsWith("127.")) {
    return true;
  }
  return host === "0:0:0:0:0:0:0:1";
}
function resolveHttpServerConfig(input = {}) {
  const host = input.host ?? "127.0.0.1";
  const token = input.token ?? process.env["CURSOR_CLI_AGENT_SERVER_TOKEN"] ?? undefined;
  if (!isLoopbackHost(host) && token === undefined) {
    throw new Error("server token is required for non-loopback hosts");
  }
  return {
    host,
    port: input.port ?? 0,
    dataDir: getDataDir(),
    configDir: getConfigDir(),
    cursorHome: getCursorHome(),
    ...token !== undefined ? { token } : {},
    authMode: token === undefined ? "disabled" : "required",
    ...input.compatGraphql === true ? { compatGraphql: true } : {},
    packageVersion: package_default.version
  };
}
// src/cli/graphql.ts
import { existsSync as existsSync3 } from "fs";
import { readFile as readFile12 } from "fs/promises";
import { resolve as resolve7 } from "path";
function parseFlags(argv) {
  const rest = [];
  const flags = {};
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { rest, flags };
}
function isDocument(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith("query") || trimmed.startsWith("mutation") || trimmed.startsWith("subscription") || trimmed.startsWith("{") || trimmed.startsWith("#");
}
function documentForShorthand(command) {
  const kind = preferredCompatOperationKind(command);
  if (kind === undefined) {
    return;
  }
  const operation = kind === "query" ? "query" : kind;
  return `${operation} ($param: JSON) { command(name: "${command}", params: $param) }`;
}
async function readJsonValue(value) {
  const path = value.startsWith("@") && value.length > 1 ? resolve7(value.slice(1)) : existsSync3(resolve7(value)) ? resolve7(value) : undefined;
  const raw = path === undefined ? value : await readFile12(path, "utf8");
  return JSON.parse(raw);
}
function asVariables(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--variables must resolve to a JSON object");
  }
  return value;
}
function printResult(result, pretty) {
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}
async function runGraphqlCli(args, options = {}) {
  const { rest, flags } = parseFlags(args);
  const input = rest[0];
  if (input === undefined || input.trim().length === 0) {
    console.error("graphql: missing document or command");
    return 2;
  }
  if (rest.length > 1) {
    console.error("graphql: unexpected positional arguments");
    return 2;
  }
  const paramFlag = flags["param"];
  const variablesFlag = flags["variables"];
  if (paramFlag !== undefined && typeof paramFlag !== "string") {
    console.error("graphql: --param requires JSON or @path");
    return 2;
  }
  if (variablesFlag !== undefined && typeof variablesFlag !== "string") {
    console.error("graphql: --variables requires JSON or @path");
    return 2;
  }
  let variables;
  try {
    if (variablesFlag !== undefined) {
      variables = asVariables(await readJsonValue(variablesFlag));
    }
    if (paramFlag !== undefined) {
      variables = {
        ...variables ?? {},
        param: await readJsonValue(paramFlag)
      };
    }
  } catch (error) {
    console.error(error instanceof Error ? `graphql: ${error.message}` : "graphql: failed to parse JSON");
    return 2;
  }
  const document = isDocument(input) ? input : documentForShorthand(input);
  if (document === undefined) {
    console.error(`graphql: unknown shorthand command: ${input}`);
    return 2;
  }
  const dispatcher = createDefaultCompatCommandDispatcher({
    workspace: options.workspace,
    dataDir: options.dataDir,
    configDir: options.configDir,
    cursorHome: options.cursorHome,
    auth: { mode: "disabled" }
  });
  const result = await executeGraphqlOperation({
    document,
    ...variables !== undefined ? { variables } : {},
    context: {
      workspace: options.workspace,
      dataDir: options.dataDir,
      configDir: options.configDir,
      cursorHome: options.cursorHome,
      auth: { mode: "disabled" }
    },
    dispatcher
  });
  if (isGraphqlAsyncResult(result)) {
    for await (const item of result) {
      console.log(JSON.stringify(item));
    }
    return 0;
  }
  printResult(result, flags["json"] === true);
  return result.errors === undefined || result.errors.length === 0 ? 0 : 1;
}

// src/cursor/usage-events.ts
import { createHash as createHash4 } from "crypto";
function clampNonNegative(n) {
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}
function tokenTotals(usage) {
  const inputTokens = clampNonNegative(usage.inputTokens ?? 0);
  const outputTokens = clampNonNegative(usage.outputTokens ?? 0);
  const cacheReadTokens = clampNonNegative(usage.cacheReadTokens ?? 0);
  const cacheWriteTokens = clampNonNegative(usage.cacheWriteTokens ?? 0);
  const summed = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const explicit = usage.totalTokens;
  let totalTokens;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    totalTokens = clampNonNegative(explicit);
  } else {
    totalTokens = summed;
  }
  const hasPositive = totalTokens > 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    hasPositive
  };
}
function stableEventId(parts) {
  const payload = JSON.stringify(parts);
  return createHash4("sha256").update(payload).digest("hex");
}
function createUsageEventExtractor() {
  return {
    fromAgentEvent(event, context) {
      if (event.type !== "session.completed") {
        return null;
      }
      const usage = event.usage;
      if (usage === undefined) {
        return null;
      }
      const totals = tokenTotals(usage);
      if (!totals.hasPositive) {
        return null;
      }
      const model = context.model !== undefined && context.model.trim().length > 0 ? context.model.trim() : "unknown";
      const resultFingerprint = createHash4("sha256").update(event.result).digest("hex");
      const {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens
      } = totals;
      const source = "stream_result";
      const eventId = stableEventId({
        sessionId: context.sessionId,
        source,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        model,
        resultFingerprint
      });
      return {
        eventId,
        sessionId: context.sessionId,
        ...context.recordId !== undefined ? { recordId: context.recordId } : {},
        ...context.cursorChatId !== undefined ? { cursorChatId: context.cursorChatId } : {},
        ...context.workspacePath !== undefined ? { workspacePath: context.workspacePath } : {},
        ...context.workspaceSlug !== undefined ? { workspaceSlug: context.workspaceSlug } : {},
        model,
        observedAt: context.observedAt,
        source,
        provenance: "repository_usage_events",
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens
      };
    }
  };
}

// src/cli/usage-persistence-chain.ts
function createUsagePersistenceChain(repo, options) {
  const store = options?.store ?? createUsageEventStore();
  const onPersistError = options?.onPersistError;
  const extractor = createUsageEventExtractor();
  const streamModels = new Map;
  let chain = Promise.resolve();
  const capture = (events, fallbackSessionId) => {
    const observedAt = new Date().toISOString();
    for (const event of events) {
      if (event.type === "session.started" && event.model !== undefined) {
        streamModels.set(event.sessionId, event.model);
      }
    }
    const pendingRows = [];
    for (const event of events) {
      if (event.type !== "session.completed") {
        continue;
      }
      const sid = sessionIdFromEvent(event) ?? fallbackSessionId;
      if (sid === undefined) {
        continue;
      }
      const rec = repo.resolveSessionKey(sid);
      const streamModel = streamModels.get(sid);
      const row = extractor.fromAgentEvent(event, {
        sessionId: sid,
        observedAt,
        ...rec?.recordId !== undefined ? { recordId: rec.recordId } : {},
        ...rec?.cursorChatId !== undefined ? { cursorChatId: rec.cursorChatId } : {},
        ...rec?.workspacePath !== undefined ? { workspacePath: rec.workspacePath } : {},
        ...rec?.workspaceSlug !== undefined ? { workspaceSlug: rec.workspaceSlug } : {},
        ...streamModel !== undefined ? { model: streamModel } : rec?.model !== undefined ? { model: rec.model } : {}
      });
      if (row === null) {
        streamModels.delete(sid);
        continue;
      }
      pendingRows.push(row);
      streamModels.delete(sid);
    }
    if (pendingRows.length > 0) {
      chain = chain.then(() => store.upsertEvents(pendingRows).catch((error) => {
        try {
          onPersistError?.(error);
        } catch {}
      }));
    }
  };
  return {
    capture,
    flush: async () => {
      for (;; ) {
        const pending = chain;
        await pending;
        if (pending === chain) {
          break;
        }
      }
      streamModels.clear();
    }
  };
}

// src/daemon/manager.ts
import { spawn as spawn3 } from "child_process";
import { randomUUID as randomUUID15 } from "crypto";
import { existsSync as existsSync4 } from "fs";
import { mkdir as mkdir3, appendFile } from "fs/promises";
import { dirname as dirname12, resolve as resolve8 } from "path";
import { fileURLToPath } from "url";

// src/persistence/daemon-metadata-store.ts
import { constants as constants2 } from "fs";
import { mkdir as mkdir2, readFile as readFile13, rename as rename6, rm, writeFile as writeFile8 } from "fs/promises";
import { randomUUID as randomUUID14 } from "crypto";
import { dirname as dirname11 } from "path";
function isMissingFile2(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function isDaemonState(value) {
  return value === "starting" || value === "running" || value === "stopping" || value === "failed";
}
function validateMetadata(value) {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value;
  const auth = record["auth"];
  if (typeof auth !== "object" || auth === null) {
    return;
  }
  const authRecord = auth;
  if (record["schemaVersion"] !== 1 || !isDaemonState(record["state"]) || typeof record["pid"] !== "number" || !Number.isInteger(record["pid"]) || typeof record["parentPid"] !== "number" || !Number.isInteger(record["parentPid"]) || typeof record["marker"] !== "string" || typeof record["commandPath"] !== "string" || typeof record["host"] !== "string" || typeof record["port"] !== "number" || !Number.isInteger(record["port"]) || typeof record["baseUrl"] !== "string" || typeof record["dataDir"] !== "string" || typeof record["configDir"] !== "string" || record["serverMode"] !== "http" || typeof record["startedAt"] !== "string" || record["lastCheckedAt"] !== undefined && typeof record["lastCheckedAt"] !== "string" || authRecord["mode"] !== "disabled" && authRecord["mode"] !== "required" || typeof authRecord["tokenConfigured"] !== "boolean") {
    return;
  }
  return value;
}
function createFileDaemonMetadataStore(options = {}) {
  const path = options.path ?? daemonMetadataPath();
  return {
    async read() {
      let raw;
      try {
        raw = await readFile13(path, "utf8");
      } catch (error) {
        if (isMissingFile2(error)) {
          return { status: "missing" };
        }
        return {
          status: "malformed",
          diagnostic: error instanceof Error ? error.message : "failed to read metadata"
        };
      }
      try {
        const parsed = JSON.parse(raw);
        const metadata = validateMetadata(parsed);
        if (metadata === undefined) {
          return { status: "malformed", diagnostic: "invalid metadata shape" };
        }
        return { status: "valid", metadata };
      } catch (error) {
        return {
          status: "malformed",
          diagnostic: error instanceof Error ? error.message : "invalid metadata JSON"
        };
      }
    },
    async write(metadata) {
      await mkdir2(dirname11(path), { recursive: true });
      const tmpPath = `${path}.tmp.${randomUUID14()}`;
      await writeFile8(tmpPath, `${JSON.stringify(metadata, null, 2)}
`, {
        encoding: "utf8",
        mode: constants2.S_IRUSR | constants2.S_IWUSR
      });
      await rename6(tmpPath, path);
    },
    async remove() {
      await rm(path, { force: true });
    }
  };
}

// src/daemon/process.ts
import { readFile as readFile14 } from "fs/promises";
async function sleep(ms) {
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
async function readProcField(pid, field) {
  try {
    const raw = await readFile14(`/proc/${pid}/${field}`);
    return raw.toString("utf8");
  } catch {
    return;
  }
}
function createNodeProcessInspector(deps = {}) {
  const signal = deps.signalProcess ?? signalProcess;
  const readProc = deps.readProcField ?? readProcField;
  const wait = deps.sleep ?? sleep;
  return {
    async isAlive(pid) {
      if (!Number.isInteger(pid) || pid <= 0) {
        return false;
      }
      return signal(pid, 0);
    },
    async matchesOwner(metadata) {
      if (!await this.isAlive(metadata.pid)) {
        return false;
      }
      const environ = await readProc(metadata.pid, "environ");
      if (environ === undefined) {
        return false;
      }
      const entries = environ.split("\x00");
      return entries.includes(`CURSOR_CLI_AGENT_DAEMON_MARKER=${metadata.marker}`);
    },
    async terminate(metadata, options = {}) {
      if (!await this.matchesOwner(metadata)) {
        return {
          state: "stale",
          stopped: false,
          metadata,
          staleReason: "process owner marker did not match"
        };
      }
      if (!await this.isAlive(metadata.pid)) {
        return { state: "stopped", stopped: true, metadata };
      }
      signal(metadata.pid, "SIGTERM");
      const deadline = Date.now() + (options.timeoutMs ?? 5000);
      while (Date.now() < deadline) {
        if (!await this.isAlive(metadata.pid)) {
          return { state: "stopped", stopped: true, metadata };
        }
        await wait(25);
      }
      return {
        state: "failed",
        stopped: false,
        metadata,
        reason: "process did not exit before timeout"
      };
    }
  };
}

// src/daemon/readiness.ts
async function sleep2(ms) {
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
function createHttpDaemonReadinessProbe() {
  return {
    async waitUntilReady(options) {
      const deadline = Date.now() + options.timeoutMs;
      let lastError;
      while (Date.now() <= deadline) {
        try {
          const headers = new Headers;
          if (options.token !== undefined) {
            headers.set("authorization", `Bearer ${options.token}`);
          }
          const response = await fetch(`${options.baseUrl}/api/health`, {
            method: "GET",
            headers
          });
          if (response.ok) {
            return { ready: true, statusCode: response.status };
          }
          if (response.status === 401 || response.status === 403) {
            return {
              ready: false,
              reason: "unauthorized",
              statusCode: response.status
            };
          }
          lastError = `HTTP ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "health probe failed";
        }
        await sleep2(options.intervalMs);
      }
      return {
        ready: false,
        reason: "timeout",
        ...lastError !== undefined ? { error: lastError } : {}
      };
    }
  };
}

// src/daemon/manager.ts
function buildCliServerArgs(options) {
  const args = [
    "run",
    options.cliEntrypoint ?? resolveCliServerEntrypoint(),
    "server",
    "start",
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--json"
  ];
  if (options.token !== undefined) {
    args.push("--token", options.token);
  }
  return args;
}
function isBinEntrypoint(path) {
  return /(?:^|[/\\])bin\.(?:ts|js)$/.test(path);
}
function resolveCliServerEntrypoint() {
  const argvEntrypoint = process.argv[1];
  if (argvEntrypoint !== undefined && isBinEntrypoint(argvEntrypoint)) {
    return resolve8(argvEntrypoint);
  }
  const sourceEntrypoint = fileURLToPath(new URL("../bin.ts", import.meta.url));
  if (existsSync4(sourceEntrypoint)) {
    return sourceEntrypoint;
  }
  return fileURLToPath(new URL("../bin.js", import.meta.url));
}
function isServerStdoutResult(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value;
  return typeof record["host"] === "string" && typeof record["port"] === "number" && typeof record["url"] === "string";
}
async function waitForServerStdout(child, timeoutMs) {
  return await new Promise((resolveReady, rejectReady) => {
    let buffer = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectReady(new Error("server did not report readiness before timeout"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }
        try {
          const parsed = JSON.parse(line);
          if (isServerStdoutResult(parsed)) {
            cleanup();
            resolveReady(parsed);
            return;
          }
        } catch {}
      }
    };
    const onStderr = (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        stderr = `${stderr}${stderr.length > 0 ? `
` : ""}${text}`;
      }
    };
    const onExit = (code) => {
      cleanup();
      rejectReady(new Error(`server exited before readiness: ${code ?? "signal"}${stderr.length > 0 ? `: ${stderr}` : ""}`));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}
async function spawnCliServer(options) {
  const args = buildCliServerArgs(options);
  const child = spawn3(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      CURSOR_CLI_AGENT_DAEMON_MARKER: options.marker
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (child.pid === undefined) {
    throw new Error("failed to spawn daemon server process");
  }
  const pid = child.pid;
  const ready = await waitForServerStdout(child, 5000);
  child.unref();
  return {
    pid,
    commandPath: process.execPath,
    host: ready.host,
    port: ready.port,
    baseUrl: ready.url,
    async terminate() {
      process.kill(pid, "SIGTERM");
    }
  };
}
function metadataWithCheck(metadata, now) {
  return {
    ...metadata,
    lastCheckedAt: now.toISOString()
  };
}
async function appendLifecycleLog(path, event) {
  await mkdir3(dirname12(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}
`, "utf8");
}
function createDaemonManager(deps = {}) {
  const store = deps.store ?? createFileDaemonMetadataStore();
  const processInspector = deps.processInspector ?? createNodeProcessInspector();
  const readinessProbe = deps.readinessProbe ?? createHttpDaemonReadinessProbe();
  const spawnServer = deps.spawnServer ?? spawnCliServer;
  const lifecycleLogPath = deps.lifecycleLogPath ?? daemonLifecycleLogPath();
  const now = deps.now ?? (() => new Date);
  async function statusFromRead(read, options = {}) {
    if (read.status === "missing") {
      return { state: "stopped" };
    }
    if (read.status === "malformed") {
      return { state: "stale", staleReason: read.diagnostic };
    }
    const metadata = metadataWithCheck(read.metadata, now());
    if (!await processInspector.isAlive(metadata.pid)) {
      return {
        state: "stale",
        metadata,
        staleReason: "process is not running"
      };
    }
    if (!await processInspector.matchesOwner(metadata)) {
      return {
        state: "stale",
        metadata,
        staleReason: "process owner marker did not match"
      };
    }
    if (options.checkReadiness !== false && metadata.state === "running") {
      const token = metadata.auth.mode === "required" ? options.token ?? process.env["CURSOR_CLI_AGENT_SERVER_TOKEN"] : undefined;
      const readiness = await readinessProbe.waitUntilReady({
        baseUrl: metadata.baseUrl,
        ...token !== undefined ? { token } : {},
        timeoutMs: 500,
        intervalMs: 50
      });
      if (!readiness.ready) {
        return {
          state: "stale",
          metadata,
          staleReason: `health probe failed: ${readiness.reason}`
        };
      }
    }
    return { state: metadata.state, metadata };
  }
  return {
    async status(options = {}) {
      return await statusFromRead(await store.read(), options);
    },
    async start(options = {}) {
      const existing = await statusFromRead(await store.read());
      if (existing.state === "running" || existing.state === "starting") {
        return {
          state: "failed",
          ...existing.metadata !== undefined ? { metadata: existing.metadata } : {},
          staleReason: "daemon is already running"
        };
      }
      if ((existing.state === "failed" || existing.state === "stopping") && existing.metadata !== undefined) {
        const stopped = await processInspector.terminate(existing.metadata, {
          ...options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}
        });
        if (stopped.state !== "stopped" || !stopped.stopped) {
          return {
            state: "failed",
            metadata: existing.metadata,
            staleReason: stopped.state === "stale" ? stopped.staleReason : stopped.reason
          };
        }
        await store.remove();
      }
      if (existing.state === "stale") {
        if (existing.metadata !== undefined) {
          const alive = await processInspector.isAlive(existing.metadata.pid);
          const owned = alive && await processInspector.matchesOwner(existing.metadata);
          if (alive && owned) {
            return {
              state: "failed",
              metadata: existing.metadata,
              staleReason: "owned process is stale but still running"
            };
          }
        }
        await store.remove();
      }
      const config = resolveHttpServerConfig({
        ...options.host !== undefined ? { host: options.host } : {},
        ...options.port !== undefined ? { port: options.port } : {},
        ...options.token !== undefined ? { token: options.token } : {}
      });
      const marker = `cursor-cli-agent-daemon-${randomUUID15()}`;
      const spawned = await spawnServer({
        host: config.host,
        port: config.port,
        ...config.token !== undefined ? { token: config.token } : {},
        marker
      });
      const startedAt = now().toISOString();
      const starting = {
        schemaVersion: 1,
        state: "starting",
        pid: spawned.pid,
        parentPid: process.pid,
        marker,
        commandPath: spawned.commandPath,
        host: spawned.host,
        port: spawned.port,
        baseUrl: spawned.baseUrl,
        dataDir: getDataDir(),
        configDir: getConfigDir(),
        serverMode: "http",
        startedAt,
        auth: {
          mode: config.token === undefined ? "disabled" : "required",
          tokenConfigured: config.token !== undefined
        }
      };
      await store.write(starting);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.starting",
        at: starting.startedAt,
        state: starting.state,
        pid: starting.pid,
        baseUrl: starting.baseUrl
      });
      const readiness = await readinessProbe.waitUntilReady({
        baseUrl: spawned.baseUrl,
        ...config.token !== undefined ? { token: config.token } : {},
        timeoutMs: options.timeoutMs ?? 5000,
        intervalMs: options.intervalMs ?? 100
      });
      if (!readiness.ready) {
        await spawned.terminate();
        const failedAt = now().toISOString();
        const failed = {
          ...starting,
          state: "failed",
          lastCheckedAt: failedAt
        };
        await store.write(failed);
        await appendLifecycleLog(lifecycleLogPath, {
          event: "daemon.failed",
          at: failedAt,
          state: failed.state,
          pid: failed.pid,
          baseUrl: failed.baseUrl,
          reason: readiness.reason
        });
        return { state: "failed", metadata: failed, readiness };
      }
      const runningAt = now().toISOString();
      const running = {
        ...starting,
        state: "running",
        lastCheckedAt: runningAt
      };
      await store.write(running);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.running",
        at: runningAt,
        state: running.state,
        pid: running.pid,
        baseUrl: running.baseUrl
      });
      return { state: "running", metadata: running, readiness };
    },
    async stop(options = {}) {
      const read = await store.read();
      if (read.status === "missing") {
        return { state: "stopped", stopped: false, reason: "not_running" };
      }
      if (read.status === "malformed") {
        await store.remove();
        return {
          state: "stale",
          stopped: false,
          staleReason: read.diagnostic
        };
      }
      const metadata = read.metadata;
      if (!await processInspector.isAlive(metadata.pid)) {
        await store.remove();
        return { state: "stopped", stopped: true, metadata };
      }
      if (!await processInspector.matchesOwner(metadata)) {
        return {
          state: "stale",
          stopped: false,
          metadata,
          staleReason: "process owner marker did not match"
        };
      }
      const stoppingAt = now().toISOString();
      const stopping = {
        ...metadata,
        state: "stopping",
        lastCheckedAt: stoppingAt
      };
      await store.write(stopping);
      await appendLifecycleLog(lifecycleLogPath, {
        event: "daemon.stopping",
        at: stoppingAt,
        state: stopping.state,
        pid: stopping.pid,
        baseUrl: stopping.baseUrl
      });
      const stopped = await processInspector.terminate(stopping, options);
      if (stopped.state === "stopped" && stopped.stopped) {
        await store.remove();
        await appendLifecycleLog(lifecycleLogPath, {
          event: "daemon.stopped",
          at: now().toISOString(),
          state: "stopped",
          pid: stopping.pid,
          baseUrl: stopping.baseUrl
        });
      }
      return stopped;
    }
  };
}

// src/cli/cli.ts
var runHeadlessStreamingImpl = runHeadlessStreaming;
var startHttpServerImpl = startHttpServer;
var daemonManagerImpl;
var EXIT = {
  OK: 0,
  ERR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CURSOR: 4,
  TRUST: 5,
  TRANSCRIPT: 6
};
function imagePathsFromFlags(flags) {
  const v = flags["images"];
  return Array.isArray(v) ? v : [];
}
function consumeImageFlagErrors(flags) {
  if (flags["image-flag-error"] === true) {
    return "--image requires a path argument";
  }
  return;
}
function emitAttachmentCliError(streamFormat, reason, message) {
  const ev = {
    type: "session.error",
    message,
    reason
  };
  if (streamFormat === "text") {
    console.error(message);
    return;
  }
  printEvents([ev], streamFormat === "json");
}
async function preparePromptAttachmentLaunchFromInputs(workspace, source, inputs, streamFormat) {
  if (inputs.length === 0) {
    return { ok: undefined, provenance: [] };
  }
  const validated = await validatePromptAttachments(inputs, {
    workspace,
    source,
    now: () => new Date
  });
  if (!validated.ok) {
    emitAttachmentCliError(streamFormat, "attachment_validation_failed", `${validated.error.detail} (${validated.error.code})`);
    return { exit: EXIT.ERR };
  }
  const cap = await probeCursorAttachmentCapabilities({
    now: () => new Date
  });
  if (cap.status !== "supported" || cap.imageFlag === undefined) {
    const reason = cap.status === "unknown" ? "attachments_capability_unknown" : "attachments_unsupported";
    emitAttachmentCliError(streamFormat, reason, cap.status === "unknown" ? "could not detect cursor-agent image attachment support from --help" : "installed cursor-agent does not advertise a compatible image attachment flag");
    return { exit: EXIT.ERR };
  }
  return {
    ok: {
      flag: cap.imageFlag,
      paths: validated.value.imagePaths
    },
    provenance: validated.value.attachments
  };
}
async function preparePromptAttachmentLaunch(workspace, source, paths, streamFormat) {
  const inputs = paths.map((path) => ({ kind: "image", path }));
  return preparePromptAttachmentLaunchFromInputs(workspace, source, inputs, streamFormat);
}
function mergeQueueItemAttachmentInputs(item, runPaths) {
  const out = item.attachments?.map((row) => ({
    kind: "image",
    path: row.resolvedPath
  })) ?? [];
  for (const p of runPaths) {
    out.push({ kind: "image", path: p });
  }
  return out;
}
function runnerPassthroughFromFlags(flags) {
  const sandbox = flags["sandbox"];
  const wt = flags["worktree"];
  const wtb = flags["worktree-base"];
  return {
    ...sandbox === "enabled" || sandbox === "disabled" ? { sandbox } : {},
    ...flags["approve-mcps"] === true ? { approveMcps: true } : {},
    ...wt === true ? { worktree: true } : typeof wt === "string" && wt.length > 0 ? { worktree: wt } : {},
    ...typeof wtb === "string" && wtb.length > 0 ? { worktreeBase: wtb } : {},
    ...flags["skip-worktree-setup"] === true ? { skipWorktreeSetup: true } : {}
  };
}
function buildHeadlessRunOptionsPartial(workspace, flags, promptImages) {
  return {
    workspace,
    ...typeof flags["model"] === "string" ? { model: flags["model"] } : {},
    ...flags["mode"] === "plan" || flags["mode"] === "ask" ? { mode: flags["mode"] } : {},
    ...flags["trust"] === true ? { trust: true } : {},
    ...flags["force"] === true ? { force: true } : {},
    ...flags["yolo"] === true ? { yolo: true } : {},
    ...flags["stream-partial-output"] === true ? { streamPartialOutput: true } : {},
    ...runnerPassthroughFromFlags(flags),
    ...promptImages !== undefined && promptImages.paths.length > 0 ? { promptImages } : {}
  };
}
function buildHeadlessRunOptions(workspace, prompt, flags, promptImages) {
  return {
    ...buildHeadlessRunOptionsPartial(workspace, flags, promptImages),
    prompt
  };
}
function buildResumeRunOptions(workspace, sessionOrChatId, flags, promptImages) {
  return {
    workspace,
    sessionOrChatId,
    ...typeof flags["prompt"] === "string" && flags["prompt"].length > 0 ? { prompt: flags["prompt"] } : {},
    ...typeof flags["model"] === "string" ? { model: flags["model"] } : {},
    ...flags["mode"] === "plan" || flags["mode"] === "ask" ? { mode: flags["mode"] } : {},
    ...flags["trust"] === true ? { trust: true } : {},
    ...flags["force"] === true ? { force: true } : {},
    ...flags["yolo"] === true ? { yolo: true } : {},
    ...flags["stream-partial-output"] === true ? { streamPartialOutput: true } : {},
    ...runnerPassthroughFromFlags(flags),
    ...promptImages !== undefined && promptImages.paths.length > 0 ? { promptImages } : {}
  };
}
function parseFlags2(argv) {
  const rest = [];
  const flags = {};
  for (let i = 0;i < argv.length; i += 1) {
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
    } else if (a === "--image") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags["image-flag-error"] = true;
      } else {
        const cur = flags["images"];
        if (Array.isArray(cur)) {
          cur.push(next);
        } else {
          flags["images"] = [next];
        }
        i += 1;
      }
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
function getWorkspace(flags) {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve9(w);
  }
  return resolve9(process.cwd());
}
function getExplicitWorkspace(flags) {
  const w = flags["workspace"];
  if (typeof w === "string" && w.length > 0) {
    return resolve9(w);
  }
  return;
}
function isSessionMode(value) {
  return value === "default" || value === "plan" || value === "ask";
}
function isSessionStatus(value) {
  return value === "pending" || value === "active" || value === "completed" || value === "failed" || value === "unknown";
}
function isActivityStatus(value) {
  return value === "idle" || value === "running" || value === "waiting_trust" || value === "waiting_input" || value === "completed" || value === "failed";
}
function isTranscriptSearchRole(value) {
  return value === "user" || value === "assistant" || value === "system" || value === "tool";
}
function parsePositiveIntegerFlag(flags, key, defaultValue) {
  const value = flags[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    return;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return;
  }
  return parsed;
}
function parseNonNegativeIntegerFlag(flags, key, defaultValue) {
  const value = flags[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    return;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return;
  }
  return parsed;
}
function parsePermissionCsvFlag(value) {
  if (value === undefined) {
    return {};
  }
  if (Array.isArray(value) || typeof value !== "string") {
    return { error: "token create: --permissions requires a CSV value" };
  }
  const parts = value.split(",");
  const invalid = invalidAuthPermissions(parts);
  if (invalid.length > 0) {
    return {
      error: `token create: invalid permissions: ${invalid.join(",")}`
    };
  }
  const permissions = normalizeAuthPermissions(parts);
  if (permissions.length === 0) {
    return { error: "token create: at least one permission is required" };
  }
  return { permissions };
}
function parseTokenCreateArgs(argv) {
  const { rest: pos, flags } = parseFlags2([...argv]);
  if (pos.length > 0) {
    return { error: "token create: unexpected positional arguments" };
  }
  const name = flags["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    return { error: "token create: --name is required" };
  }
  const parsedPermissions = parsePermissionCsvFlag(flags["permissions"]);
  if ("error" in parsedPermissions) {
    return parsedPermissions;
  }
  const expiresAt = flags["expires-at"];
  if (expiresAt !== undefined) {
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
      return {
        error: "token create: --expires-at must be a valid ISO 8601 timestamp"
      };
    }
  }
  return {
    args: {
      name,
      ...parsedPermissions,
      ...typeof expiresAt === "string" ? { expiresAt: new Date(expiresAt).toISOString() } : {},
      ...flags["json"] === true ? { json: true } : {}
    }
  };
}
function parseTcpPortFlag(flags) {
  const value = flags["port"];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}
function parseServerStartArgs(argv) {
  const { rest: pos, flags } = parseFlags2([...argv]);
  if (pos.length > 0) {
    return { error: "server start: unexpected positional arguments" };
  }
  const host = flags["host"];
  if (host !== undefined && typeof host !== "string") {
    return { error: "server start: --host requires a host" };
  }
  const token = flags["token"];
  if (token !== undefined && typeof token !== "string") {
    return { error: "server start: --token requires a token" };
  }
  const port = parseTcpPortFlag(flags);
  if (port === null) {
    return { error: "server start: --port must be an integer from 0 to 65535" };
  }
  return {
    args: {
      ...typeof host === "string" ? { host } : {},
      ...port !== undefined ? { port } : {},
      ...typeof token === "string" ? { token } : {},
      ...flags["compat-graphql"] === true ? { compatGraphql: true } : {},
      ...flags["json"] === true ? { json: true } : {}
    }
  };
}
function parseDaemonStartArgs(argv) {
  const { rest: pos, flags } = parseFlags2([...argv]);
  if (pos.length > 0) {
    return { error: "daemon start: unexpected positional arguments" };
  }
  const host = flags["host"];
  if (host !== undefined && typeof host !== "string") {
    return { error: "daemon start: --host requires a host" };
  }
  const token = flags["token"];
  if (token !== undefined && typeof token !== "string") {
    return { error: "daemon start: --token requires a token" };
  }
  const port = parseTcpPortFlag(flags);
  if (port === null) {
    return { error: "daemon start: --port must be an integer from 0 to 65535" };
  }
  const timeoutMs = parseOptionalPositiveIntegerFlag(flags, "timeout-ms");
  if (timeoutMs === null) {
    return { error: "daemon start: --timeout-ms must be a positive integer" };
  }
  return {
    args: {
      ...typeof host === "string" ? { host } : {},
      ...port !== undefined ? { port } : {},
      ...typeof token === "string" ? { token } : {},
      ...timeoutMs !== undefined ? { timeoutMs } : {},
      ...flags["json"] === true ? { json: true } : {}
    }
  };
}
function parseDaemonStopArgs(argv) {
  const { rest: pos, flags } = parseFlags2([...argv]);
  if (pos.length > 0) {
    return { error: "daemon stop: unexpected positional arguments" };
  }
  if (flags["force"] === true) {
    return { error: "daemon stop: --force is not supported" };
  }
  const timeoutMs = parseOptionalPositiveIntegerFlag(flags, "timeout-ms");
  if (timeoutMs === null) {
    return { error: "daemon stop: --timeout-ms must be a positive integer" };
  }
  return {
    args: {
      ...timeoutMs !== undefined ? { timeoutMs } : {},
      ...flags["json"] === true ? { json: true } : {}
    }
  };
}
function parseSessionSearchOptions(pos, flags) {
  const query = pos[0];
  if (query === undefined || query.trim().length === 0) {
    return { error: "session search: missing query" };
  }
  const workspace = flags["workspace"];
  if (workspace !== undefined && typeof workspace !== "string") {
    return { error: "session search: --workspace requires a path" };
  }
  const model = flags["model"];
  if (model !== undefined && typeof model !== "string") {
    return { error: "session search: --model requires a model" };
  }
  const mode = flags["mode"];
  if (mode !== undefined) {
    if (typeof mode !== "string" || !isSessionMode(mode)) {
      return { error: "session search: --mode must be default, plan, or ask" };
    }
  }
  const status = flags["status"];
  if (status !== undefined) {
    if (typeof status !== "string" || !isSessionStatus(status)) {
      return {
        error: "session search: --status must be pending, active, completed, failed, or unknown"
      };
    }
  }
  const limit = parsePositiveIntegerFlag(flags, "limit", 20);
  if (limit === undefined) {
    return { error: "session search: --limit must be a positive integer" };
  }
  const offset = parseNonNegativeIntegerFlag(flags, "offset", 0);
  if (offset === undefined) {
    return { error: "session search: --offset must be a non-negative integer" };
  }
  return {
    options: {
      query,
      limit,
      offset,
      filters: {
        ...typeof workspace === "string" ? { workspace } : {},
        ...typeof model === "string" ? { model } : {},
        ...typeof mode === "string" && isSessionMode(mode) ? { mode } : {},
        ...typeof status === "string" && isSessionStatus(status) ? { status } : {}
      }
    }
  };
}
function parseOptionalPositiveIntegerFlag(flags, key) {
  const value = flags[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
function parseTranscriptSearchOptions(pos, flags) {
  const query = pos[0];
  if (query === undefined || query.trim().length === 0) {
    return { error: "transcript search: missing query" };
  }
  const sessionId = flags["session"];
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "transcript search: --session requires an id" };
  }
  const role = flags["role"];
  if (role !== undefined) {
    if (typeof role !== "string" || !isTranscriptSearchRole(role)) {
      return {
        error: "transcript search: --role must be user, assistant, system, or tool"
      };
    }
  }
  const limit = parsePositiveIntegerFlag(flags, "limit", 20);
  if (limit === undefined) {
    return { error: "transcript search: --limit must be a positive integer" };
  }
  const offset = parseNonNegativeIntegerFlag(flags, "offset", 0);
  if (offset === undefined) {
    return {
      error: "transcript search: --offset must be a non-negative integer"
    };
  }
  const maxSessions = parseOptionalPositiveIntegerFlag(flags, "max-sessions");
  if (maxSessions === null) {
    return {
      error: "transcript search: --max-sessions must be a positive integer"
    };
  }
  const maxBytes = parseOptionalPositiveIntegerFlag(flags, "max-bytes");
  if (maxBytes === null) {
    return {
      error: "transcript search: --max-bytes must be a positive integer"
    };
  }
  const maxEvents = parseOptionalPositiveIntegerFlag(flags, "max-events");
  if (maxEvents === null) {
    return {
      error: "transcript search: --max-events must be a positive integer"
    };
  }
  return {
    options: {
      query,
      limit,
      offset,
      timeoutMs: DEFAULT_TRANSCRIPT_SEARCH_TIMEOUT_MS,
      ...typeof sessionId === "string" ? { sessionId } : {},
      ...typeof role === "string" && isTranscriptSearchRole(role) ? { role } : {},
      ...maxSessions !== undefined ? { maxSessions } : {},
      ...maxBytes !== undefined ? { maxBytes } : {},
      ...maxEvents !== undefined ? { maxEvents } : {}
    }
  };
}
function parseActivityOptions(flags) {
  const session = flags["session"];
  if (session !== undefined && typeof session !== "string") {
    return { error: "activity: --session requires an id" };
  }
  const status = flags["status"];
  if (status !== undefined) {
    if (typeof status !== "string" || !isActivityStatus(status)) {
      return {
        error: "activity: --status must be idle, running, waiting_trust, waiting_input, completed, or failed"
      };
    }
  }
  const limit = parseOptionalPositiveIntegerFlag(flags, "limit");
  if (limit === null) {
    return { error: "activity: --limit must be a positive integer" };
  }
  return {
    ...typeof session === "string" ? { session } : {},
    ...typeof status === "string" && isActivityStatus(status) ? { status } : {},
    ...limit !== undefined ? { limit } : {}
  };
}
function parseToolCommandArgs(flags) {
  const timeoutMs = parseOptionalPositiveIntegerFlag(flags, "timeout-ms");
  if (timeoutMs === null) {
    return { error: "tool: --timeout-ms must be a positive integer" };
  }
  return {
    args: {
      json: flags["json"] === true,
      ...timeoutMs !== undefined ? { timeoutMs } : {},
      ...flags["include-git"] === true ? { includeGit: true } : {},
      ...flags["include-bun"] === true ? { includeBun: true } : {}
    }
  };
}
function parseModelCheckCommandArgs(flags) {
  const model = flags["model"];
  if (typeof model !== "string" || model.trim().length === 0) {
    return { error: "model check: --model is required" };
  }
  const timeoutMs = parseOptionalPositiveIntegerFlag(flags, "timeout-ms");
  if (timeoutMs === null) {
    return { error: "model check: --timeout-ms must be a positive integer" };
  }
  return {
    args: {
      model,
      probe: flags["probe"] === true,
      json: flags["json"] === true,
      ...timeoutMs !== undefined ? { timeoutMs } : {}
    }
  };
}
function parseUsageStatsOptions(flags) {
  const recentDays = parseOptionalPositiveIntegerFlag(flags, "recent-days");
  if (recentDays === null) {
    return { error: "usage stats: --recent-days must be a positive integer" };
  }
  const workspace = flags["workspace"];
  if (workspace !== undefined && typeof workspace !== "string") {
    return { error: "usage stats: --workspace requires a path string" };
  }
  const sessionId = flags["session"];
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "usage stats: --session requires an id string" };
  }
  return {
    json: flags["json"] === true,
    options: {
      ...recentDays !== undefined ? { recentDays } : {},
      ...typeof workspace === "string" && workspace.trim().length > 0 ? { workspacePath: workspace.trim() } : {},
      ...typeof sessionId === "string" && sessionId.trim().length > 0 ? { sessionId: sessionId.trim() } : {}
    }
  };
}
function parseMarkdownTaskOptions(flags) {
  const sessionId = flags["session"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { error: "markdown tasks: --session is required" };
  }
  const messageId = flags["message"];
  if (messageId !== undefined && typeof messageId !== "string") {
    return { error: "markdown tasks: --message requires an id" };
  }
  const checked = flags["checked"];
  if (checked === undefined) {
    return {
      sessionId,
      ...typeof messageId === "string" ? { messageId } : {}
    };
  }
  if (checked === "true") {
    return {
      sessionId,
      ...typeof messageId === "string" ? { messageId } : {},
      checked: true
    };
  }
  if (checked === "false") {
    return {
      sessionId,
      ...typeof messageId === "string" ? { messageId } : {},
      checked: false
    };
  }
  return { error: "markdown tasks: --checked must be true or false" };
}
function parseBookmarkFilter(flags) {
  const sessionId = flags["session"];
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "bookmark list: --session requires an id" };
  }
  const type = flags["type"];
  if (type !== undefined) {
    if (typeof type !== "string" || !isBookmarkType(type)) {
      return {
        error: "bookmark list: --type must be session, message, or range"
      };
    }
  }
  const tag = flags["tag"];
  if (tag !== undefined && typeof tag !== "string") {
    return { error: "bookmark list: --tag requires a tag" };
  }
  return {
    filter: {
      ...typeof sessionId === "string" ? { sessionId } : {},
      ...typeof type === "string" && isBookmarkType(type) ? { type } : {},
      ...typeof tag === "string" ? { tag } : {}
    }
  };
}
function parseBookmarkAddInput(flags) {
  const type = flags["type"];
  if (typeof type !== "string" || !isBookmarkType(type)) {
    return { error: "bookmark add: --type must be session, message, or range" };
  }
  const sessionId = flags["session"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { error: "bookmark add: --session is required" };
  }
  const name = flags["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { error: "bookmark add: --name is required" };
  }
  const messageId = flags["message"];
  if (messageId !== undefined && typeof messageId !== "string") {
    return { error: "bookmark add: --message requires an id" };
  }
  const fromMessageId = flags["from"];
  if (fromMessageId !== undefined && typeof fromMessageId !== "string") {
    return { error: "bookmark add: --from requires an id" };
  }
  const toMessageId = flags["to"];
  if (toMessageId !== undefined && typeof toMessageId !== "string") {
    return { error: "bookmark add: --to requires an id" };
  }
  const description = flags["description"];
  if (description !== undefined && typeof description !== "string") {
    return { error: "bookmark add: --description requires text" };
  }
  const tag = flags["tag"];
  if (tag !== undefined && typeof tag !== "string") {
    return { error: "bookmark add: --tag requires a tag" };
  }
  return {
    input: {
      type,
      sessionId,
      name,
      ...typeof messageId === "string" ? { messageId } : {},
      ...typeof fromMessageId === "string" ? { fromMessageId } : {},
      ...typeof toMessageId === "string" ? { toMessageId } : {},
      ...typeof description === "string" ? { description } : {},
      ...typeof tag === "string" ? { tags: [tag] } : {}
    }
  };
}
function parseBookmarkSearchOptions(flags) {
  const limit = parseOptionalPositiveIntegerFlag(flags, "limit");
  if (limit === null) {
    return { error: "bookmark search: --limit must be a positive integer" };
  }
  return { options: { ...limit !== undefined ? { limit } : {} } };
}
function parseOptionalLimit(command, flags) {
  const rawLimit = flags["limit"];
  if (rawLimit === undefined) {
    return { options: {} };
  }
  const limit = typeof rawLimit === "string" ? Number(rawLimit) : NaN;
  if (!Number.isInteger(limit) || !Number.isFinite(limit) || limit <= 0) {
    return { error: `${command}: --limit must be a positive integer` };
  }
  return { options: { limit } };
}
function renderBookmarkHuman(bookmark) {
  const target = bookmark.type === "message" ? `message=${bookmark.messageId ?? ""}` : bookmark.type === "range" ? `range=${bookmark.fromMessageId ?? ""}..${bookmark.toMessageId ?? ""}` : "session";
  const tags = bookmark.tags.length > 0 ? ` tags=${bookmark.tags.join(",")}` : "";
  console.log(`${bookmark.id}  ${bookmark.type}  session=${bookmark.sessionId}  ${target}  ${bookmark.name}${tags}`);
}
function renderSessionSearchHuman(result) {
  for (const r of result.sessions) {
    const pending = r.identityState === "chat_only" ? " [pending-chat]" : "";
    const id = r.localSessionId ?? r.cursorChatId ?? r.recordId;
    console.log(`${id}${pending}  ${r.workspaceSlug}  ${r.status}  ${r.updatedAt}  matches=${r.matchFields.join(",")}`);
  }
}
function renderTranscriptSearchHuman(result) {
  for (const hit of result.hits) {
    const id = hit.localSessionId ?? hit.cursorChatId ?? hit.recordId;
    console.log(`${id}  ${hit.role}  ${hit.messageId}  ${hit.excerpt.replace(/\s+/g, " ").trim()}`);
  }
  if (result.truncated) {
    console.log(`Search truncated after ${result.scannedSessions} sessions, ${result.scannedEvents} events, ${result.scannedBytes} bytes`);
  }
  if (result.timedOut) {
    console.log(`Search timed out after ${result.scannedSessions} sessions, ${result.scannedEvents} events, ${result.scannedBytes} bytes`);
  }
}
function renderFilesListHuman(result) {
  console.log(`session=${result.sessionId} record=${result.recordId} provenance=${result.provenance} files=${result.totalFiles}`);
  for (const file of result.files) {
    const models = file.models.length > 0 ? ` models=${file.models.join(",")}` : "";
    console.log(`${file.path.path}  ${file.operation}  changes=${file.changeCount}  pathKind=${file.path.pathKind}  provenance=${file.provenance}${models}`);
  }
}
function renderSnapshotsHuman(result) {
  console.log(`session=${result.sessionId} record=${result.recordId} provenance=${result.provenance} snapshots=${result.totalSnapshots}`);
  for (const snapshot of result.snapshots) {
    const model = snapshot.model !== undefined ? ` model=${snapshot.model}` : "";
    const ext = snapshot.fileExtension !== undefined ? ` ext=${snapshot.fileExtension}` : "";
    console.log(`${snapshot.path.path}  bytes=${snapshot.contentBytes}  pathKind=${snapshot.path.pathKind}  provenance=${snapshot.provenance}${model}${ext}`);
  }
}
function renderDeletedHuman(result) {
  console.log(`session=${result.sessionId} record=${result.recordId} provenance=${result.provenance} deleted=${result.totalDeletedFiles}`);
  for (const file of result.deletedFiles) {
    const deletedAt = file.deletedAt !== undefined ? ` deletedAt=${file.deletedAt}` : "";
    const model = file.model !== undefined ? ` model=${file.model}` : "";
    console.log(`${file.path.path}  pathKind=${file.path.pathKind}  provenance=${file.provenance}${deletedAt}${model}`);
  }
}
function renderFileHistoryHuman(result) {
  console.log(`path=${result.queryPath} provenance=${result.provenance} entries=${result.totalEntries} needsRebuild=${result.needsRebuild}`);
  for (const entry of result.entries) {
    const observedAt = entry.observedAt !== undefined ? ` observedAt=${entry.observedAt}` : "";
    console.log(`${entry.path.path}  ${entry.operation}  session=${entry.sessionId}  record=${entry.recordId}  provenance=${entry.provenance}${observedAt}`);
  }
}
function renderRebuildHuman(stats) {
  console.log(`indexedSessions=${stats.indexedSessions} touchedFiles=${stats.touchedFiles} deletedFiles=${stats.deletedFiles} snapshots=${stats.snapshots} skippedSessions=${stats.skippedSessions} updatedAt=${stats.updatedAt} provenance=${stats.provenance}`);
}
function renderRepoAnalyticsSummaryHuman(result) {
  const v1 = result.weightedV1AiPercentage !== undefined ? ` weightedV1AiPercentage=${result.weightedV1AiPercentage}` : "";
  const v2 = result.weightedV2AiPercentage !== undefined ? ` weightedV2AiPercentage=${result.weightedV2AiPercentage}` : "";
  console.log(`commits=${result.totalCommits} scored=${result.scoredCommits} composerLines=${result.totalComposerLines} provenance=${result.provenance.join(",")}${v1}${v2}`);
  for (const note of result.completenessNotes) {
    console.log(`note=${note}`);
  }
}
function renderRepoAnalyticsCommitsHuman(result) {
  console.log(`commits=${result.totalCommits} provenance=${result.provenance.join(",")}`);
  for (const commit of result.commits) {
    const date = commit.commitDate !== undefined ? ` ${commit.commitDate}` : "";
    const v1 = commit.v1AiPercentage !== undefined ? ` v1=${commit.v1AiPercentage}` : "";
    const v2 = commit.v2AiPercentage !== undefined ? ` v2=${commit.v2AiPercentage}` : "";
    console.log(`${commit.commitHash}${date}${v1}${v2} provenance=${commit.provenance}`);
  }
}
function renderRepoAnalyticsSessionsHuman(result) {
  console.log(`sessions=${result.totalSessions} provenance=${result.provenance.join(",")}`);
  for (const session of result.sessions) {
    console.log(`${session.sessionId} touched=${session.touchedFiles} deleted=${session.deletedFiles} snapshots=${session.snapshots} unknown=${session.unknownFiles} provenance=${session.provenance.join(",")}`);
  }
}
function renderRepoAnalyticsFilesHuman(result) {
  console.log(`files=${result.totalFiles} provenance=${result.provenance.join(",")}`);
  for (const file of result.files) {
    console.log(`${file.path} sessions=${file.sessions} touched=${file.touchedCount} deleted=${file.deletedCount} snapshots=${file.snapshotCount} provenance=${file.provenance.join(",")}`);
  }
}
function renderRepoAnalyticsRebuildHuman(stats) {
  console.log(`indexedCommits=${stats.indexedCommits} indexedSessions=${stats.indexedSessions} indexedFiles=${stats.indexedFiles} skippedRows=${stats.skippedRows} updatedAt=${stats.updatedAt} provenance=${stats.provenance.join(",")}`);
  for (const note of stats.completenessNotes) {
    console.log(`note=${note}`);
  }
}
function renderMarkdownTasksHuman(result) {
  for (const task of result.tasks) {
    const marker = task.checked ? "[x]" : "[ ]";
    const section = task.sectionHeading === undefined || task.sectionHeading.length === 0 ? "" : `  ${task.sectionHeading}`;
    console.log(`${task.messageId}  ${marker}${section}  ${task.text}`);
  }
}
function renderActivityHuman(activity) {
  const id = activity.localSessionId ?? activity.cursorChatId ?? activity.recordId;
  const sources = activity.signals.map((signal) => signal.source).join(",");
  console.log(`${id}  ${activity.status}  ${activity.updatedAt}  ${sources}`);
}
function renderToolVersionsHuman(report) {
  console.log(`cursor-cli-agent ${report.packageVersion}`);
  for (const item of report.tools) {
    const version = item.version ?? "-";
    const error = item.error !== undefined ? `  error=${item.error}` : "";
    console.log(`${item.name}  ${item.status}  ${version}${error}`);
  }
}
function renderModelAvailabilityHuman(report) {
  console.log(`model=${report.model}`);
  console.log(`binary=${report.binary.status} version=${report.binary.version ?? "-"}`);
  console.log(`auth=${report.auth.status} provenance=${report.auth.provenance}`);
  const reachability = report.modelReachability;
  const error = reachability.error !== undefined ? ` error=${reachability.error}` : "";
  console.log(`reachability=${reachability.status} probed=${String(reachability.probed)}${error}`);
}
function renderUsageStatsHuman(report) {
  console.log(`sessions=${report.totalSessions} first=${report.firstSessionDate ?? "-"} computed=${report.lastComputedDate}`);
  console.log(`statuses=${JSON.stringify(report.statusCounts)}`);
  console.log(`activity=${JSON.stringify(report.activityStatusCounts)}`);
  console.log(`models=${JSON.stringify(report.models)}`);
  console.log(`usage.tokens=${JSON.stringify(report.usageTokens)} sessionsObserved=${report.usageSessionsObserved}`);
  console.log(`usage.byModel=${JSON.stringify(report.usageTokensByModel)}`);
  console.log(`usage.coverage=${JSON.stringify(report.usageEvidenceCoverage)} provenance=${report.usageProvenance}`);
  for (const daily of report.recentDailyActivity) {
    console.log(`${daily.date} sessions=${daily.sessionCount} activitySignals=${daily.activitySignalCount}`);
  }
  for (const daily of report.usageRecentDailyActivity) {
    console.log(`${daily.date} usage.tokensByModel=${JSON.stringify(daily.tokensByModel)}`);
  }
  for (const note of report.completenessNotes) {
    console.log(`note=${note}`);
  }
}
function printJson(v) {
  console.log(JSON.stringify(v, null, 2));
}
function renderTokenCreatedHuman(created) {
  console.log(`token=${created.token}`);
  console.log(`id=${created.metadata.id}`);
  console.log(`name=${created.metadata.name}`);
  console.log(`permissions=${created.metadata.permissions.join(",")}`);
  if (created.metadata.expiresAt !== undefined) {
    console.log(`expiresAt=${created.metadata.expiresAt}`);
  }
}
function renderTokenMetadataHuman(token) {
  const expires = token.expiresAt !== undefined ? ` expiresAt=${token.expiresAt}` : "";
  const revoked = token.revokedAt !== undefined ? ` revokedAt=${token.revokedAt}` : "";
  console.log(`${token.id}  ${token.name}  permissions=${token.permissions.join(",")}  createdAt=${token.createdAt}${expires}${revoked}`);
}
function renderServerStartResult(result, json) {
  if (json) {
    printJson(result);
    return;
  }
  console.log(`Server listening on ${result.url}`);
  console.log(`Auth: ${result.auth}`);
}
function renderDaemonStartResult(result, json) {
  if (json) {
    printJson(result);
    return;
  }
  if (result.state === "running" && result.metadata !== undefined) {
    console.log(`Daemon running pid=${result.metadata.pid} url=${result.metadata.baseUrl}`);
    console.log(`Auth: ${result.metadata.auth.mode}`);
    return;
  }
  console.log(`Daemon failed: ${result.staleReason ?? "readiness failed"}`);
}
function renderDaemonStatusResult(result, json) {
  if (json) {
    printJson(result);
    return;
  }
  if (result.metadata === undefined) {
    console.log(`Daemon ${result.state}`);
    if (result.staleReason !== undefined) {
      console.log(`Reason: ${result.staleReason}`);
    }
    return;
  }
  console.log(`Daemon ${result.state} pid=${result.metadata.pid} url=${result.metadata.baseUrl}`);
  console.log(`Started: ${result.metadata.startedAt}`);
  if (result.staleReason !== undefined) {
    console.log(`Reason: ${result.staleReason}`);
  }
}
function renderDaemonStopResult(result, json) {
  if (json) {
    printJson(result);
    return;
  }
  if (result.stopped) {
    console.log(`Daemon stopped${result.metadata !== undefined ? ` pid=${result.metadata.pid}` : ""}`);
    return;
  }
  if (result.state === "stopped") {
    console.log("Daemon stopped");
    return;
  }
  if (result.state === "stale") {
    console.log(`Daemon stale: ${result.staleReason}`);
    return;
  }
  console.log(`Daemon failed: ${result.reason}`);
}
function renderGroupProgressHuman(snapshot) {
  console.log(`${snapshot.group.name}  lifecycle=${snapshot.group.lifecycleState}  run=${snapshot.run?.status ?? "none"}  updated=${snapshot.updatedAt}`);
  console.log(`totals pending=${snapshot.totals.pending} running=${snapshot.totals.running} waiting=${snapshot.totals.waiting} completed=${snapshot.totals.completed} failed=${snapshot.totals.failed} unknown=${snapshot.totals.unknown}`);
  for (const workspace of snapshot.run?.workspaces ?? []) {
    const session = workspace.localSessionId ?? workspace.cursorChatId ?? "-";
    console.log(`${workspace.workspace}  ${workspace.status}  ${session}`);
  }
}
function renderQueueProgressLine(snapshot) {
  return `${snapshot.queue.name}  lifecycle=${snapshot.queue.lifecycleState}  run=${snapshot.run?.status ?? "none"}  total=${snapshot.queue.items.length}  pending=${snapshot.totals.pending}  running=${snapshot.totals.running}  completed=${snapshot.totals.completed}  failed=${snapshot.totals.failed}  skipped=${snapshot.totals.skipped}  manual=${snapshot.totals.manual}  workspace=${snapshot.queue.workspace}`;
}
function renderQueueProgressHuman(snapshot) {
  console.log(renderQueueProgressLine(snapshot));
  for (const item of snapshot.queue.items) {
    console.log(`${item.id}  ${item.status}  mode=${item.mode}  ${promptPreview(item.prompt)}`);
  }
}
function sleep3(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
function isTerminalRunStatus(status) {
  return status === "completed" || status === "failed" || status === "paused";
}
function runId(name, startedAt) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${safeName}-${startedAt.replace(/[^0-9]/g, "")}`;
}
function promptPreview(prompt) {
  return prompt.length <= 120 ? prompt : `${prompt.slice(0, 117)}...`;
}
function initialRunRecord(group, prompt, attachments) {
  const startedAt = new Date().toISOString();
  return {
    id: runId(group.name, startedAt),
    status: "running",
    promptPreview: promptPreview(prompt),
    ...attachments !== undefined && attachments.length > 0 ? { attachments } : {},
    startedAt,
    updatedAt: startedAt,
    workspaces: group.workspaces.map((workspace) => ({
      workspace,
      status: "pending",
      updatedAt: startedAt
    }))
  };
}
function initialQueueRunRecord(queue, runAttachments) {
  const startedAt = new Date().toISOString();
  const runnable = queue.items.filter((item) => item.status === "pending" && item.mode === "auto");
  return {
    id: runId(queue.name, startedAt),
    status: "running",
    ...runAttachments !== undefined && runAttachments.length > 0 ? { attachments: runAttachments } : {},
    startedAt,
    updatedAt: startedAt,
    completedItemIds: [],
    failedItemIds: [],
    pendingItemIds: runnable.map((item) => item.id)
  };
}
function updateQueueRunItem(run, itemId, status) {
  const updatedAt = new Date().toISOString();
  const completed = new Set(run.completedItemIds);
  const failed = new Set(run.failedItemIds);
  const pending = new Set(run.pendingItemIds);
  pending.delete(itemId);
  if (status === "completed") {
    completed.add(itemId);
    failed.delete(itemId);
  }
  if (status === "failed") {
    failed.add(itemId);
    completed.delete(itemId);
  }
  const currentItemId = status === "running" ? itemId : run.currentItemId === itemId ? undefined : run.currentItemId;
  const runWithoutCurrent = {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    ...run.completedAt !== undefined ? { completedAt: run.completedAt } : {},
    completedItemIds: run.completedItemIds,
    failedItemIds: run.failedItemIds,
    pendingItemIds: run.pendingItemIds,
    ...run.stoppedAt !== undefined ? { stoppedAt: run.stoppedAt } : {},
    ...run.attachments !== undefined && run.attachments.length > 0 ? { attachments: run.attachments } : {}
  };
  return {
    ...runWithoutCurrent,
    ...currentItemId !== undefined ? { currentItemId } : {},
    updatedAt,
    completedItemIds: [...completed],
    failedItemIds: [...failed],
    pendingItemIds: [...pending]
  };
}
function finishQueueRunRecord(run, status) {
  const completedAt = new Date().toISOString();
  return {
    ...run,
    status,
    updatedAt: completedAt,
    completedAt,
    ...status === "stopped" ? { stoppedAt: completedAt } : {}
  };
}
function updateRunWorkspace(run, workspace, update) {
  const updatedAt = new Date().toISOString();
  return {
    ...run,
    updatedAt,
    workspaces: run.workspaces.map((record) => record.workspace === workspace ? {
      ...record,
      ...update,
      updatedAt
    } : record)
  };
}
function finishRunRecord(run, status) {
  const completedAt = new Date().toISOString();
  return {
    ...run,
    status,
    updatedAt: completedAt,
    completedAt
  };
}
function printEvents(events, json) {
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
function resolveStreamMode(flags) {
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
function emitStreamedAgentEvents(stream, evs, textState) {
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
async function openRepo() {
  mkdirSync11(getDataDir(), { recursive: true });
  return new SessionIndexRepository(stateDbPath());
}
function openFileIndex() {
  mkdirSync11(getDataDir(), { recursive: true });
  return new FileIntelligenceIndex(join10(getDataDir(), "file-intelligence.db"));
}
function openRepositoryAnalyticsIndex() {
  mkdirSync11(getDataDir(), { recursive: true });
  return new RepositoryAnalyticsIndex(join10(getDataDir(), "repository-analytics.db"));
}
async function recordActivitySignal(manager, sessionId, signal) {
  if (sessionId === undefined || signal === null) {
    return;
  }
  await manager.recordSignal(sessionId, signal);
}
async function runCli(argv) {
  const [, , cmd, ...tail] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") {
    console.log(`Usage:
  cursor-cli-agent version
  cursor-cli-agent session list [--workspace <path>] [--limit N] [--json]
  cursor-cli-agent session show <id> [--workspace <path>] [--json]
  cursor-cli-agent session watch <id> [--workspace <path>] [--json]
  cursor-cli-agent session run --prompt <text> [--image <path>]... [options]
  cursor-cli-agent session create [--workspace <path>] [--json]
  cursor-cli-agent session resume <id> [--prompt <text>] [--image <path>]... [options]
  cursor-cli-agent session continue [--workspace <path>] [--stream <text|json|events>] [--json]
  cursor-cli-agent session fork <id> --prompt <text> [--through-message <id>] [--nth-message <n>] [--dry-run] [--stream <text|json|events>] [--json] [options]
  cursor-cli-agent session attach <id> [--workspace <path>]
  cursor-cli-agent session search <query> [--workspace <path>] [--model <model>] [--mode <default|plan|ask>] [--status <pending|active|completed|failed|unknown>] [--limit N] [--offset N] [--json]
  cursor-cli-agent transcript search <query> [--session <id>] [--role <user|assistant|system|tool>] [--limit N] [--offset N] [--max-sessions N] [--max-bytes N] [--max-events N] [--json]
  cursor-cli-agent files list <session-id> [--json]
  cursor-cli-agent files snapshots <session-id> [--json] [--include-content]
  cursor-cli-agent files deleted <session-id> [--json]
  cursor-cli-agent files find <path> [--json]
  cursor-cli-agent files rebuild [--json]
  cursor-cli-agent repo analytics summary [--json]
  cursor-cli-agent repo analytics commits [--limit N] [--json]
  cursor-cli-agent repo analytics sessions [--limit N] [--json]
  cursor-cli-agent repo analytics files [--limit N] [--json]
  cursor-cli-agent repo analytics rebuild [--json]
  cursor-cli-agent activity [--session <id>] [--status <idle|running|waiting_trust|waiting_input|completed|failed>] [--limit N] [--json]
  cursor-cli-agent tool list [--json]
  cursor-cli-agent tool show <name> [--json]
  cursor-cli-agent tool run <name> --input <json|@path> [--json]
  cursor-cli-agent tool versions [--include-git] [--include-bun] [--timeout-ms N] [--json]
  cursor-cli-agent model check --model <model> [--probe] [--timeout-ms N] [--json]
  cursor-cli-agent usage stats [--workspace <path>] [--session <id>] [--recent-days N] [--json]
  cursor-cli-agent markdown tasks --session <id> [--message <id>] [--checked <true|false>] [--json]
  cursor-cli-agent bookmark add --type <session|message|range> --session <id> --name <name> [--message <id>] [--from <id>] [--to <id>] [--tag <tag>] [--json]
  cursor-cli-agent bookmark list [--session <id>] [--type <type>] [--tag <tag>] [--json]
  cursor-cli-agent bookmark show <id> [--json]
  cursor-cli-agent bookmark delete <id> [--json]
  cursor-cli-agent bookmark search <query> [--limit N] [--json]
  cursor-cli-agent group <subcommand> ...
    create <name> | list | show <name> | add <name> [--workspace <path>] | remove <name> [--workspace <path>]
    pause <name> [--json] | resume <name> [--json] | delete <name> [--force] [--json]
    watch <name> [--interval <seconds>] [--once] [--json]
    run <name> --prompt <text> [--image <path>]... [--stream <text|json|events>] [--json]
  cursor-cli-agent queue <subcommand> ...
    create <name> [--workspace <path>] | list | show <name> | add <name> --prompt <text> [--image <path>]... | remove <name> --item <id>
    pause <name> [--json] | resume <name> [--json] | delete <name> [--force] [--json]
    update <name> --item <id> [--prompt <text>] [--status <pending|completed|failed|skipped>] [--json]
    move <name> --from <n> --to <n> [--json] | mode <name> --item <id> --mode <auto|manual> [--json] | stop <name> [--json]
    run <name> [--image <path>]... [--stream <text|json|events>] [--json]
  cursor-cli-agent skill list [--workspace <path>] [--json]
  cursor-cli-agent skill show <name> [--workspace <path>] [--json]
  cursor-cli-agent graphql <document|command> [--param <json|@path>] [--variables <json|@path>] [--json]
  cursor-cli-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>] [--json]
  cursor-cli-agent token list [--json]
  cursor-cli-agent token revoke <id> [--json]
  cursor-cli-agent token rotate <id> [--json]
  cursor-cli-agent server start [--host <host>] [--port <port>] [--token <token>] [--compat-graphql] [--json]
  cursor-cli-agent daemon start [--host <host>] [--port <port>] [--token <token>] [--timeout-ms N] [--json]
  cursor-cli-agent daemon stop [--timeout-ms N] [--json]
  cursor-cli-agent daemon status [--token <token>] [--json]
  cursor-cli-agent auth keepalive --model <model> [--interval-ms N] [--timeout-ms N] [--once]
`);
    return EXIT.USAGE;
  }
  if (cmd === "version") {
    console.log(`cursor-cli-agent ${package_default.version}`);
    return EXIT.OK;
  }
  if (cmd === "server") {
    return runServer(tail);
  }
  if (cmd === "token") {
    return runToken(tail);
  }
  if (cmd === "daemon") {
    return runDaemon(tail);
  }
  if (cmd === "session") {
    return runSession(tail);
  }
  if (cmd === "transcript") {
    return runTranscript(tail);
  }
  if (cmd === "files") {
    return runFiles(tail);
  }
  if (cmd === "repo") {
    return runRepo(tail);
  }
  if (cmd === "activity") {
    return runActivity(tail);
  }
  if (cmd === "tool") {
    return runTool(tail);
  }
  if (cmd === "model") {
    return runModel(tail);
  }
  if (cmd === "usage") {
    return runUsage(tail);
  }
  if (cmd === "markdown") {
    return runMarkdown(tail);
  }
  if (cmd === "bookmark") {
    return runBookmark(tail);
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
  if (cmd === "auth") {
    return runAuth(tail);
  }
  if (cmd === "graphql") {
    const { flags } = parseFlags2(tail);
    return runGraphqlCli(tail, {
      workspace: getWorkspace(flags),
      dataDir: getDataDir(),
      configDir: getConfigDir(),
      cursorHome: getCursorHome()
    });
  }
  console.error(`Unknown command: ${cmd}`);
  return EXIT.USAGE;
}
async function waitForTerminationSignal() {
  await new Promise((resolveWait) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolveWait();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
async function runServer(argv) {
  const [sub, ...rest] = argv;
  if (sub !== "start") {
    console.error(sub === undefined ? "server: missing subcommand" : `Unknown server subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const parsed = parseServerStartArgs(rest);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  try {
    const config = resolveHttpServerConfig(parsed.args);
    const handle = await startHttpServerImpl(config);
    const result = {
      status: "running",
      host: handle.host,
      port: handle.port,
      url: handle.url,
      auth: config.token === undefined ? "none" : "bearer"
    };
    renderServerStartResult(result, parsed.args.json === true);
    try {
      await waitForTerminationSignal();
      return EXIT.OK;
    } finally {
      await handle.stop();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "server start failed");
    return EXIT.ERR;
  }
}
async function runDaemon(argv) {
  const [sub, ...rest] = argv;
  const manager = daemonManagerImpl ?? createDaemonManager();
  if (sub === "start") {
    const parsed = parseDaemonStartArgs(rest);
    if ("error" in parsed) {
      console.error(parsed.error);
      return EXIT.USAGE;
    }
    try {
      const { json, ...options } = parsed.args;
      const result = await manager.start(options);
      renderDaemonStartResult(result, json === true);
      return result.state === "running" ? EXIT.OK : EXIT.ERR;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "daemon start failed");
      return EXIT.ERR;
    }
  }
  if (sub === "stop") {
    const parsed = parseDaemonStopArgs(rest);
    if ("error" in parsed) {
      console.error(parsed.error);
      return EXIT.USAGE;
    }
    try {
      const { json, ...options } = parsed.args;
      const result = await manager.stop(options);
      renderDaemonStopResult(result, json === true);
      return result.state === "failed" ? EXIT.ERR : EXIT.OK;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "daemon stop failed");
      return EXIT.ERR;
    }
  }
  if (sub === "status") {
    const { rest: pos, flags } = parseFlags2(rest);
    if (pos.length > 0) {
      console.error("daemon status: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const token = flags["token"];
    if (token !== undefined && typeof token !== "string") {
      console.error("daemon status: --token requires a token");
      return EXIT.USAGE;
    }
    try {
      const result = await manager.status({
        ...typeof token === "string" ? { token } : {}
      });
      renderDaemonStatusResult(result, flags["json"] === true);
      return EXIT.OK;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "daemon status failed");
      return EXIT.ERR;
    }
  }
  console.error(sub === undefined ? "daemon: missing subcommand" : `Unknown daemon subcommand: ${sub}`);
  return EXIT.USAGE;
}
async function runToken(argv) {
  const [sub, ...rest] = argv;
  const manager = createTokenManager();
  if (sub === "create") {
    const parsed = parseTokenCreateArgs(rest);
    if ("error" in parsed) {
      console.error(parsed.error);
      return EXIT.USAGE;
    }
    try {
      const created = await manager.createToken(parsed.args);
      if (parsed.args.json === true) {
        printJson(created);
      } else {
        renderTokenCreatedHuman(created);
      }
      return EXIT.OK;
    } catch (error) {
      console.error(error instanceof Error ? `token create: ${error.message}` : "token create failed");
      return error instanceof TokenInputError ? EXIT.USAGE : EXIT.ERR;
    }
  }
  if (sub === "list") {
    const { rest: pos, flags } = parseFlags2(rest);
    if (pos.length > 0) {
      console.error("token list: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const tokens = await manager.listTokens();
    if (flags["json"] === true) {
      printJson({ tokens });
    } else {
      for (const token of tokens) {
        renderTokenMetadataHuman(token);
      }
    }
    return EXIT.OK;
  }
  if (sub === "revoke" || sub === "rotate") {
    const { rest: pos, flags } = parseFlags2(rest);
    const id = pos[0];
    if (id === undefined || id.length === 0) {
      console.error(`token ${sub}: missing token id`);
      return EXIT.USAGE;
    }
    if (pos.length > 1) {
      console.error(`token ${sub}: unexpected positional arguments`);
      return EXIT.USAGE;
    }
    try {
      if (sub === "revoke") {
        const token = await manager.revokeToken(id);
        if (flags["json"] === true) {
          printJson({ revoked: true, token });
        } else {
          console.log(`revoked=${token.id}`);
        }
        return EXIT.OK;
      }
      const rotated = await manager.rotateToken(id);
      if (flags["json"] === true) {
        printJson(rotated);
      } else {
        renderTokenCreatedHuman(rotated);
      }
      return EXIT.OK;
    } catch (error) {
      console.error(error instanceof Error ? `token ${sub}: ${error.message}` : `token ${sub} failed`);
      return error instanceof TokenNotFoundError ? EXIT.NOT_FOUND : EXIT.ERR;
    }
  }
  console.error(sub === undefined ? "token: missing subcommand" : `Unknown token subcommand: ${sub}`);
  return EXIT.USAGE;
}
async function runActivity(argv) {
  const { rest: pos, flags } = parseFlags2(argv);
  if (pos.length > 0) {
    console.error("activity: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseActivityOptions(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const manager = createActivityManager({ sessions: repo });
    if (parsed.session !== undefined) {
      const activity = await manager.getSessionActivity(parsed.session);
      if (activity === null) {
        console.error("session not found");
        return EXIT.NOT_FOUND;
      }
      if (parsed.status !== undefined && activity.status !== parsed.status) {
        if (json) {
          printJson({ activity: null });
        }
        return EXIT.OK;
      }
      if (json) {
        printJson(activity);
      } else {
        renderActivityHuman(activity);
      }
      return EXIT.OK;
    }
    const activities = await manager.listActivity({
      ...parsed.status !== undefined ? { status: parsed.status } : {},
      ...parsed.limit !== undefined ? { limit: parsed.limit } : {}
    });
    if (json) {
      printJson({ activities });
    } else {
      for (const activity of activities) {
        renderActivityHuman(activity);
      }
    }
    return EXIT.OK;
  } finally {
    repo.close();
  }
}
function optionalNumber3(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}
function createCliToolRegistry() {
  return createToolRegistry([
    tool({
      name: "tool.versions",
      description: "Return package and optional local helper tool versions.",
      inputSchema: {
        type: "object",
        properties: {
          includeGit: { type: "boolean" },
          includeBun: { type: "boolean" },
          timeoutMs: { type: "number" }
        }
      },
      run(input) {
        const timeoutMs = optionalNumber3(input["timeoutMs"]);
        return getToolVersions({
          includeGit: input["includeGit"] === true,
          includeBun: input["includeBun"] === true,
          ...timeoutMs !== undefined ? { timeoutMs } : {}
        });
      }
    }),
    tool({
      name: "model.check",
      description: "Check cursor-agent binary evidence and optional model probe.",
      inputSchema: {
        type: "object",
        required: ["model"],
        properties: {
          model: { type: "string" },
          probe: { type: "boolean" },
          timeoutMs: { type: "number" }
        }
      },
      run(input) {
        const model = input["model"];
        if (typeof model !== "string" || model.trim().length === 0) {
          throw new Error("model.check input requires non-empty model");
        }
        const timeoutMs = optionalNumber3(input["timeoutMs"]);
        return checkModelAvailability({
          model,
          probe: input["probe"] === true,
          ...timeoutMs !== undefined ? { timeoutMs } : {}
        });
      }
    }),
    tool({
      name: "usage.stats",
      description: "Aggregate local indexed session and activity statistics.",
      inputSchema: {
        type: "object",
        properties: {
          recentDays: { type: "number" },
          workspacePath: { type: "string" },
          sessionId: { type: "string" }
        }
      },
      async run(input) {
        const recentDays = optionalNumber3(input["recentDays"]);
        const workspacePath = typeof input["workspacePath"] === "string" ? input["workspacePath"].trim() : undefined;
        const sessionId = typeof input["sessionId"] === "string" ? input["sessionId"].trim() : undefined;
        const repo = await openRepo();
        try {
          await repo.importTranscriptsFromFilesystem();
          const activity = createActivityManager({ sessions: repo });
          const usageEvents = createUsageEventStore();
          return await createUsageStatsManager({
            sessions: repo,
            activity,
            usageEvents
          }).stats({
            ...recentDays !== undefined ? { recentDays } : {},
            ...workspacePath !== undefined && workspacePath.length > 0 ? { workspacePath } : {},
            ...sessionId !== undefined && sessionId.length > 0 ? { sessionId } : {}
          });
        } finally {
          repo.close();
        }
      }
    })
  ]);
}
async function parseToolRunInput(value) {
  if (Array.isArray(value) || typeof value !== "string" || value.length === 0) {
    return { error: "tool run: --input is required" };
  }
  let source;
  try {
    if (value.startsWith("@")) {
      source = await readFile15(value.slice(1), "utf8");
    } else if (existsSync5(value)) {
      source = await readFile15(value, "utf8");
    } else {
      source = value;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `tool run: failed to read input file: ${detail}` };
  }
  try {
    const parsed = JSON.parse(source);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "tool run: --input must be a JSON object" };
    }
    return { input: parsed };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `tool run: --input must be valid JSON: ${detail}` };
  }
}
function validateOptionalBooleanField(toolName, input, field) {
  const value = input[field];
  if (value !== undefined && typeof value !== "boolean") {
    return `${toolName} input field ${field} must be boolean`;
  }
  return null;
}
function validateOptionalNumberField(toolName, input, field) {
  const value = input[field];
  if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
    return `${toolName} input field ${field} must be a positive integer`;
  }
  return null;
}
function validateOptionalStringField(toolName, input, field) {
  const value = input[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return `${toolName} input field ${field} must be a string`;
  }
  return null;
}
function validateToolRunInput(toolName, input) {
  if (toolName === "tool.versions") {
    return validateOptionalBooleanField(toolName, input, "includeGit") ?? validateOptionalBooleanField(toolName, input, "includeBun") ?? validateOptionalNumberField(toolName, input, "timeoutMs");
  }
  if (toolName === "model.check") {
    const model = input["model"];
    if (typeof model !== "string" || model.trim().length === 0) {
      return "model.check input requires non-empty model";
    }
    return validateOptionalBooleanField(toolName, input, "probe") ?? validateOptionalNumberField(toolName, input, "timeoutMs");
  }
  if (toolName === "usage.stats") {
    return validateOptionalNumberField(toolName, input, "recentDays") ?? validateOptionalStringField(toolName, input, "workspacePath") ?? validateOptionalStringField(toolName, input, "sessionId");
  }
  return null;
}
async function runTool(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("tool: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const parsedArgs = parseToolCommandArgs(flags);
  if ("error" in parsedArgs) {
    console.error(parsedArgs.error);
    return EXIT.USAGE;
  }
  const json = parsedArgs.args.json;
  if (sub === "versions") {
    if (pos.length > 0) {
      console.error("tool versions: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const options = {
      ...parsedArgs.args.timeoutMs !== undefined ? { timeoutMs: parsedArgs.args.timeoutMs } : {},
      ...parsedArgs.args.includeGit === true ? { includeGit: true } : {},
      ...parsedArgs.args.includeBun === true ? { includeBun: true } : {}
    };
    const report = await getToolVersions(options);
    if (json) {
      printJson(report);
    } else {
      renderToolVersionsHuman(report);
    }
    return EXIT.OK;
  }
  const registry = createCliToolRegistry();
  if (sub === "list") {
    if (pos.length > 0) {
      console.error("tool list: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const tools = registry.list();
    if (json) {
      printJson({ tools });
    } else {
      for (const item of tools) {
        console.log(`${item.name}  ${item.description ?? ""}`.trimEnd());
      }
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const name = pos[0];
    if (name === undefined || name.length === 0) {
      console.error("tool show: missing name");
      return EXIT.USAGE;
    }
    if (pos.length > 1) {
      console.error("tool show: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const item = registry.get(name);
    if (item === null) {
      console.error("tool not found");
      return EXIT.NOT_FOUND;
    }
    const summary = registry.list().find((toolSummary) => toolSummary.name === item.name);
    if (json) {
      printJson(summary ?? { name: item.name });
    } else {
      console.log(`${item.name}  ${summary?.description ?? ""}`.trimEnd());
    }
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined || name.length === 0) {
      console.error("tool run: missing name");
      return EXIT.USAGE;
    }
    if (pos.length > 1) {
      console.error("tool run: unexpected positional arguments");
      return EXIT.USAGE;
    }
    const parsedInput = await parseToolRunInput(flags["input"]);
    if ("error" in parsedInput) {
      console.error(parsedInput.error);
      return EXIT.USAGE;
    }
    const validationError = validateToolRunInput(name, parsedInput.input);
    if (validationError !== null) {
      console.error(validationError);
      return EXIT.USAGE;
    }
    try {
      const result = await registry.run(name, parsedInput.input);
      if (json) {
        printJson(result);
      } else if (typeof result === "string") {
        console.log(result);
      } else {
        printJson(result);
      }
      return EXIT.OK;
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === "not_found") {
        console.error("tool not found");
        return EXIT.NOT_FOUND;
      }
      console.error(error instanceof Error ? error.message : "tool run failed");
      return EXIT.ERR;
    }
  }
  console.error(`Unknown tool subcommand: ${sub}`);
  return EXIT.USAGE;
}
async function runModel(argv) {
  const [sub, ...rest] = argv;
  if (sub !== "check") {
    console.error(sub === undefined ? "model: missing subcommand" : `Unknown model subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  if (pos.length > 0) {
    console.error("model check: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseModelCheckCommandArgs(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const options = {
    model: parsed.args.model,
    probe: parsed.args.probe,
    ...parsed.args.timeoutMs !== undefined ? { timeoutMs: parsed.args.timeoutMs } : {},
    workspace: process.cwd()
  };
  try {
    const report = await checkModelAvailability(options);
    if (parsed.args.json) {
      printJson(report);
    } else {
      renderModelAvailabilityHuman(report);
    }
    return report.modelReachability.probed && report.modelReachability.status === "unavailable" ? EXIT.CURSOR : EXIT.OK;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "model check failed");
    return EXIT.USAGE;
  }
}
async function runUsage(argv) {
  const [sub, ...rest] = argv;
  if (sub !== "stats") {
    console.error(sub === undefined ? "usage: missing subcommand" : `Unknown usage subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  if (pos.length > 0) {
    console.error("usage stats: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseUsageStatsOptions(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const activity = createActivityManager({ sessions: repo });
    const usageEvents = createUsageEventStore();
    const report = await createUsageStatsManager({
      sessions: repo,
      activity,
      usageEvents
    }).stats(parsed.options);
    if (parsed.json) {
      printJson(report);
    } else {
      renderUsageStatsHuman(report);
    }
    return EXIT.OK;
  } finally {
    repo.close();
  }
}
async function runFiles(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("files: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  const repo = await openRepo();
  const index = openFileIndex();
  try {
    await repo.importTranscriptsFromFilesystem();
    const service = createFileIntelligenceService({
      sessions: repo,
      aiTracking: createAiTrackingFileReader(),
      index
    });
    if (sub === "list") {
      const sessionId = pos[0];
      if (sessionId === undefined || sessionId.length === 0) {
        console.error("files list: missing session id");
        return EXIT.USAGE;
      }
      const result = await service.listFiles(sessionId);
      if (json) {
        printJson(result);
      } else {
        renderFilesListHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "snapshots") {
      const sessionId = pos[0];
      if (sessionId === undefined || sessionId.length === 0) {
        console.error("files snapshots: missing session id");
        return EXIT.USAGE;
      }
      const result = await service.listSnapshots(sessionId, {
        includeContent: flags["include-content"] === true
      });
      if (json) {
        printJson(result);
      } else {
        renderSnapshotsHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "deleted") {
      const sessionId = pos[0];
      if (sessionId === undefined || sessionId.length === 0) {
        console.error("files deleted: missing session id");
        return EXIT.USAGE;
      }
      const result = await service.listDeleted(sessionId);
      if (json) {
        printJson(result);
      } else {
        renderDeletedHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "find") {
      const path = pos[0];
      if (path === undefined || path.trim().length === 0) {
        console.error("files find: missing path");
        return EXIT.USAGE;
      }
      const result = await service.findFile(path);
      if (json) {
        printJson(result);
      } else {
        renderFileHistoryHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "rebuild") {
      if (pos.length > 0) {
        console.error("files rebuild: unexpected positional arguments");
        return EXIT.USAGE;
      }
      const result = await service.rebuild();
      if (json) {
        printJson(result);
      } else {
        renderRebuildHuman(result);
      }
      return EXIT.OK;
    }
    console.error(`Unknown files subcommand: ${sub}`);
    return EXIT.USAGE;
  } catch (error) {
    if (error instanceof FileIntelligenceNotFoundError) {
      console.error(error.message);
      return EXIT.NOT_FOUND;
    }
    throw error;
  } finally {
    index.close();
    repo.close();
  }
}
async function runRepo(argv) {
  const [scope, sub, ...rest] = argv;
  if (scope !== "analytics") {
    console.error(scope === undefined ? "repo: missing subcommand" : `Unknown repo subcommand: ${scope}`);
    return EXIT.USAGE;
  }
  if (sub === undefined) {
    console.error("repo analytics: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  if (pos.length > 0) {
    console.error("repo analytics: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const json = flags["json"] === true;
  const parsedLimit = parseOptionalLimit("repo analytics", flags);
  if ("error" in parsedLimit) {
    console.error(parsedLimit.error);
    return EXIT.USAGE;
  }
  const repo = await openRepo();
  const fileIndex = openFileIndex();
  const analyticsIndex = openRepositoryAnalyticsIndex();
  try {
    await repo.importTranscriptsFromFilesystem();
    const fileIntelligence = createFileIntelligenceService({
      sessions: repo,
      aiTracking: createAiTrackingFileReader(),
      index: fileIndex
    });
    const service = createRepositoryAnalyticsService({
      sessions: repo,
      aiTracking: createAiTrackingAnalyticsReader(),
      fileIntelligence,
      fileIndex,
      analyticsIndex
    });
    if (sub === "summary") {
      const result = await service.getSummary();
      if (json) {
        printJson(result);
      } else {
        renderRepoAnalyticsSummaryHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "commits") {
      const result = await service.listCommits(parsedLimit.options);
      if (json) {
        printJson(result);
      } else {
        renderRepoAnalyticsCommitsHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "sessions") {
      const result = await service.listSessions(parsedLimit.options);
      if (json) {
        printJson(result);
      } else {
        renderRepoAnalyticsSessionsHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "files") {
      const result = await service.listFiles(parsedLimit.options);
      if (json) {
        printJson(result);
      } else {
        renderRepoAnalyticsFilesHuman(result);
      }
      return EXIT.OK;
    }
    if (sub === "rebuild") {
      const result = await service.rebuild();
      if (json) {
        printJson(result);
      } else {
        renderRepoAnalyticsRebuildHuman(result);
      }
      return EXIT.OK;
    }
    console.error(`Unknown repo analytics subcommand: ${sub}`);
    return EXIT.USAGE;
  } finally {
    analyticsIndex.close();
    fileIndex.close();
    repo.close();
  }
}
async function runMarkdown(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("markdown: missing subcommand");
    return EXIT.USAGE;
  }
  if (sub !== "tasks") {
    console.error(`Unknown markdown subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  if (pos.length > 0) {
    console.error("markdown tasks: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseMarkdownTaskOptions(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const extractor = createTranscriptMarkdownTaskExtractor(repo);
    const result = await extractor.extract(parsed);
    if (json) {
      printJson(result);
    } else {
      renderMarkdownTasksHuman(result);
    }
    return EXIT.OK;
  } catch (error) {
    if (error instanceof MarkdownTaskNotFoundError) {
      console.error(error.message);
      return EXIT.NOT_FOUND;
    }
    throw error;
  } finally {
    repo.close();
  }
}
async function runBookmark(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("bookmark: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const manager = createBookmarkManager({ sessions: repo });
    if (sub === "add") {
      const parsed = parseBookmarkAddInput(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      try {
        const bookmark = await manager.add(parsed.input);
        if (json) {
          printJson(bookmark);
        } else {
          renderBookmarkHuman(bookmark);
        }
        return EXIT.OK;
      } catch (e) {
        if (e instanceof BookmarkInputError) {
          console.error(`bookmark add: ${e.message}`);
          return EXIT.USAGE;
        }
        if (e instanceof BookmarkNotFoundError) {
          console.error(e.message);
          return EXIT.NOT_FOUND;
        }
        throw e;
      }
    }
    if (sub === "list") {
      const parsed = parseBookmarkFilter(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      const bookmarks = await manager.list(parsed.filter);
      if (json) {
        printJson({ bookmarks });
      } else {
        for (const bookmark of bookmarks) {
          renderBookmarkHuman(bookmark);
        }
      }
      return EXIT.OK;
    }
    if (sub === "show") {
      const id = pos[0];
      if (id === undefined || id.length === 0) {
        console.error("bookmark show: missing bookmark id");
        return EXIT.USAGE;
      }
      const bookmark = await manager.show(id);
      if (bookmark === null) {
        console.error("bookmark not found");
        return EXIT.NOT_FOUND;
      }
      if (json) {
        printJson(bookmark);
      } else {
        renderBookmarkHuman(bookmark);
      }
      return EXIT.OK;
    }
    if (sub === "delete") {
      const id = pos[0];
      if (id === undefined || id.length === 0) {
        console.error("bookmark delete: missing bookmark id");
        return EXIT.USAGE;
      }
      const deleted = await manager.delete(id);
      if (!deleted) {
        console.error("bookmark not found");
        return EXIT.NOT_FOUND;
      }
      if (json) {
        printJson({ deleted: true, id });
      }
      return EXIT.OK;
    }
    if (sub === "search") {
      const query = pos[0];
      if (query === undefined || query.trim().length === 0) {
        console.error("bookmark search: missing query");
        return EXIT.USAGE;
      }
      const parsed = parseBookmarkSearchOptions(flags);
      if ("error" in parsed) {
        console.error(parsed.error);
        return EXIT.USAGE;
      }
      const result = await manager.search(query, parsed.options);
      if (json) {
        printJson(result);
      } else {
        for (const hit of result.hits) {
          renderBookmarkHuman(hit.bookmark);
        }
      }
      return EXIT.OK;
    }
  } finally {
    repo.close();
  }
  console.error(`Unknown bookmark subcommand: ${sub}`);
  return EXIT.USAGE;
}
async function runTranscript(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("transcript: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  if (sub !== "search") {
    console.error(`Unknown transcript subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const parsed = parseTranscriptSearchOptions(pos, flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const repo = await openRepo();
  try {
    await repo.importTranscriptsFromFilesystem();
    const result = await createTranscriptSearchService(repo).search(parsed.options);
    if (json) {
      printJson(result);
    } else {
      renderTranscriptSearchHuman(result);
    }
    return EXIT.OK;
  } finally {
    repo.close();
  }
}
async function runSession(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("session: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  const workspace = getWorkspace(flags);
  const explicitWorkspace = getExplicitWorkspace(flags);
  let runHeadlessPrompt;
  let resumeSessionId;
  let headlessStreamMode;
  let searchOptions;
  let forkSourceId;
  let forkContinuation;
  let forkThrough;
  let forkNth;
  let forkDryRun = false;
  if (sub === "run") {
    const prompt = typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
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
  if (sub === "fork") {
    const sid = pos[0];
    if (sid === undefined || sid.length === 0) {
      console.error("session fork: missing session id");
      return EXIT.USAGE;
    }
    const fprompt = typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (fprompt === undefined || fprompt.trim().length === 0) {
      console.error("session fork: --prompt is required");
      return EXIT.USAGE;
    }
    const throughRaw = flags["through-message"];
    const nthRaw = flags["nth-message"];
    const through = typeof throughRaw === "string" && throughRaw.length > 0 ? throughRaw : undefined;
    const nthParsed = typeof nthRaw === "string" && nthRaw.length > 0 ? Number(nthRaw) : undefined;
    if (through !== undefined && nthParsed !== undefined) {
      console.error("session fork: --through-message and --nth-message are mutually exclusive");
      return EXIT.USAGE;
    }
    if (nthParsed !== undefined && (!Number.isInteger(nthParsed) || nthParsed <= 0)) {
      console.error("session fork: --nth-message must be a positive integer");
      return EXIT.USAGE;
    }
    if (through !== undefined && !/^event-\d+-(user|assistant)$/.test(through)) {
      console.error("session fork: --through-message must look like event-<offset>-<user|assistant>");
      return EXIT.USAGE;
    }
    const smFork = resolveStreamMode(flags);
    if ("error" in smFork) {
      console.error("session fork: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    forkSourceId = sid;
    forkContinuation = fprompt;
    forkThrough = through;
    forkNth = nthParsed;
    forkDryRun = flags["dry-run"] === true;
    headlessStreamMode = smFork.mode;
  }
  if (sub === "search") {
    const parsed = parseSessionSearchOptions(pos, flags);
    if ("error" in parsed) {
      console.error(parsed.error);
      return EXIT.USAGE;
    }
    searchOptions = {
      ...parsed.options,
      filters: {
        ...parsed.options.filters,
        ...explicitWorkspace !== undefined ? { workspace: explicitWorkspace } : {}
      }
    };
  }
  const repo = await openRepo();
  await repo.importTranscriptsFromFilesystem();
  if (sub === "fork") {
    if (forkSourceId === undefined || forkContinuation === undefined) {
      console.error("session fork: missing source session or prompt");
      return EXIT.USAGE;
    }
    const store = createReplayForkStore();
    const usagePersistence2 = createUsagePersistenceChain(repo);
    try {
      const streamFork = headlessStreamMode ?? "events";
      const textState = {
        lastAssistantBySession: new Map
      };
      const result = await executeSessionReplayFork({
        sourceSessionId: forkSourceId,
        continuationPrompt: forkContinuation,
        ...forkThrough !== undefined ? { throughMessageId: forkThrough } : {},
        ...forkNth !== undefined ? { nthMessage: forkNth } : {},
        dryRun: forkDryRun
      }, buildHeadlessRunOptionsPartial(workspace, flags), {
        sessions: repo,
        store,
        ...forkDryRun === false ? {
          onNormalizedEvents: (events) => {
            emitStreamedAgentEvents(streamFork, events, textState);
            usagePersistence2.capture(events);
          }
        } : {}
      });
      if (json) {
        printJson(result);
      } else {
        console.log(`${result.mode}: source ${result.sourceSession.recordId}`);
        console.log(`replay: ${result.replay.messageCount} message(s); truncated=${result.replay.truncated}`);
        if (result.newSession !== undefined) {
          console.log(`new session: ${result.newSession.localSessionId ?? result.newSession.recordId}`);
        }
        for (const w of result.warnings) {
          console.error(`warning: ${w}`);
        }
        for (const lim of result.limitations) {
          console.error(`limitation: ${lim}`);
        }
      }
      return EXIT.OK;
    } catch (e) {
      if (e instanceof SessionReplayForkError) {
        console.error(e.message);
        if (e.code === "not_found") {
          return EXIT.NOT_FOUND;
        }
        if (e.code === "trust_required") {
          return EXIT.TRUST;
        }
        if (e.code === "transcript_unavailable" || e.code === "slice_error") {
          return EXIT.TRANSCRIPT;
        }
        return EXIT.CURSOR;
      }
      throw e;
    } finally {
      await usagePersistence2.flush();
    }
  }
  const activityManager = createActivityManager({ sessions: repo });
  const activityClassifier = createActivitySignalClassifier();
  const usagePersistence = createUsagePersistenceChain(repo);
  let activityWriteChain = Promise.resolve();
  let lastActivitySessionId;
  const enqueueActivitySignal = (sessionId, signal) => {
    activityWriteChain = activityWriteChain.then(() => recordActivitySignal(activityManager, sessionId, signal));
  };
  const captureActivityEvents = (events, fallbackSessionId) => {
    for (const event of events) {
      const sessionId = sessionIdFromEvent(event) ?? fallbackSessionId;
      if (sessionId !== undefined) {
        lastActivitySessionId = sessionId;
      }
      enqueueActivitySignal(sessionId, activityClassifier.classifyStreamEvent(event));
    }
    usagePersistence.capture(events, fallbackSessionId);
  };
  const recordProcessResult = async (exitCode, stderr, stdout, fallbackSessionId) => {
    enqueueActivitySignal(lastActivitySessionId ?? fallbackSessionId, activityClassifier.classifyProcessResult(exitCode, stderr, stdout));
    await activityWriteChain;
  };
  if (sub === "list") {
    const limit = typeof flags["limit"] === "string" ? Number(flags["limit"]) : 20;
    const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
    const rows = repo.listSessionsForWorkspace(workspace, lim);
    if (json) {
      printJson({ sessions: rows });
    } else {
      for (const r of rows) {
        const pending = r.identityState === "chat_only" ? " [pending-chat]" : "";
        const id = r.localSessionId ?? r.cursorChatId ?? r.recordId;
        console.log(`${id}${pending}  ${r.workspaceSlug}  ${r.status}  ${r.updatedAt}`);
      }
    }
    return EXIT.OK;
  }
  if (sub === "search") {
    if (searchOptions === undefined) {
      console.error("session search: missing search configuration");
      return EXIT.USAGE;
    }
    const result = repo.searchSessions(searchOptions);
    if (json) {
      printJson(result);
    } else {
      renderSessionSearchHuman(result);
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
        message: "Transcript has not materialized yet."
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
    const aiTracking = convId !== undefined ? loadAiTrackingEnrichment(convId) : undefined;
    if (json) {
      printJson({
        record: rec,
        messages: summary.lines.map((l) => ({
          role: l.role,
          rawText: l.message.rawText,
          displayText: l.message.displayText,
          structured: l.message.structured
        })),
        ...aiTracking !== undefined ? { aiTracking } : {}
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
        console.log(`AI tracking: code touches=${touches}, deleted files=${deleted}, tracked snapshots=${tracked}`);
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
    const stopWatch = () => {
      watchInterrupted = true;
    };
    process.once("SIGINT", stopWatch);
    process.once("SIGTERM", stopWatch);
    if (rec.identityState === "chat_only" && rec.cursorChatId !== undefined) {
      const ws = rec.workspacePath ?? workspace;
      const expected = join10(agentTranscriptsDirForWorkspace(ws), `${rec.cursorChatId}.jsonl`);
      const pendingEvent = {
        type: "session.pending",
        recordId: rec.recordId,
        cursorChatId: rec.cursorChatId,
        workspacePath: ws
      };
      printEvents([pendingEvent], json);
      while (!existsSync5(expected) && !watchInterrupted) {
        await new Promise((r) => setTimeout(r, 750));
        await repo.importTranscriptsFromFilesystem();
      }
      if (watchInterrupted) {
        process.off("SIGINT", stopWatch);
        process.off("SIGTERM", stopWatch);
        return EXIT.OK;
      }
      const linked = repo.resolveSessionKey(id);
      const materialSessionId = linked?.localSessionId ?? rec.cursorChatId ?? id;
      const mat = {
        type: "session.materialized",
        recordId: rec.recordId,
        sessionId: materialSessionId,
        cursorChatId: rec.cursorChatId
      };
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
    const pump = async () => {
      if (watchInterrupted) {
        return;
      }
      const buf = await readFile15(path, "utf8");
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
        const ev = t.role === "user" ? {
          type: "session.user_message",
          sessionId: sessionKey,
          message: t.message
        } : {
          type: "session.assistant_message",
          sessionId: sessionKey,
          message: t.message
        };
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
      pump().catch(() => {
        return;
      });
    }, pollMs);
    if (typeof handle.unref === "function") {
      handle.unref();
    }
    return await new Promise((resolve10) => {
      const shutdown = () => {
        watchInterrupted = true;
        clearInterval(handle);
        resolve10(EXIT.OK);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      process.off("SIGINT", stopWatch);
      process.off("SIGTERM", stopWatch);
    });
  }
  if (sub === "run") {
    if (runHeadlessPrompt === undefined || headlessStreamMode === undefined) {
      console.error("session run: missing prompt or stream mode");
      return EXIT.USAGE;
    }
    const stream = headlessStreamMode;
    const prompt = runHeadlessPrompt;
    const imgErr = consumeImageFlagErrors(flags);
    if (imgErr !== undefined) {
      console.error(`session run: ${imgErr}`);
      return EXIT.USAGE;
    }
    const rawImages = imagePathsFromFlags(flags);
    const prep = await preparePromptAttachmentLaunch(workspace, "cli", rawImages, stream);
    if ("exit" in prep) {
      return prep.exit;
    }
    const norm = new StreamNormalizerState;
    const textState = {
      lastAssistantBySession: new Map
    };
    const attachmentProv = prep.provenance.length > 0 ? prep.provenance : undefined;
    let attachmentActivityRecorded = false;
    let exit;
    try {
      exit = await runHeadlessStreaming(buildHeadlessRunOptions(workspace, prompt, flags, prep.ok), (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        for (const event of events) {
          const sessionId = sessionIdFromEvent(event);
          if (sessionId !== undefined) {
            lastActivitySessionId = sessionId;
            if (attachmentProv !== undefined && !attachmentActivityRecorded) {
              attachmentActivityRecorded = true;
              enqueueActivitySignal(sessionId, {
                source: "process",
                status: "running",
                observedAt: new Date().toISOString(),
                detail: "prompt attachments forwarded",
                attachments: [...attachmentProv]
              });
            }
          }
          enqueueActivitySignal(sessionId, activityClassifier.classifyStreamEvent(event));
        }
        usagePersistence.capture(events);
      });
    } finally {
      await usagePersistence.flush();
    }
    await recordProcessResult(exit.code, exit.stderr, exit.stdout);
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
    if (resumeSessionId === undefined || headlessStreamMode === undefined) {
      console.error("session resume: missing session id or stream mode");
      return EXIT.USAGE;
    }
    const stream = headlessStreamMode;
    const sid = resumeSessionId;
    const known = repo.resolveSessionKey(sid);
    const resumeWorkspace = explicitWorkspace ?? known?.workspacePath ?? workspace;
    const imgErr = consumeImageFlagErrors(flags);
    if (imgErr !== undefined) {
      console.error(`session resume: ${imgErr}`);
      return EXIT.USAGE;
    }
    const rawImages = imagePathsFromFlags(flags);
    if (rawImages.length > 0) {
      const p = flags["prompt"];
      if (typeof p !== "string" || p.trim().length === 0) {
        console.error("session resume: --prompt is required when using --image");
        return EXIT.USAGE;
      }
    }
    const prep = await preparePromptAttachmentLaunch(resumeWorkspace, "cli", rawImages, stream);
    if ("exit" in prep) {
      return prep.exit;
    }
    const norm = new StreamNormalizerState;
    const textState = {
      lastAssistantBySession: new Map
    };
    await activityManager.recordSignal(sid, {
      source: "process",
      status: "running",
      observedAt: new Date().toISOString(),
      detail: "resume process started",
      ...prep.provenance.length > 0 ? { attachments: [...prep.provenance] } : {}
    });
    let exit;
    try {
      exit = await resumeStreaming(buildResumeRunOptions(resumeWorkspace, sid, flags, prep.ok), (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        captureActivityEvents(events, sid);
      });
    } finally {
      await usagePersistence.flush();
    }
    await recordProcessResult(exit.code, exit.stderr, exit.stdout, sid);
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
    if (latest === undefined || latest.localSessionId === undefined && latest.cursorChatId === undefined) {
      console.error("no session to continue");
      return EXIT.NOT_FOUND;
    }
    const sid = latest.localSessionId ?? latest.cursorChatId ?? "";
    if (headlessStreamMode === undefined) {
      console.error("session continue: missing stream mode");
      return EXIT.USAGE;
    }
    const stream = headlessStreamMode;
    const imgErrContinue = consumeImageFlagErrors(flags);
    if (imgErrContinue !== undefined) {
      console.error(`session continue: ${imgErrContinue}`);
      return EXIT.USAGE;
    }
    if (imagePathsFromFlags(flags).length > 0) {
      console.error("session continue: --image is not supported");
      return EXIT.USAGE;
    }
    const textState = {
      lastAssistantBySession: new Map
    };
    const norm = new StreamNormalizerState;
    await activityManager.recordSignal(sid, {
      source: "process",
      status: "running",
      observedAt: new Date().toISOString(),
      detail: "continue process started"
    });
    let exit;
    try {
      exit = await resumeStreaming(buildResumeRunOptions(workspace, sid, flags), (line) => {
        const events = norm.processLine(line);
        emitStreamedAgentEvents(stream, events, textState);
        captureActivityEvents(events, sid);
      });
    } finally {
      await usagePersistence.flush();
    }
    await recordProcessResult(exit.code, exit.stderr, exit.stdout, sid);
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
    const proc = spawn4("cursor-agent", ["--resume", target], {
      cwd: attachWorkspace,
      stdio: "inherit"
    });
    try {
      const code = await new Promise((resolve10, reject) => {
        proc.once("close", (exitCode, signal) => {
          if (signal !== null) {
            resolve10(EXIT.OK);
            return;
          }
          resolve10(exitCode === 0 ? EXIT.OK : EXIT.CURSOR);
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
async function runGroup(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("group: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group create: missing name");
      return EXIT.USAGE;
    }
    const g = await createGroup(name);
    if (json) {
      printJson(g);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await listGroups();
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
    const g = await getGroup(name);
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
  if (sub === "pause") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group pause: missing name");
      return EXIT.USAGE;
    }
    const g = await pauseGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(`paused ${g.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "resume") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group resume: missing name");
      return EXIT.USAGE;
    }
    const g = await resumeGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(g);
    } else {
      console.log(`resumed ${g.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "delete") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group delete: missing name");
      return EXIT.USAGE;
    }
    const g = await getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (g.lastRun?.status === "running" && flags["force"] !== true) {
      console.error("group delete: latest run is running; use --force");
      return EXIT.ERR;
    }
    const deleted = await deleteGroup(name);
    if (deleted === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson({ deleted: true, group: deleted });
    } else {
      console.log(`deleted ${deleted.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "watch") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group watch: missing name");
      return EXIT.USAGE;
    }
    const intervalSeconds = parsePositiveIntegerFlag(flags, "interval", 2);
    if (intervalSeconds === undefined) {
      console.error("group watch: --interval must be a positive integer");
      return EXIT.USAGE;
    }
    const repo = await openRepo();
    try {
      await repo.importTranscriptsFromFilesystem();
      const activityManager = createActivityManager({ sessions: repo });
      while (true) {
        const g = await getGroup(name);
        if (g === undefined) {
          console.error("group not found");
          return EXIT.NOT_FOUND;
        }
        const snapshot = await deriveGroupProgressSnapshot(g, {
          getActivity: (sessionId) => activityManager.getSessionActivity(sessionId),
          now: () => new Date().toISOString()
        });
        if (json) {
          if (flags["once"] === true) {
            printJson(snapshot);
          } else {
            console.log(JSON.stringify(snapshot));
          }
        } else {
          renderGroupProgressHuman(snapshot);
        }
        if (flags["once"] === true || snapshot.run === undefined || isTerminalRunStatus(snapshot.run.status)) {
          return EXIT.OK;
        }
        await sleep3(intervalSeconds * 1000);
        await repo.importTranscriptsFromFilesystem();
      }
    } finally {
      repo.close();
    }
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group add: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await addWorkspaceToGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "remove") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group remove: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    await removeWorkspaceFromGroup(name, ws);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("group run: missing name");
      return EXIT.USAGE;
    }
    const prompt = typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("group run: --prompt is required");
      return EXIT.USAGE;
    }
    const g = await getGroup(name);
    if (g === undefined) {
      console.error("group not found");
      return EXIT.NOT_FOUND;
    }
    if (g.lifecycleState === "paused") {
      console.error("group run: group is paused");
      return EXIT.ERR;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("group run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const gw = getWorkspace(flags);
    const imgErrGroup = consumeImageFlagErrors(flags);
    if (imgErrGroup !== undefined) {
      console.error(`group run: ${imgErrGroup}`);
      return EXIT.USAGE;
    }
    const rawGroupImages = imagePathsFromFlags(flags);
    const grpPrep = await preparePromptAttachmentLaunch(gw, "group", rawGroupImages, stream);
    if ("exit" in grpPrep) {
      return grpPrep.exit;
    }
    const repo = await openRepo();
    const activityManager = createActivityManager({ sessions: repo });
    const activityClassifier = createActivitySignalClassifier();
    let groupWriteChain = Promise.resolve();
    const enqueueGroupRunUpdate = (nextRun, lifecycleState) => {
      groupWriteChain = groupWriteChain.then(async () => {
        await updateGroupRun(name, {
          ...lifecycleState !== undefined ? { lifecycleState } : {},
          lastRun: nextRun
        });
      });
    };
    let run = initialRunRecord(g, prompt, grpPrep.provenance.length > 0 ? grpPrep.provenance : undefined);
    enqueueGroupRunUpdate(run, "active");
    await groupWriteChain;
    for (const w of g.workspaces) {
      const latest = await getGroup(name);
      if (latest?.lifecycleState === "paused") {
        run = finishRunRecord(run, "paused");
        enqueueGroupRunUpdate(run, "paused");
        await groupWriteChain;
        return EXIT.OK;
      }
      const startedAt = new Date().toISOString();
      run = updateRunWorkspace(run, w, {
        status: "running",
        startedAt
      });
      enqueueGroupRunUpdate(run);
      await groupWriteChain;
      const norm = new StreamNormalizerState;
      const textState = {
        lastAssistantBySession: new Map
      };
      const usagePersistence = createUsagePersistenceChain(repo);
      let activityWriteChain = Promise.resolve();
      let lastSessionId;
      let workspaceAttachmentRecorded = false;
      const enqueueActivitySignal = (sessionId, signal) => {
        activityWriteChain = activityWriteChain.then(() => recordActivitySignal(activityManager, sessionId, signal));
      };
      let exit;
      try {
        exit = await runHeadlessStreamingImpl(buildHeadlessRunOptions(resolve9(w), prompt, flags, grpPrep.ok), (line) => {
          const events = norm.processLine(line);
          emitStreamedAgentEvents(stream, events, textState);
          for (const event of events) {
            const sessionId = sessionIdFromEvent(event);
            if (sessionId !== undefined) {
              lastSessionId = sessionId;
              if (grpPrep.provenance.length > 0 && !workspaceAttachmentRecorded) {
                workspaceAttachmentRecorded = true;
                enqueueActivitySignal(sessionId, {
                  source: "process",
                  status: "running",
                  observedAt: new Date().toISOString(),
                  detail: "group run prompt attachments forwarded",
                  attachments: [...grpPrep.provenance]
                });
              }
              run = updateRunWorkspace(run, w, {
                localSessionId: sessionId,
                status: "running"
              });
              enqueueGroupRunUpdate(run);
            }
            enqueueActivitySignal(sessionId, activityClassifier.classifyStreamEvent(event));
          }
          usagePersistence.capture(events);
        });
      } finally {
        await usagePersistence.flush();
      }
      const completedAt = new Date().toISOString();
      const workspaceUpdate = {
        status: exit.code === 0 || exit.code === null ? "completed" : "failed",
        completedAt
      };
      if (exit.code !== null) {
        run = updateRunWorkspace(run, w, {
          ...workspaceUpdate,
          exitCode: exit.code
        });
      } else {
        run = updateRunWorkspace(run, w, workspaceUpdate);
      }
      enqueueGroupRunUpdate(run);
      await groupWriteChain;
      enqueueActivitySignal(lastSessionId, activityClassifier.classifyProcessResult(exit.code, exit.stderr, exit.stdout));
      await activityWriteChain;
      if (isTrustFailureMessage(exit.stderr)) {
        run = finishRunRecord(run, "failed");
        enqueueGroupRunUpdate(run, "failed");
        await groupWriteChain;
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        run = finishRunRecord(run, "failed");
        enqueueGroupRunUpdate(run, "failed");
        await groupWriteChain;
        console.error(exit.stderr || `run failed in ${w}`);
        return EXIT.CURSOR;
      }
      await repo.importTranscriptsFromFilesystem();
    }
    run = finishRunRecord(run, "completed");
    enqueueGroupRunUpdate(run, "completed");
    await groupWriteChain;
    return EXIT.OK;
  }
  console.error(`Unknown group subcommand: ${sub}`);
  return EXIT.USAGE;
}
function isQueueItemStatus(value) {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "skipped";
}
function isOperatorQueueItemStatus(value) {
  return value === "pending" || value === "completed" || value === "failed" || value === "skipped";
}
function isQueueItemMode(value) {
  return value === "auto" || value === "manual";
}
function parseQueueIndex(flags, key) {
  const value = flags[key];
  if (typeof value !== "string") {
    return;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
async function runQueue(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("queue: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  const json = flags["json"] === true;
  if (sub === "create") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue create: missing name");
      return EXIT.USAGE;
    }
    const ws = getWorkspace(flags);
    const q = await createQueue(name, ws);
    if (json) {
      printJson(q);
    } else {
      console.log(name);
    }
    return EXIT.OK;
  }
  if (sub === "list") {
    const rows = await listQueues();
    if (json) {
      printJson({ queues: rows });
    } else {
      const repo = await openRepo();
      try {
        const activityManager = createActivityManager({ sessions: repo });
        await repo.importTranscriptsFromFilesystem();
        for (const q of rows) {
          const snapshot = await deriveQueueProgressSnapshot(q, {
            getActivity: (sessionId) => activityManager.getSessionActivity(sessionId),
            now: () => new Date().toISOString()
          });
          console.log(renderQueueProgressLine(snapshot));
        }
      } finally {
        repo.close();
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
    const q = await getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      const repo = await openRepo();
      try {
        const activityManager = createActivityManager({ sessions: repo });
        await repo.importTranscriptsFromFilesystem();
        const snapshot = await deriveQueueProgressSnapshot(q, {
          getActivity: (sessionId) => activityManager.getSessionActivity(sessionId),
          now: () => new Date().toISOString()
        });
        renderQueueProgressHuman(snapshot);
      } finally {
        repo.close();
      }
    }
    return EXIT.OK;
  }
  if (sub === "pause") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue pause: missing name");
      return EXIT.USAGE;
    }
    const q = await pauseQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`paused ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "resume") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue resume: missing name");
      return EXIT.USAGE;
    }
    const q = await resumeQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`resumed ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "delete") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue delete: missing name");
      return EXIT.USAGE;
    }
    const q = await getQueue(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (q.lastRun?.status === "running" && flags["force"] !== true) {
      console.error("queue delete: latest run is running; use --force");
      return EXIT.ERR;
    }
    const deleted = await deleteQueue(name);
    if (deleted === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson({ deleted: true, queue: deleted });
    } else {
      console.log(`deleted ${deleted.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "update") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue update: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue update: --item is required");
      return EXIT.USAGE;
    }
    const prompt = typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    const rawStatus = flags["status"];
    if (rawStatus !== undefined && (typeof rawStatus !== "string" || !isOperatorQueueItemStatus(rawStatus))) {
      console.error("queue update: --status must be pending, completed, failed, or skipped");
      return EXIT.USAGE;
    }
    if (prompt === undefined && rawStatus === undefined) {
      console.error("queue update: --prompt or --status is required");
      return EXIT.USAGE;
    }
    const q = await updateQueueItem(name, item, {
      ...prompt !== undefined ? { prompt } : {},
      ...typeof rawStatus === "string" && isQueueItemStatus(rawStatus) ? { status: rawStatus } : {}
    });
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (!q.items.some((queueItem) => queueItem.id === item)) {
      console.error("queue item not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`updated ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "move") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue move: missing name");
      return EXIT.USAGE;
    }
    const from = parseQueueIndex(flags, "from");
    const to = parseQueueIndex(flags, "to");
    if (from === undefined || to === undefined) {
      console.error("queue move: --from and --to must be zero-based indexes");
      return EXIT.USAGE;
    }
    const before = await getQueue(name);
    if (before === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (from >= before.items.length || to >= before.items.length || before.items.length === 0) {
      console.error("queue move: index out of range");
      return EXIT.USAGE;
    }
    const q = await moveQueueItem(name, from, to);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`moved ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "mode") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue mode: missing name");
      return EXIT.USAGE;
    }
    const item = typeof flags["item"] === "string" ? flags["item"] : undefined;
    if (item === undefined) {
      console.error("queue mode: --item is required");
      return EXIT.USAGE;
    }
    const mode = flags["mode"];
    if (typeof mode !== "string" || !isQueueItemMode(mode)) {
      console.error("queue mode: --mode must be auto or manual");
      return EXIT.USAGE;
    }
    const q = await updateQueueItem(name, item, { mode });
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (!q.items.some((queueItem) => queueItem.id === item)) {
      console.error("queue item not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`set ${item} mode=${mode}`);
    }
    return EXIT.OK;
  }
  if (sub === "stop") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue stop: missing name");
      return EXIT.USAGE;
    }
    const q = await requestQueueStop(name);
    if (q === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (json) {
      printJson(q);
    } else {
      console.log(`stopped ${q.name}`);
    }
    return EXIT.OK;
  }
  if (sub === "add") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue add: missing name");
      return EXIT.USAGE;
    }
    const prompt = typeof flags["prompt"] === "string" ? flags["prompt"] : undefined;
    if (prompt === undefined) {
      console.error("queue add: --prompt is required");
      return EXIT.USAGE;
    }
    const queueRef = await getQueue(name);
    if (queueRef === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    const imgErrAdd = consumeImageFlagErrors(flags);
    if (imgErrAdd !== undefined) {
      console.error(`queue add: ${imgErrAdd}`);
      return EXIT.USAGE;
    }
    const rawAddImages = imagePathsFromFlags(flags);
    const attachStream = flags["json"] === true ? "json" : "text";
    const prepAdd = await preparePromptAttachmentLaunch(queueRef.workspace, "queue", rawAddImages, attachStream);
    if ("exit" in prepAdd) {
      return prepAdd.exit;
    }
    const qAdded = await addQueueItem(name, prompt, prepAdd.provenance.length > 0 ? { attachments: [...prepAdd.provenance] } : undefined);
    if (json) {
      printJson(qAdded);
    }
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
    await removeQueueItem(name, item);
    return EXIT.OK;
  }
  if (sub === "run") {
    const name = pos[0];
    if (name === undefined) {
      console.error("queue run: missing name");
      return EXIT.USAGE;
    }
    const initialQueue = await getQueue(name);
    if (initialQueue === undefined) {
      console.error("queue not found");
      return EXIT.NOT_FOUND;
    }
    if (initialQueue.lifecycleState === "paused") {
      console.error("queue run: queue is paused");
      return EXIT.ERR;
    }
    if (initialQueue.lifecycleState === "stopped") {
      console.error("queue run: queue is stopped; resume before running");
      return EXIT.ERR;
    }
    const sm = resolveStreamMode(flags);
    if ("error" in sm) {
      console.error("queue run: --stream must be text, json, or events");
      return EXIT.USAGE;
    }
    const stream = sm.mode;
    const queueRunImgErr = consumeImageFlagErrors(flags);
    if (queueRunImgErr !== undefined) {
      console.error(`queue run: ${queueRunImgErr}`);
      return EXIT.USAGE;
    }
    const runRawPaths = imagePathsFromFlags(flags);
    const prepRunLevel = await preparePromptAttachmentLaunch(initialQueue.workspace, "queue", runRawPaths, stream);
    if ("exit" in prepRunLevel) {
      return prepRunLevel.exit;
    }
    const repo = await openRepo();
    const activityManager = createActivityManager({ sessions: repo });
    const activityClassifier = createActivitySignalClassifier();
    let queueWriteChain = Promise.resolve();
    const enqueueQueueRunUpdate = (run2, lifecycleState, items) => {
      queueWriteChain = queueWriteChain.then(async () => {
        await updateQueueRun(name, {
          ...lifecycleState !== undefined ? { lifecycleState } : {},
          lastRun: run2,
          ...items !== undefined ? { items } : {}
        });
      });
    };
    let run = initialQueueRunRecord(initialQueue, prepRunLevel.provenance.length > 0 ? prepRunLevel.provenance : undefined);
    enqueueQueueRunUpdate(run, "active");
    await queueWriteChain;
    for (const item of initialQueue.items) {
      if (item.status !== "pending" || item.mode === "manual") {
        continue;
      }
      const latest = await getQueue(name);
      if (latest === undefined) {
        console.error("queue not found");
        return EXIT.NOT_FOUND;
      }
      if (latest.lifecycleState === "paused") {
        run = finishQueueRunRecord(run, "paused");
        enqueueQueueRunUpdate(run, "paused");
        await queueWriteChain;
        return EXIT.OK;
      }
      if (latest.lifecycleState === "stopped" || latest.stopRequestedAt !== undefined) {
        run = finishQueueRunRecord(run, "stopped");
        enqueueQueueRunUpdate(run, "stopped");
        await queueWriteChain;
        return EXIT.OK;
      }
      const startedAt = new Date().toISOString();
      let currentItems = latest.items.map((queueItem) => queueItem.id === item.id ? {
        ...queueItem,
        status: "running",
        startedAt,
        updatedAt: startedAt
      } : queueItem);
      run = updateQueueRunItem(run, item.id, "running");
      enqueueQueueRunUpdate(run, undefined, currentItems);
      await queueWriteChain;
      const norm = new StreamNormalizerState;
      const textState = {
        lastAssistantBySession: new Map
      };
      const mergedPrep = await preparePromptAttachmentLaunchFromInputs(initialQueue.workspace, "queue", mergeQueueItemAttachmentInputs(item, runRawPaths), stream);
      if ("exit" in mergedPrep) {
        return mergedPrep.exit;
      }
      const usagePersistence = createUsagePersistenceChain(repo);
      let activityWriteChain = Promise.resolve();
      let lastSessionId;
      let queueItemAttachmentRecorded = false;
      const enqueueActivitySignal = (sessionId, signal) => {
        activityWriteChain = activityWriteChain.then(() => recordActivitySignal(activityManager, sessionId, signal));
      };
      let exit;
      try {
        exit = await runHeadlessStreamingImpl(buildHeadlessRunOptions(initialQueue.workspace, item.prompt, flags, mergedPrep.ok), (line) => {
          const events = norm.processLine(line);
          emitStreamedAgentEvents(stream, events, textState);
          for (const event of events) {
            const sessionId = sessionIdFromEvent(event);
            if (sessionId !== undefined) {
              lastSessionId = sessionId;
              if (mergedPrep.provenance.length > 0 && !queueItemAttachmentRecorded) {
                queueItemAttachmentRecorded = true;
                enqueueActivitySignal(sessionId, {
                  source: "process",
                  status: "running",
                  observedAt: new Date().toISOString(),
                  detail: "queue run prompt attachments forwarded",
                  attachments: [...mergedPrep.provenance]
                });
              }
              currentItems = currentItems.map((queueItem) => queueItem.id === item.id ? {
                ...queueItem,
                localSessionId: sessionId,
                updatedAt: new Date().toISOString()
              } : queueItem);
              enqueueQueueRunUpdate(run, undefined, currentItems);
            }
            enqueueActivitySignal(sessionId, activityClassifier.classifyStreamEvent(event));
          }
          usagePersistence.capture(events);
        });
      } finally {
        await usagePersistence.flush();
      }
      enqueueActivitySignal(lastSessionId, activityClassifier.classifyProcessResult(exit.code, exit.stderr, exit.stdout));
      await activityWriteChain;
      const completedAt = new Date().toISOString();
      const itemStatus = exit.code === 0 || exit.code === null ? "completed" : "failed";
      currentItems = currentItems.map((queueItem) => queueItem.id === item.id ? {
        ...queueItem,
        status: itemStatus,
        completedAt,
        updatedAt: completedAt,
        result: { exitCode: exit.code }
      } : queueItem);
      run = updateQueueRunItem(run, item.id, itemStatus);
      enqueueQueueRunUpdate(run, undefined, currentItems);
      await queueWriteChain;
      if (isTrustFailureMessage(exit.stderr)) {
        run = finishQueueRunRecord(run, "failed");
        enqueueQueueRunUpdate(run, "failed");
        await queueWriteChain;
        console.error(exit.stderr);
        return EXIT.TRUST;
      }
      if (exit.code !== 0 && exit.code !== null) {
        run = finishQueueRunRecord(run, "failed");
        enqueueQueueRunUpdate(run, "failed");
        await queueWriteChain;
        console.error(exit.stderr || `cursor-agent exited with ${exit.code}`);
        return EXIT.CURSOR;
      }
      await repo.importTranscriptsFromFilesystem();
    }
    run = finishQueueRunRecord(run, "completed");
    enqueueQueueRunUpdate(run, "completed");
    await queueWriteChain;
    return EXIT.OK;
  }
  console.error(`Unknown queue subcommand: ${sub}`);
  return EXIT.USAGE;
}
async function runSkill(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    console.error("skill: missing subcommand");
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
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
function parseAuthKeepaliveCommandArgs(flags) {
  const model = flags["model"];
  if (typeof model !== "string" || model.trim().length === 0) {
    return { error: "auth keepalive: --model is required" };
  }
  const intervalMs = parseOptionalPositiveIntegerFlag(flags, "interval-ms");
  if (intervalMs === null) {
    return {
      error: "auth keepalive: --interval-ms must be a positive integer"
    };
  }
  const timeoutMs = parseOptionalPositiveIntegerFlag(flags, "timeout-ms");
  if (timeoutMs === null) {
    return { error: "auth keepalive: --timeout-ms must be a positive integer" };
  }
  return {
    args: {
      model: model.trim(),
      once: flags["once"] === true,
      ...intervalMs !== undefined ? { intervalMs } : {},
      ...timeoutMs !== undefined ? { timeoutMs } : {}
    }
  };
}
async function runAuth(argv) {
  const [sub, ...rest] = argv;
  if (sub !== "keepalive") {
    console.error(sub === undefined ? "auth: missing subcommand" : `Unknown auth subcommand: ${sub}`);
    return EXIT.USAGE;
  }
  const { rest: pos, flags } = parseFlags2(rest);
  if (pos.length > 0) {
    console.error("auth keepalive: unexpected positional arguments");
    return EXIT.USAGE;
  }
  const parsed = parseAuthKeepaliveCommandArgs(flags);
  if ("error" in parsed) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const { model, once: once3, intervalMs, timeoutMs } = parsed.args;
  const auth = resolveCursorAuthEnv();
  const keepaliveOptions = {
    model,
    ...auth,
    ...intervalMs !== undefined ? { intervalMs } : {},
    ...timeoutMs !== undefined ? { timeoutMs } : {},
    workspace: process.cwd()
  };
  if (once3) {
    const keepalive2 = new CursorAuthKeepAlive(keepaliveOptions);
    await keepalive2.probeNow();
    const s2 = keepalive2.status();
    if (s2.lastSuccessAt !== undefined) {
      console.log(`ok model=${model} at=${s2.lastSuccessAt}`);
      return EXIT.OK;
    }
    console.error(`probe failed model=${model} reason=${s2.lastFailureMessage ?? "unknown"}`);
    return EXIT.CURSOR;
  }
  const keepalive = new CursorAuthKeepAlive(keepaliveOptions);
  console.log(`auth keepalive started model=${model}`);
  keepalive.start();
  await waitForTerminationSignal();
  keepalive.stop();
  const s = keepalive.status();
  console.log(`auth keepalive stopped probes=${s.probeCount} lastSuccess=${s.lastSuccessAt ?? "none"} lastFailure=${s.lastFailureAt ?? "none"}`);
  return EXIT.OK;
}
// src/main.ts
async function main(argv) {
  return runCli([...argv]);
}
if (false) {}
export {
  tool,
  runCli,
  resolveCursorAuthEnv,
  preferredCompatOperationKind,
  main,
  isGraphqlAsyncResult,
  getGraphqlSchema,
  getCompatCommandCapability,
  executeGraphqlOperation,
  decideCompatCommand,
  createToolRegistry,
  createDefaultCompatCommandDispatcher,
  createCursorAgentSdk,
  createCompatCommandDispatcher,
  createAppServerCompatMetadata,
  compatAuthPermissionForCapability,
  authorizeCompatCommand,
  ToolRegistryError,
  ToolRegistry,
  CursorAuthKeepAlive,
  CompatCommandError,
  COMPAT_COMMAND_CAPABILITIES
};
