/**
 * Runtime session adapter behind the ACP broker.
 */

import { isAbsolute, resolve } from "node:path";
import { runAgentLoop } from "../agent/run-agent-loop.ts";
import { runSubagentTask, type SubagentTaskRecord } from "../agent/subagent.ts";
import { OperationAbortedError } from "../errors/recode-error.ts";
import {
  createConversationRecord,
  listHistoryForWorkspace,
  loadConversation,
  loadHistoryIndex,
  resolveHistoryRoot,
  saveConversation,
  type SavedConversationRecord
} from "../history/recode-history.ts";
import { createLanguageModel } from "../models/create-model-client.ts";
import { buildSystemPrompt } from "../prompt/agents-md.ts";
import { PLAN_SYSTEM_PROMPT } from "../prompt/plan-system-prompt.ts";
import { DEFAULT_SYSTEM_PROMPT } from "../prompt/system-prompt.ts";
import {
  loadRuntimeConfig,
  selectRuntimeProviderModel,
  type RuntimeConfig
} from "../runtime/runtime-config.ts";
import { isRecord } from "../shared/is-record.ts";
import type { SessionEvent } from "../session/session-event.ts";
import { createTools } from "../tools/create-tools.ts";
import type {
  ApprovalMode,
  PermissionRule,
  QuestionToolDecision,
  QuestionToolRequest,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolExecutionContext
} from "../tools/tool.ts";
import { createPermissionRule } from "../tools/permission-rules.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import type { ConversationMessage, ToolCall, ToolResultMessage } from "../transcript/message.ts";
import { filterToolsForSessionMode, type SessionMode } from "../tui/session/session-mode.ts";
import { mapSessionEventToAcpNotifications, mapToolKind, reasoningToolCallId, todoMetadataToPlanEntries } from "./acp-event-mapper.ts";
import type {
  AcpContentBlock,
  AcpSessionConfigOption,
  AcpSessionNotification,
  AcpSessionUpdate
} from "./acp-types.ts";
import type { JsonRpcId, JsonRpcObject, JsonRpcRequest } from "./json-rpc.ts";

const SESSION_PAGE_SIZE = 50;
const MODE_CONFIG_ID = "mode";
const MODEL_CONFIG_ID = "model";

/** CLI overrides inherited by sessions created through the ACP broker. */
export interface AcpRuntimeOverrides {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly approvalMode?: ApprovalMode;
}

/** Outbound ACP transport hooks. */
export interface AcpSessionTransport {
  readonly sendSessionUpdate: (notification: AcpSessionNotification) => void;
  readonly requestClient: (request: JsonRpcRequest) => Promise<unknown>;
}

/** ACP session manager options. */
export interface AcpSessionManagerOptions {
  readonly overrides: AcpRuntimeOverrides;
  readonly transport: AcpSessionTransport;
}

interface ManagedAcpSession {
  sessionId: string;
  runtimeConfig: RuntimeConfig;
  mode: SessionMode;
  transcript: readonly ConversationMessage[];
  sessionEvents: readonly SessionEvent[];
  currentConversation: SavedConversationRecord;
  abortController?: AbortController;
  promptInProgress: boolean;
  subagentTasks: Map<string, SubagentTaskRecord>;
}

interface PermissionResponse {
  readonly outcome?: {
    readonly outcome?: unknown;
    readonly optionId?: unknown;
  };
}

/** Manages Recode runtimes for ACP sessions. */
export class AcpSessionManager {
  readonly #sessions = new Map<string, ManagedAcpSession>();
  readonly #overrides: AcpRuntimeOverrides;
  readonly #transport: AcpSessionTransport;

  constructor(options: AcpSessionManagerOptions) {
    this.#overrides = options.overrides;
    this.#transport = options.transport;
  }

