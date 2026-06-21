/**
 * Desktop-side ACP session orchestration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  DesktopConfigOption,
  DesktopMessage,
  DesktopPermissionRequest,
  DesktopProject,
  DesktopQuestionRequest,
  DesktopSessionActivated,
  DesktopSessionCreated,
  DesktopSessionUpdate,
  DesktopSnapshot,
  DesktopSettings,
  DesktopThread,
  RecodeRuntimeMode,
  SessionMode,
} from "../../web/src/desktop-rpc.ts";
import { AcpJsonRpcClient, isRecord, type JsonRpcRequest } from "./acp-json-rpc-client.ts";
import { findRecodeRepoRoot } from "./child-process.ts";

interface StoredDesktopState {
  projects: DesktopProject[];
  threads: DesktopThread[];
  messages: Record<string, DesktopMessage[]>;
  settings: DesktopSettings;
}

interface ActiveDesktopSession {
  threadId: string;
  acpSessionId: string;
  workspacePath: string;
  client: AcpJsonRpcClient;
  configOptions: DesktopConfigOption[];
  assistantMessageId?: string;
  assistantProtocolMessageId?: string;
  pendingPermissions: Map<string, (result: unknown) => void>;
  pendingQuestions: Map<string, (result: unknown) => void>;
}

export interface DesktopSessionManagerOptions {
  sendSessionUpdate: (update: DesktopSessionUpdate) => void;
  sendPermissionRequest: (request: DesktopPermissionRequest) => void;
  sendQuestionRequest: (request: DesktopQuestionRequest) => void;
  sendError: (threadId: string | undefined, message: string) => void;
  statePath?: string;
}

const STATE_DIR = join(homedir(), ".recode");
const STATE_PATH = join(STATE_DIR, "desktop-sessions.json");

export class DesktopSessionManager {
  readonly #options: DesktopSessionManagerOptions;
  readonly #active = new Map<string, ActiveDesktopSession>();
  readonly #statePath: string;
  #state: StoredDesktopState;

  constructor(options: DesktopSessionManagerOptions) {
    this.#options = options;
    this.#statePath = options.statePath ?? STATE_PATH;
    this.#state = loadStoredState(this.#statePath);
  }

  snapshot(): DesktopSnapshot {
    return {
      projects: this.#state.projects,
      threads: this.#state.threads,
      messages: {},
      settings: this.#state.settings,
    };
  }

  getThreadMessages(threadId: string): { messages: DesktopMessage[] } {
    this.#getThread(threadId);
    return { messages: [...(this.#state.messages[threadId] ?? [])] };
  }

  setRuntimeMode(runtimeMode: RecodeRuntimeMode): DesktopSettings {
    this.#state.settings = withDetectedRepoRoot({
      ...this.#state.settings,
      runtimeMode,
    });
    this.#save();
    return this.#state.settings;
  }

  setRecodeRepoRoot(path: string): DesktopSettings {
    if (!isRecodeRepoRoot(path)) {
      throw new Error("Selected folder is not a Recode repo root. Pick the folder with package.json and src/index.ts.");
    }
    this.#state.settings = withDetectedRepoRoot({
      ...this.#state.settings,
      runtimeMode: "dev",
      recodeRepoRoot: path,
    });
    this.#save();
    return this.#state.settings;
  }

  setGpuAccelerationDisabled(disabled: boolean): DesktopSettings {
    this.#state.settings = withDetectedRepoRoot({
      ...this.#state.settings,
      gpuAccelerationDisabled: disabled,
    });
    this.#save();
    return this.#state.settings;
  }

  addWorkspace(workspacePath: string): DesktopProject {
    const project = this.#upsertProject(workspacePath);
    this.#save();
    return project;
  }

  async createSession(params: {
    workspacePath: string;
    title?: string;
    mode?: SessionMode;
    model?: string;
  }): Promise<DesktopSessionCreated> {
    const project = this.#upsertProject(params.workspacePath);
    const client = this.#createClient(params.workspacePath);
    await client.initialize();
    const setup = await client.request("session/new", { cwd: params.workspacePath });
    const setupRecord = expectRecord(setup, "session/new response");
    const acpSessionId = expectString(setupRecord.sessionId, "sessionId");
    const configOptions = readConfigOptions(setupRecord.configOptions);
    const currentModel = readCurrentConfigValue(configOptions, "model") ?? "default";
    const currentMode = readSessionMode(readCurrentConfigValue(configOptions, "mode")) ?? "build";

    const thread: DesktopThread = {
      id: acpSessionId,
      projectId: project.id,
      title: params.title ?? "Untitled",
      model: currentModel,
      mode: currentMode,
      status: "idle",
      age: "now",
    };

    this.#state.threads = [thread, ...this.#state.threads.filter((item) => item.id !== thread.id)];
    this.#state.messages[thread.id] = this.#state.messages[thread.id] ?? [];

    const session: ActiveDesktopSession = {
      threadId: thread.id,
      acpSessionId,
      workspacePath: params.workspacePath,
      client,
      configOptions,
      pendingPermissions: new Map(),
      pendingQuestions: new Map(),
    };
    this.#active.set(thread.id, session);

    if (params.mode !== undefined && params.mode !== currentMode) {
      await this.setConfigOption({ threadId: thread.id, configId: "mode", value: params.mode });
    }
    const modelValues = new Set(configOptions.find((option) => option.id === "model")?.options.map((option) => option.value) ?? []);
    if (params.model !== undefined && params.model !== currentModel && modelValues.has(params.model)) {
      await this.setConfigOption({ threadId: thread.id, configId: "model", value: params.model });
    }

    this.#save();
    return { project, thread: this.#getThread(thread.id), configOptions };
  }

  async activateSession(threadId: string): Promise<DesktopSessionActivated> {
    const session = await this.#ensureActive(threadId);
    this.#applyConfigOptions(threadId, session.configOptions);
    this.#save();
    return {
      thread: { ...this.#getThread(threadId) },
      configOptions: session.configOptions,
    };
  }

  async sendPrompt(params: { threadId: string; text: string }): Promise<{ messageId: string }> {
    const session = await this.#ensureActive(params.threadId);
    const response = await session.client.request("session/prompt", {
      sessionId: session.acpSessionId,
      prompt: [{ type: "text", text: params.text }],
    });
    const record = expectRecord(response, "session/prompt response");
    return { messageId: expectString(record.messageId, "messageId") };
  }

  async cancelSession(threadId: string): Promise<{ thread: DesktopThread }> {
    const session = await this.#ensureActive(threadId);
    for (const respond of session.pendingPermissions.values()) {
      respond({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    for (const respond of session.pendingQuestions.values()) {
      respond({ dismissed: true });
    }
    session.pendingQuestions.clear();
    session.client.notify("session/cancel", { sessionId: session.acpSessionId });
    session.assistantMessageId = undefined;
    session.assistantProtocolMessageId = undefined;

    const thread = this.#getThread(threadId);
    thread.status = "idle";
    this.#save();
    this.#options.sendSessionUpdate({ thread: { ...thread } });
    return { thread: { ...thread } };
  }

  async setConfigOption(params: {
    threadId: string;
    configId: "mode" | "model";
    value: string;
  }): Promise<{ configOptions: DesktopConfigOption[] }> {
    const session = await this.#ensureActive(params.threadId);
    const response = await session.client.request("session/set_config_option", {
      sessionId: session.acpSessionId,
      configId: params.configId,
      value: params.value,
    });
    const record = expectRecord(response, "session/set_config_option response");
    const configOptions = readConfigOptions(record.configOptions);
    session.configOptions = configOptions;
    this.#applyConfigOptions(params.threadId, configOptions);
    this.#save();
    return { configOptions };
  }

  answerPermission(params: { requestId: string; optionId: string }): void {
    for (const session of this.#active.values()) {
      const respond = session.pendingPermissions.get(params.requestId);
      if (respond !== undefined) {
        session.pendingPermissions.delete(params.requestId);
        respond({
          outcome: {
            outcome: "selected",
            optionId: params.optionId,
          },
        });
        return;
      }
    }
  }

  answerQuestion(params:
    | { requestId: string; dismissed: true }
    | { requestId: string; dismissed: false; answers: { questionId: string; selectedOptionLabels: string[]; customText: string }[] }
  ): void {
    for (const session of this.#active.values()) {
      const respond = session.pendingQuestions.get(params.requestId);
      if (respond !== undefined) {
        session.pendingQuestions.delete(params.requestId);
        respond(params.dismissed ? { dismissed: true } : { dismissed: false, answers: params.answers });
        return;
      }
    }
  }

  async closeSession(threadId: string): Promise<void> {
    await this.#deactivateSession(threadId, { deleteThread: true });
    this.#state.threads = this.#state.threads.filter((thread) => thread.id !== threadId);
    delete this.#state.messages[threadId];
    this.#save();
  }

  #createClient(workspacePath: string): AcpJsonRpcClient {
    return new AcpJsonRpcClient({
      cwd: workspacePath,
      runtimeMode: this.#state.settings.runtimeMode,
      recodeRepoRoot: this.#state.settings.recodeRepoRoot,
      onNotification: (request) => this.#handleNotification(request),
      onClientRequest: (request, respond) => this.#handleClientRequest(request, respond),
      onExit: () => undefined,
      onError: (message) => this.#options.sendError(undefined, message),
    });
  }

  async #ensureActive(threadId: string): Promise<ActiveDesktopSession> {
    const existing = this.#active.get(threadId);
    if (existing !== undefined) return existing;

    const thread = this.#getThread(threadId);
    const project = this.#state.projects.find((item) => item.id === thread.projectId);
    if (project === undefined) {
      throw new Error(`Project not found for thread: ${threadId}`);
    }

    const client = this.#createClient(project.path);
    await client.initialize();
    const setup = await client.request("session/resume", {
      sessionId: threadId,
      cwd: project.path,
    });
    const setupRecord = expectRecord(setup, "session/resume response");
    const acpSessionId = expectString(setupRecord.sessionId, "sessionId");
    const session: ActiveDesktopSession = {
      threadId,
      acpSessionId,
      workspacePath: project.path,
      client,
      configOptions: readConfigOptions(setupRecord.configOptions),
      pendingPermissions: new Map(),
      pendingQuestions: new Map(),
    };
    this.#active.set(threadId, session);
    this.#applyConfigOptions(threadId, session.configOptions);
    this.#save();
    return session;
  }

  #handleNotification(request: JsonRpcRequest): void {
    if (request.method !== "session/update") return;
    const params = expectRecord(request.params, "session/update params");
    const sessionId = expectString(params.sessionId, "sessionId");
    const session = this.#active.get(sessionId);
    if (session === undefined) return;
    const update = expectRecord(params.update, "session/update update");
    this.#applySessionUpdate(session, update);
  }

  async #deactivateSession(
    threadId: string,
    options: { deleteThread: boolean }
  ): Promise<void> {
    const session = this.#active.get(threadId);
    if (session === undefined) return;

    for (const respond of session.pendingPermissions.values()) {
      respond({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    for (const respond of session.pendingQuestions.values()) {
      respond({ dismissed: true });
    }
    session.pendingQuestions.clear();

    try {
      await session.client.request("session/close", { sessionId: session.acpSessionId });
    } catch {
      // Closing is best-effort; the local client process is still torn down below.
    } finally {
      session.client.close();
      this.#active.delete(threadId);
    }

    if (!options.deleteThread) {
      const thread = this.#state.threads.find((item) => item.id === threadId);
      if (thread !== undefined && (thread.status === "running" || thread.status === "requires_action")) {
        thread.status = "idle";
        this.#options.sendSessionUpdate({ thread: { ...thread } });
        this.#save();
      }
    }
  }

  #handleClientRequest(request: JsonRpcRequest, respond: (result: unknown) => void): void {
    if (request.method === "session/request_permission") {
      const params = expectRecord(request.params, "permission params");
      const sessionId = expectString(params.sessionId, "sessionId");
      const session = this.#active.get(sessionId);
      if (session === undefined || request.id === undefined) {
        respond({ outcome: { outcome: "cancelled" } });
        return;
      }
      const toolCall = expectRecord(params.toolCall, "toolCall");
      const options = Array.isArray(params.options) ? params.options : [];
      session.pendingPermissions.set(String(request.id), respond);
      this.#options.sendPermissionRequest({
        id: String(request.id),
        threadId: session.threadId,
        title: readString(toolCall.title) ?? "Tool approval requested",
        kind: readString(toolCall.kind) ?? "execute",
        options: options.filter(isRecord).map((option) => ({
          optionId: readString(option.optionId) ?? "",
          name: readString(option.name) ?? "Option",
          kind: readString(option.kind) ?? "unknown",
        })).filter((option) => option.optionId.length > 0),
      });
      return;
    }

    if (request.method === "_recode/question") {
      const params = expectRecord(request.params, "question params");
      const sessionId = expectString(params.sessionId, "sessionId");
      const session = this.#active.get(sessionId);
      if (session === undefined || request.id === undefined) {
        respond({ dismissed: true });
        return;
      }
      const questions = readQuestionPrompts(params.questions);
      if (questions.length === 0) {
        respond({ dismissed: true });
        return;
      }
      session.pendingQuestions.set(String(request.id), respond);
      this.#options.sendQuestionRequest({
        id: String(request.id),
        threadId: session.threadId,
        questions,
      });
      return;
    }

    respond({});
  }

  #applySessionUpdate(session: ActiveDesktopSession, update: Record<string, unknown>): void {
    const kind = readString(update.sessionUpdate);
    const thread = this.#getThread(session.threadId);
    let message: DesktopMessage | undefined;
    let appendToMessageId: string | undefined;
    let configOptions: DesktopConfigOption[] | undefined;

    if (kind === "user_message" || kind === "user_message_chunk") {
      message = {
        id: readString(update.messageId) ?? crypto.randomUUID(),
        threadId: thread.id,
        role: "user",
        body: readContentText(update.content),
      };
      this.#pushMessage(message);
    } else if (kind === "agent_message_chunk") {
      const text = readContentText(update.content);
      const updateMessageId = readString(update.messageId);
      if (
        session.assistantMessageId === undefined
        || (updateMessageId !== undefined && updateMessageId !== session.assistantProtocolMessageId)
      ) {
        session.assistantProtocolMessageId = updateMessageId;
        session.assistantMessageId = updateMessageId === undefined
          ? crypto.randomUUID()
          : `${updateMessageId}:${crypto.randomUUID()}`;
        message = {
          id: session.assistantMessageId,
          threadId: thread.id,
          role: "assistant",
          body: text,
        };
        this.#pushMessage(message);
      } else {
        appendToMessageId = session.assistantMessageId;
        message = {
          id: session.assistantMessageId,
          threadId: thread.id,
          role: "assistant",
          body: text,
        };
        this.#appendMessage(thread.id, session.assistantMessageId, text);
      }
    } else if (kind === "tool_call") {
      // A later assistant chunk belongs after this tool row, matching the TUI
      // transcript order for assistant -> tool -> assistant progress.
      session.assistantMessageId = undefined;
      session.assistantProtocolMessageId = undefined;
      message = {
        id: readString(update.toolCallId) ?? crypto.randomUUID(),
        threadId: thread.id,
        role: "tool",
        body: readString(update.title) ?? "Tool call",
        toolCallId: readString(update.toolCallId),
        toolKind: readString(update.kind),
        toolStatus: readToolStatus(update.status),
        toolInput: readRecord(update.rawInput),
      };
      this.#pushMessage(message);
    } else if (kind === "tool_call_update") {
      const toolCallId = readString(update.toolCallId);
      if (toolCallId !== undefined) {
        message = this.#updateToolMessage(thread.id, toolCallId, {
          ...(readString(update.title) === undefined ? {} : { body: readString(update.title)! }),
          ...(readToolStatus(update.status) === undefined ? {} : { toolStatus: readToolStatus(update.status)! }),
          ...(readToolContent(update.content) === undefined ? {} : { toolContent: readToolContent(update.content)! }),
        });
      }
    } else if (kind === "state_change") {
      const state = readString(update.state);
      thread.status = state === "running" || state === "requires_action" ? state : "idle";
      if (thread.status === "idle") {
        session.assistantMessageId = undefined;
        session.assistantProtocolMessageId = undefined;
      }
    } else if (kind === "config_option_update") {
      configOptions = readConfigOptions(update.configOptions);
      session.configOptions = configOptions;
      this.#applyConfigOptions(thread.id, configOptions);
    } else if (kind === "session_info_update") {
      thread.title = readString(update.title) ?? thread.title;
    }

    this.#save();
    this.#options.sendSessionUpdate({
      thread: { ...this.#getThread(thread.id) },
      ...(message === undefined ? {} : { message }),
      ...(kind === "tool_call_update" && message !== undefined ? { replaceMessageId: message.id } : {}),
      ...(appendToMessageId === undefined ? {} : { appendToMessageId }),
      ...(configOptions === undefined ? {} : { configOptions }),
    });
  }

  #upsertProject(workspacePath: string): DesktopProject {
    const existing = this.#state.projects.find((item) => item.path === workspacePath);
    if (existing !== undefined) return existing;

    const project: DesktopProject = {
      id: crypto.randomUUID(),
      name: basename(workspacePath),
      path: workspacePath,
    };
    this.#state.projects = [...this.#state.projects, project];
    return project;
  }

  #applyConfigOptions(threadId: string, configOptions: DesktopConfigOption[]): void {
    const thread = this.#getThread(threadId);
    const mode = readSessionMode(readCurrentConfigValue(configOptions, "mode"));
    const model = readCurrentConfigValue(configOptions, "model");
    if (mode !== undefined) thread.mode = mode;
    if (model !== undefined) thread.model = model;
  }

  #getThread(threadId: string): DesktopThread {
    const thread = this.#state.threads.find((item) => item.id === threadId);
    if (thread === undefined) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return thread;
  }

  #pushMessage(message: DesktopMessage): void {
    const messages = this.#state.messages[message.threadId] ?? [];
    this.#state.messages[message.threadId] = [...messages, message];
  }

  #appendMessage(threadId: string, messageId: string, text: string): void {
    const messages = this.#state.messages[threadId] ?? [];
    this.#state.messages[threadId] = messages.map((message) =>
      message.id === messageId ? { ...message, body: `${message.body}${text}` } : message
    );
  }

  #updateToolMessage(threadId: string, toolCallId: string, patch: Partial<DesktopMessage>): DesktopMessage | undefined {
    const messages = this.#state.messages[threadId] ?? [];
    let updated: DesktopMessage | undefined;
    this.#state.messages[threadId] = messages.map((message) => {
      if (message.id !== toolCallId && message.toolCallId !== toolCallId) return message;
      updated = { ...message, ...patch };
      return updated;
    });
    return updated;
  }

  #save(): void {
    mkdirSync(dirname(this.#statePath), { recursive: true });
    writeFileSync(this.#statePath, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
  }
}

function isRecodeRepoRoot(path: string): boolean {
  const packagePath = join(path, "package.json");
  if (!existsSync(packagePath) || !existsSync(join(path, "src", "index.ts"))) {
    return false;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
    return isRecord(packageJson) && packageJson.name === "recode";
  } catch {
    return false;
  }
}

function loadStoredState(statePath: string): StoredDesktopState {
  if (!existsSync(statePath)) {
    return { projects: [], threads: [], messages: {}, settings: withDetectedRepoRoot({ runtimeMode: "dev" }) };
  }
  const parsed = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    return { projects: [], threads: [], messages: {}, settings: withDetectedRepoRoot({ runtimeMode: "dev" }) };
  }
  return {
    projects: Array.isArray(parsed.projects) ? parsed.projects.filter(isDesktopProject) : [],
    threads: Array.isArray(parsed.threads) ? parsed.threads.filter(isDesktopThread) : [],
    messages: isRecord(parsed.messages) ? readMessages(parsed.messages) : {},
    settings: readSettings(parsed.settings),
  };
}

function readSettings(value: unknown): DesktopSettings {
  if (!isRecord(value)) {
    // Keep dev as the default while the desktop app is developed from this repo.
    // When publishing a built Recode binary, switch the default to prod.
    return withDetectedRepoRoot({ runtimeMode: "dev" });
  }
  return {
    ...withDetectedRepoRoot({
      runtimeMode: value.runtimeMode === "prod" ? "prod" : "dev",
      ...(typeof value.recodeRepoRoot === "string" ? { recodeRepoRoot: value.recodeRepoRoot } : {}),
      ...(value.gpuAccelerationDisabled === true ? { gpuAccelerationDisabled: true } : {}),
    }),
  };
}

function withDetectedRepoRoot(
  settings: Pick<DesktopSettings, "runtimeMode" | "recodeRepoRoot" | "gpuAccelerationDisabled">
): DesktopSettings {
  const detectedRepoRoot = findRecodeRepoRoot();
  return {
    runtimeMode: settings.runtimeMode,
    ...(settings.recodeRepoRoot === undefined ? {} : { recodeRepoRoot: settings.recodeRepoRoot }),
    ...(detectedRepoRoot === undefined ? {} : { detectedRepoRoot }),
    ...(settings.gpuAccelerationDisabled === true ? { gpuAccelerationDisabled: true } : {}),
  };
}

function isDesktopProject(value: unknown): value is DesktopProject {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.path === "string";
}

function isDesktopThread(value: unknown): value is DesktopThread {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.projectId === "string"
    && typeof value.title === "string"
    && typeof value.model === "string"
    && (value.mode === "build" || value.mode === "plan");
}

function readMessages(value: Record<string, unknown>): Record<string, DesktopMessage[]> {
  const messages: Record<string, DesktopMessage[]> = {};
  for (const [threadId, entries] of Object.entries(value)) {
    messages[threadId] = Array.isArray(entries) ? entries.filter(isDesktopMessage) : [];
  }
  return messages;
}

function isDesktopMessage(value: unknown): value is DesktopMessage {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.threadId === "string"
    && typeof value.body === "string"
    && (value.role === "user" || value.role === "assistant" || value.role === "tool" || value.role === "system");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readToolStatus(value: unknown): DesktopMessage["toolStatus"] | undefined {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "failed"
    ? value
    : undefined;
}

function readToolContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type === "diff") {
      const path = readString(item.path) ?? "diff";
      const oldText = readString(item.oldText) ?? "";
      const newText = readString(item.newText) ?? "";
      parts.push(`--- ${path}\n+++ ${path}\n${formatSimpleDiff(oldText, newText)}`);
      continue;
    }
    if (item.type === "content" && isRecord(item.content)) {
      const text = readString(item.content.text);
      if (text !== undefined) parts.push(text);
    }
  }
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function formatSimpleDiff(oldText: string, newText: string): string {
  if (oldText === "") return newText.split("\n").map((line) => `+ ${line}`).join("\n");
  return [
    ...oldText.split("\n").map((line) => `- ${line}`),
    ...newText.split("\n").map((line) => `+ ${line}`),
  ].join("\n");
}

function readQuestionPrompts(value: unknown): DesktopQuestionRequest["questions"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((question) => {
    const options = Array.isArray(question.options)
      ? question.options.filter(isRecord).map((option) => ({
        label: readString(option.label) ?? "",
        description: readString(option.description) ?? "",
      })).filter((option) => option.label.length > 0)
      : [];
    return {
      id: readString(question.id) ?? crypto.randomUUID(),
      header: readString(question.header) ?? "Question",
      question: readString(question.question) ?? "",
      multiSelect: question.multiSelect === true,
      allowCustomText: question.allowCustomText === true,
      options,
    };
  }).filter((question) => question.question.length > 0 && question.options.length > 0);
}

function readConfigOptions(value: unknown): DesktopConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((option) => ({
    id: option.id === "model" ? "model" : "mode",
    name: readString(option.name) ?? String(option.id ?? "Option"),
    currentValue: readString(option.currentValue) ?? "",
    options: Array.isArray(option.options)
      ? option.options.filter(isRecord).map((item) => ({
        value: readString(item.value) ?? "",
        name: readString(item.name) ?? "",
        ...(typeof item.description === "string" ? { description: item.description } : {}),
      })).filter((item) => item.value.length > 0)
      : [],
  }));
}

function readCurrentConfigValue(options: DesktopConfigOption[], id: "mode" | "model"): string | undefined {
  const option = options.find((item) => item.id === id);
  return option?.currentValue;
}

function readSessionMode(value: string | undefined): SessionMode | undefined {
  return value === "build" || value === "plan" ? value : undefined;
}

function readContentText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(readContentText).join("");
  }
  if (!isRecord(value)) return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  return "";
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