  /** Create a new ACP session. */
  newSession(params: unknown): JsonRpcObject {
    const parsed = parseCwdParams(params);
    const runtimeConfig = applyRuntimeOverrides(loadRuntimeConfig(parsed.cwd), this.#overrides);
    const sessionId = crypto.randomUUID();
    const currentConversation = createConversationRecord(runtimeConfig, [], "build", { id: sessionId });
    const session: ManagedAcpSession = {
      sessionId,
      runtimeConfig,
      mode: "build",
      transcript: [],
      sessionEvents: [],
      currentConversation,
      promptInProgress: false,
      subagentTasks: new Map()
    };
    this.#sessions.set(sessionId, session);
    return this.#sessionSetupResponse(session);
  }

  /** Load and replay a saved session. */
  loadSession(params: unknown): JsonRpcObject {
    const parsed = parseSessionCwdParams(params);
    const runtimeConfig = applyRuntimeOverrides(loadRuntimeConfig(parsed.cwd), this.#overrides);
    const historyRoot = resolveHistoryRoot(runtimeConfig.configPath);
    const conversation = loadConversation(historyRoot, parsed.sessionId);
    if (conversation === undefined) {
      throw new Error(`ACP session not found: ${parsed.sessionId}`);
    }

    const restoredRuntime = restoreConversationRuntime(runtimeConfig, conversation);
    const session = this.#upsertLoadedSession(conversation, restoredRuntime);
    this.#replayTranscript(session);
    return this.#sessionSetupResponse(session);
  }

  /** Resume a saved session without replaying history. */
  resumeSession(params: unknown): JsonRpcObject {
    const parsed = parseSessionCwdParams(params);
    const existing = this.#sessions.get(parsed.sessionId);
    if (existing !== undefined) {
      return this.#sessionSetupResponse(existing);
    }

    const runtimeConfig = applyRuntimeOverrides(loadRuntimeConfig(parsed.cwd), this.#overrides);
    const historyRoot = resolveHistoryRoot(runtimeConfig.configPath);
    const conversation = loadConversation(historyRoot, parsed.sessionId);
    if (conversation === undefined) {
      throw new Error(`ACP session not found: ${parsed.sessionId}`);
    }

    return this.#sessionSetupResponse(this.#upsertLoadedSession(conversation, restoreConversationRuntime(runtimeConfig, conversation)));
  }

  /** List persisted Recode sessions. */
  listSessions(params: unknown): JsonRpcObject {
    const cursor = readOptionalString(params, "cursor");
    const cwd = readOptionalString(params, "cwd");
    if (cwd !== undefined && !isAbsolute(cwd)) {
      throw new Error(`ACP cwd must be absolute: ${cwd}`);
    }

    const runtimeConfig = applyRuntimeOverrides(loadRuntimeConfig(cwd ?? process.cwd()), this.#overrides);
    const historyRoot = resolveHistoryRoot(runtimeConfig.configPath);
    const index = loadHistoryIndex(historyRoot);
    const conversations = cwd === undefined
      ? index.conversations
      : listHistoryForWorkspace(index, cwd);
    const offset = parseCursor(cursor);
    const page = conversations.slice(offset, offset + SESSION_PAGE_SIZE);
    const nextOffset = offset + page.length;

    return {
      sessions: page.map((conversation) => ({
        sessionId: conversation.id,
        cwd: conversation.workspaceRoot,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        _meta: {
          preview: conversation.preview,
          model: conversation.model,
          providerId: conversation.providerId,
          messageCount: conversation.messageCount,
          mode: conversation.mode
        }
      })),
      ...(nextOffset < conversations.length ? { nextCursor: String(nextOffset) } : {})
    };
  }

  /** Accept one ACP prompt and run it asynchronously. */
  prompt(params: unknown): JsonRpcObject {
    const parsed = parsePromptParams(params);
    const session = this.#getSession(parsed.sessionId);
    if (session.promptInProgress) {
      throw new Error(`ACP prompt already in progress for session: ${session.sessionId}`);
    }

    session.promptInProgress = true;
    const abortController = new AbortController();
    session.abortController = abortController;
    const messageId = crypto.randomUUID();
    this.#transport.sendSessionUpdate({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "user_message",
        messageId,
        content: parsed.prompt
      }
    });
    this.#transport.sendSessionUpdate({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "state_change",
        state: "running"
      }
    });

    void this.#runPromptTurn(session, parsed.prompt, abortController);
    return { messageId };
  }

  async #runPromptTurn(
    session: ManagedAcpSession,
    prompt: readonly AcpContentBlock[],
    abortController: AbortController
  ): Promise<void> {
    const nextEvents: SessionEvent[] = [...session.sessionEvents];
    const initialUserPrompt = promptBlocksToText(prompt);
    const acpReasoningContent = new Map<string, string>();

    try {
      const result = await runAgentLoop({
        systemPrompt: buildSystemPrompt(session.mode === "plan" ? PLAN_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT, session.runtimeConfig.workspaceRoot),
        initialUserPrompt,
        previousMessages: session.transcript,
        languageModel: createLanguageModel(session.runtimeConfig),
        toolRegistry: new ToolRegistry(filterToolsForSessionMode(createTools(), session.mode)),
        toolContext: this.#createToolContext(session, abortController.signal),
        abortSignal: abortController.signal,
        requestAffinityKey: session.sessionId,
        onSessionEvent: (event) => {
          nextEvents.push(event);
          if (event.type === "assistant.reasoning.delta") {
            const toolCallId = reasoningToolCallId(event.stepId);
            const previous = acpReasoningContent.get(event.stepId);
            const content = `${previous ?? ""}${event.delta}`;
            acpReasoningContent.set(event.stepId, content);
            if (previous === undefined) {
              this.#transport.sendSessionUpdate({
                sessionId: session.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId,
                  title: "Thinking",
                  kind: "think",
                  status: "in_progress"
                }
              });
            }
            this.#transport.sendSessionUpdate({
              sessionId: session.sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: "in_progress",
                content: [{ type: "content", content: { type: "text", text: content } }]
              }
            });
            return;
          }
          if (event.type === "assistant.step.finished") {
            const content = acpReasoningContent.get(event.stepId);
            if (content !== undefined) {
              this.#transport.sendSessionUpdate({
                sessionId: session.sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: reasoningToolCallId(event.stepId),
                  status: "completed",
                  content: [{ type: "content", content: { type: "text", text: content } }]
                }
              });
            }
          }
          for (const notification of mapSessionEventToAcpNotifications(event, session.sessionId)) {
            this.#transport.sendSessionUpdate(notification);
          }
        },
        onToolResult: (toolResult) => {
          const planEntries = todoMetadataToPlanEntries(toolResult.metadata);
          if (planEntries !== undefined) {
            this.#transport.sendSessionUpdate({
              sessionId: session.sessionId,
              update: { sessionUpdate: "plan", entries: planEntries }
            });
          }
        }
      });

      session.transcript = result.transcript;
      session.sessionEvents = nextEvents;
      this.#persistSession(session);
      this.#emitSessionInfo(session);
      this.#emitStateChange(session.sessionId, "idle", "end_turn");
    } catch (error) {
      if (error instanceof OperationAbortedError || abortController.signal.aborted) {
        session.transcript = appendUserPromptIfMissing(session.transcript, initialUserPrompt);
        session.sessionEvents = nextEvents;
        this.#persistSession(session);
        this.#emitStateChange(session.sessionId, "idle", "cancelled");
        return;
      }

      this.#transport.sendSessionUpdate({
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "state_change",
          state: "idle",
          stopReason: "refusal",
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    } finally {
      session.promptInProgress = false;
      delete session.abortController;
    }
  }

  /** Cancel one active prompt turn. */
  cancel(params: unknown): void {
    const sessionId = readRequiredString(params, "sessionId");
    const session = this.#sessions.get(sessionId);
    session?.abortController?.abort();
  }

  /** Close one active ACP session. */
  closeSession(params: unknown): JsonRpcObject {
    const sessionId = readRequiredString(params, "sessionId");
    const session = this.#sessions.get(sessionId);
    session?.abortController?.abort();
    this.#sessions.delete(sessionId);
    return {};
  }

  /** Set the current build/plan mode. */
  setMode(params: unknown): JsonRpcObject {
    const sessionId = readRequiredString(params, "sessionId");
    const modeId = readRequiredString(params, "modeId");
    const session = this.#getSession(sessionId);
    if (!isSessionMode(modeId)) {
      throw new Error(`Unsupported ACP session mode: ${modeId}`);
    }

    session.mode = modeId;
    this.#emitConfigOptions(session);
    this.#transport.sendSessionUpdate({
      sessionId,
      update: { sessionUpdate: "current_mode_update", currentModeId: modeId }
    });
    return {};
  }

  /** Set a session config option. */
  setConfigOption(params: unknown): JsonRpcObject {
    const sessionId = readRequiredString(params, "sessionId");
    const configId = readRequiredString(params, "configId");
    const value = readRequiredString(params, "value");
    const session = this.#getSession(sessionId);

    if (configId === MODE_CONFIG_ID) {
      if (!isSessionMode(value)) {
        throw new Error(`Unsupported ACP mode config value: ${value}`);
      }
      session.mode = value;
    } else if (configId === MODEL_CONFIG_ID) {
      session.runtimeConfig = this.#selectModel(session.runtimeConfig, value);
    } else {
      throw new Error(`Unknown ACP config option: ${configId}`);
    }

    const configOptions = this.#buildConfigOptions(session);
    this.#transport.sendSessionUpdate({
      sessionId,
      update: { sessionUpdate: "config_option_update", configOptions }
    });
    return { configOptions };
  }

  /** Set the current model directly. */
  setModel(params: unknown): JsonRpcObject {
    const sessionId = readRequiredString(params, "sessionId");
    const modelId = readRequiredString(params, "modelId");
    const session = this.#getSession(sessionId);
    session.runtimeConfig = this.#selectModel(session.runtimeConfig, modelId);
    this.#emitConfigOptions(session);
    return {};
  }

  #upsertLoadedSession(conversation: SavedConversationRecord, runtimeConfig: RuntimeConfig): ManagedAcpSession {
    const existing = this.#sessions.get(conversation.id);
    if (existing !== undefined) {
      return existing;
    }

    const session: ManagedAcpSession = {
      sessionId: conversation.id,
      runtimeConfig,
      mode: conversation.mode,
      transcript: conversation.transcript,
      sessionEvents: conversation.sessionEvents ?? [],
      currentConversation: conversation,
      promptInProgress: false,
      subagentTasks: new Map((conversation.subagentTasks ?? []).map((task) => [task.id, task]))
    };
    this.#sessions.set(session.sessionId, session);
    return session;
  }

  #sessionSetupResponse(session: ManagedAcpSession): JsonRpcObject {
    return {
      sessionId: session.sessionId,
      configOptions: this.#buildConfigOptions(session),
      modes: {
        availableModes: [
          { id: "build", name: "Build", description: "Full coding mode with all configured Recode tools." },
          { id: "plan", name: "Plan", description: "Planning mode with read-only tools." }
        ],
        currentModeId: session.mode
      },
      models: {
        currentModelId: toModelValue(session.runtimeConfig.providerId, session.runtimeConfig.model),
        availableModels: this.#availableModelValues(session.runtimeConfig)
      }
    };
  }

  #buildConfigOptions(session: ManagedAcpSession): readonly AcpSessionConfigOption[] {
    return [
      {
        id: MODE_CONFIG_ID,
        name: "Mode",
        description: "Controls whether Recode can implement changes or only plan.",
        category: "mode",
        type: "select",
        currentValue: session.mode,
        options: [
          { value: "build", name: "Build", description: "Use all configured tools." },
          { value: "plan", name: "Plan", description: "Plan with read-only tools." }
        ]
      },
      {
        id: MODEL_CONFIG_ID,
        name: "Model",
        description: "Provider/model used for this session.",
        category: "model",
        type: "select",
        currentValue: toModelValue(session.runtimeConfig.providerId, session.runtimeConfig.model),
        options: this.#availableModelValues(session.runtimeConfig)
      }
    ];
  }

  #availableModelValues(runtimeConfig: RuntimeConfig): readonly { readonly value: string; readonly name: string; readonly description?: string }[] {
    return runtimeConfig.providers
      .filter((provider) => provider.disabled !== true)
      .flatMap((provider) => provider.models.map((model) => ({
        value: toModelValue(provider.id, model.id),
        name: `${provider.name}: ${model.id}`,
        description: provider.id
      })));
  }

  #selectModel(runtimeConfig: RuntimeConfig, modelValue: string): RuntimeConfig {
    const parsed = parseModelValue(runtimeConfig, modelValue);
    return selectRuntimeProviderModel(runtimeConfig, parsed.providerId, parsed.modelId);
  }

  #createToolContext(session: ManagedAcpSession, abortSignal: AbortSignal): ToolExecutionContext {
    return {
      workspaceRoot: session.runtimeConfig.workspaceRoot,
      approvalMode: session.runtimeConfig.approvalMode,
      approvalAllowlist: session.runtimeConfig.approvalAllowlist,
      permissionRules: session.runtimeConfig.permissionRules,
      abortSignal,
      requestToolApproval: async (request) => await this.#requestToolApproval(session, request),
      requestQuestionAnswers: async (request) => await this.#requestQuestionAnswers(session, request),
      runSubagentTask: async (request) => await runSubagentTask({
        request,
        parentRuntimeConfig: session.runtimeConfig,
        parentSystemPrompt: buildSystemPrompt(session.mode === "plan" ? PLAN_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT, session.runtimeConfig.workspaceRoot),
        parentToolRegistry: new ToolRegistry(filterToolsForSessionMode(createTools(), session.mode)),
        parentToolContext: this.#createToolContext(session, request.abortSignal ?? abortSignal),
        requestAffinityKey: session.sessionId,
        findTask(taskId) {
          return session.subagentTasks.get(taskId);
        },
        saveTask(record) {
          session.subagentTasks.set(record.id, record);
        }
      })
    };
  }

  async #requestToolApproval(session: ManagedAcpSession, request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    this.#emitStateChange(session.sessionId, "requires_action");
    const response = await this.#transport.requestClient({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "session/request_permission",
      params: {
        sessionId: session.sessionId,
        toolCall: {
          toolCallId: crypto.randomUUID(),
          title: `${request.toolName}: ${request.pattern}`,
          kind: mapToolKind(request.toolName),
          status: "pending",
          rawInput: request.arguments
        },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" }
        ]
      }
    }).finally(() => {
      this.#emitStateChange(session.sessionId, "running");
    });
    const decision = parsePermissionResponse(response);
    if (decision === "allow-always") {
      session.runtimeConfig = {
        ...session.runtimeConfig,
        permissionRules: [
          ...session.runtimeConfig.permissionRules,
          createPermissionRule(request.permission, request.pattern, "allow")
        ]
      };
    }

    return decision;
  }

  async #requestQuestionAnswers(session: ManagedAcpSession, request: QuestionToolRequest): Promise<QuestionToolDecision> {
    this.#emitStateChange(session.sessionId, "requires_action");
    const response = await this.#transport.requestClient({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "_recode/question",
      params: {
        sessionId: session.sessionId,
        questions: request.questions
      }
    }).finally(() => {
      this.#emitStateChange(session.sessionId, "running");
    });

    if (!isRecord(response) || response["dismissed"] === true) {
      return { dismissed: true };
    }

    return Array.isArray(response["answers"])
      ? { dismissed: false, answers: response["answers"].filter(isQuestionAnswer) }
      : { dismissed: true };
  }

  #persistSession(session: ManagedAcpSession): void {
    const historyRoot = resolveHistoryRoot(session.runtimeConfig.configPath);
    const conversation = createConversationRecord(
      session.runtimeConfig,
      session.transcript,
      session.mode,
      {
        id: session.currentConversation.id,
        createdAt: session.currentConversation.createdAt
      },
      Array.from(session.subagentTasks.values()),
      session.currentConversation.sessionSnapshots,
      session.sessionEvents
    );
    session.currentConversation = conversation;
    if (conversation.transcript.length > 0) {
      saveConversation(historyRoot, conversation, true);
    }
  }

  #replayTranscript(session: ManagedAcpSession): void {
    for (const notification of transcriptToReplayNotifications(session.sessionId, session.transcript)) {
      this.#transport.sendSessionUpdate(notification);
    }
  }

  #emitConfigOptions(session: ManagedAcpSession): void {
    this.#transport.sendSessionUpdate({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.#buildConfigOptions(session)
      }
    });
  }

  #emitSessionInfo(session: ManagedAcpSession): void {
    this.#transport.sendSessionUpdate({
      sessionId: session.sessionId,
      update: {
        sessionUpdate: "session_info_update",
        title: session.currentConversation.title,
        updatedAt: session.currentConversation.updatedAt
      }
    });
  }

  #emitStateChange(
    sessionId: string,
    state: "running" | "idle" | "requires_action",
    stopReason?: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"
  ): void {
    this.#transport.sendSessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "state_change",
        state,
        ...(stopReason === undefined ? {} : { stopReason })
      }
    });
  }

  #getSession(sessionId: string): ManagedAcpSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`Unsupported ACP session: ${sessionId}`);
    }

    return session;
  }
}

function applyRuntimeOverrides(runtimeConfig: RuntimeConfig, overrides: AcpRuntimeOverrides): RuntimeConfig {
  let nextConfig = runtimeConfig;
  if (overrides.providerId !== undefined || overrides.modelId !== undefined) {
    const providerId = overrides.providerId ?? nextConfig.providerId;
    const provider = nextConfig.providers.find((item) => item.id === providerId);
    if (provider === undefined) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const modelId = overrides.modelId ?? provider.defaultModelId ?? provider.models[0]?.id;
    if (modelId === undefined || modelId.trim() === "") {
      throw new Error(`Provider '${providerId}' has no model.`);
    }
    nextConfig = selectRuntimeProviderModel(nextConfig, providerId, modelId);
  }

  return overrides.approvalMode === undefined
    ? nextConfig
    : { ...nextConfig, approvalMode: overrides.approvalMode };
}

function restoreConversationRuntime(runtimeConfig: RuntimeConfig, conversation: SavedConversationRecord): RuntimeConfig {
  const provider = runtimeConfig.providers.find((item) => item.id === conversation.providerId);
  return provider === undefined
    ? runtimeConfig
    : selectRuntimeProviderModel(runtimeConfig, conversation.providerId, conversation.model);
}

function transcriptToReplayNotifications(
  sessionId: string,
  transcript: readonly ConversationMessage[]
): readonly AcpSessionNotification[] {
  const notifications: AcpSessionNotification[] = [];
  for (const message of transcript) {
    switch (message.role) {
      case "user":
        notifications.push({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: message.content },
            messageId: crypto.randomUUID()
          }
        });
        break;
      case "assistant":
        if (message.providerMetadata?.reasoningContent !== undefined) {
          const toolCallId = reasoningToolCallId(crypto.randomUUID());
          notifications.push({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId,
              title: "Thinking",
              kind: "think",
              status: "completed"
            }
          });
          notifications.push({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "completed",
              content: [{ type: "content", content: { type: "text", text: message.providerMetadata.reasoningContent } }]
            }
          });
        }
        if (message.content.length > 0) {
          notifications.push({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: message.content },
              messageId: crypto.randomUUID()
            }
          });
        }
        for (const toolCall of message.toolCalls) {
          notifications.push(replayToolCall(sessionId, toolCall));
        }
        break;
      case "tool":
        notifications.push(replayToolResult(sessionId, message));
        break;
      case "summary":
        notifications.push({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: message.content },
            messageId: crypto.randomUUID()
          }
        });
        break;
    }
  }

  return notifications;
}

function replayToolCall(sessionId: string, toolCall: ToolCall): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: toolCall.id,
      title: toolCall.name,
      kind: mapToolKind(toolCall.name),
      status: "completed"
    }
  };
}

function replayToolResult(sessionId: string, message: ToolResultMessage): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: message.toolCallId,
      status: message.isError ? "failed" : "completed",
      rawOutput: {
        content: message.content,
        isError: message.isError
      },
      content: [{ type: "content", content: { type: "text", text: message.content } }]
    }
  };
}

function promptBlocksToText(blocks: readonly AcpContentBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return block.text;
      case "resource":
        return "text" in block.resource
          ? [`Resource: ${block.resource.uri}`, block.resource.text].join("\n")
          : `Resource: ${block.resource.uri}`;
      case "resource_link":
        return `Resource link: ${block.uri}`;
    }
  }).join("\n\n").trim();
}

function appendUserPromptIfMissing(
  transcript: readonly ConversationMessage[],
  prompt: string
): readonly ConversationMessage[] {
  if (prompt.trim() === "") return transcript;
  const lastMessage = transcript[transcript.length - 1];
  if (lastMessage?.role === "user" && lastMessage.content === prompt) {
    return transcript;
  }
  return [...transcript, { role: "user", content: prompt }];
}

function parseCwdParams(params: unknown): { readonly cwd: string } {
  const cwd = readRequiredString(params, "cwd");
  if (!isAbsolute(cwd)) {
    throw new Error(`ACP cwd must be absolute: ${cwd}`);
  }

  return { cwd: resolve(cwd) };
}

function parseSessionCwdParams(params: unknown): { readonly sessionId: string; readonly cwd: string } {
  const cwdParams = parseCwdParams(params);
  return {
    ...cwdParams,
    sessionId: readRequiredString(params, "sessionId")
  };
}

function parsePromptParams(params: unknown): { readonly sessionId: string; readonly prompt: readonly AcpContentBlock[] } {
  const sessionId = readRequiredString(params, "sessionId");
  if (!isRecord(params) || !Array.isArray(params["prompt"])) {
    throw new Error("ACP prompt must be an array.");
  }

  return {
    sessionId,
    prompt: params["prompt"].map(parseContentBlock)
  };
}

function parseContentBlock(value: unknown): AcpContentBlock {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    throw new Error("Invalid ACP content block.");
  }

  if (value["type"] === "text" && typeof value["text"] === "string") {
    return { type: "text", text: value["text"] };
  }

  if (value["type"] === "resource" && isRecord(value["resource"])) {
    const resource = value["resource"];
    const uri = typeof resource["uri"] === "string" ? resource["uri"] : undefined;
    if (uri !== undefined && typeof resource["text"] === "string") {
      const mimeType = typeof resource["mimeType"] === "string" ? resource["mimeType"] : undefined;
      return { type: "resource", resource: { uri, text: resource["text"], ...(mimeType === undefined ? {} : { mimeType }) } };
    }
    if (uri !== undefined && typeof resource["blob"] === "string") {
      const mimeType = typeof resource["mimeType"] === "string" ? resource["mimeType"] : undefined;
      return { type: "resource", resource: { uri, blob: resource["blob"], ...(mimeType === undefined ? {} : { mimeType }) } };
    }
  }

  if (value["type"] === "resource_link" && typeof value["uri"] === "string" && typeof value["name"] === "string") {
    const title = typeof value["title"] === "string" ? value["title"] : undefined;
    return { type: "resource_link", uri: value["uri"], name: value["name"], ...(title === undefined ? {} : { title }) };
  }

  throw new Error(`Unsupported ACP content block type: ${value["type"]}`);
}

function parsePermissionResponse(response: unknown): ToolApprovalDecision {
  if (!isRecord(response) || !isRecord((response as PermissionResponse).outcome)) {
    return "deny";
  }

  const outcome = (response as PermissionResponse).outcome;
  if (outcome?.outcome !== "selected") {
    return "deny";
  }

  return outcome.optionId === "allow-once" || outcome.optionId === "allow-always"
    ? outcome.optionId
    : "deny";
}

function isQuestionAnswer(value: unknown): value is QuestionToolDecision extends { readonly answers: readonly (infer T)[] } ? T : never {
  return isRecord(value)
    && typeof value["questionId"] === "string"
    && Array.isArray(value["selectedOptionLabels"])
    && value["selectedOptionLabels"].every((item) => typeof item === "string")
    && typeof value["customText"] === "string";
}

function parseModelValue(runtimeConfig: RuntimeConfig, value: string): { readonly providerId: string; readonly modelId: string } {
  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    return {
      providerId: value.slice(0, slashIndex),
      modelId: value.slice(slashIndex + 1)
    };
  }

  const matchingProviders = runtimeConfig.providers.filter((provider) => provider.models.some((model) => model.id === value));
  if (matchingProviders.length === 1) {
    return { providerId: matchingProviders[0]!.id, modelId: value };
  }

  return { providerId: runtimeConfig.providerId, modelId: value };
}

function toModelValue(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

function isSessionMode(value: string): value is SessionMode {
  return value === "build" || value === "plan";
}

function readRequiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string" || value[key].trim() === "") {
    throw new Error(`Missing ACP string parameter: ${key}`);
  }

  return value[key].trim();
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field.trim() : undefined;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ACP session cursor: ${cursor}`);
  }

  return parsed;
}
