/**
 * Streaming adapter for OpenAI Chat Completions.
 */

import type OpenAI from "openai";
import { formatContinuationSummaryForModel, type ConversationMessage } from "../../transcript/message.ts";
import type { ToolDefinition } from "../../tools/tool.ts";
import { parseProviderToolArguments } from "../json.ts";
import {
  buildProviderBodyOptions,
  mergeRequestBodyOptions
} from "../provider-request-options.ts";
import { formatProviderError } from "../provider-error.ts";
import { createProviderTimingSpan } from "../provider-timing.ts";
import { buildSdkRequestOptions, createOpenAiSdkClient } from "../sdk-request.ts";
import type { AiModel, AiStreamPart, ProviderStatusEvent } from "../types.ts";
import { createEmptyStepTokenUsage, type StepTokenUsage } from "../../agent/step-stats.ts";
import { isJsonObject, type JsonObject } from "../../shared/json-value.ts";
import { getOpenAiChatCompat, type OpenAiChatCompat } from "../provider-compat.ts";
import {
  readOptionalNumber,
  readOptionalRecord,
  readOptionalString,
  splitToolCallId
} from "./provider-json.ts";

interface PendingChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  index: number;
  extraContent?: JsonObject;
}

/**
 * Stream a response from the OpenAI Chat Completions API.
 */
export async function* streamOpenAiChat(
  model: AiModel,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  tools: readonly ToolDefinition[],
  abortSignal?: AbortSignal,
  requestAffinityKey?: string,
  onProviderStatus?: (event: ProviderStatusEvent) => void
): AsyncGenerator<AiStreamPart> {
  try {
    const timing = createProviderTimingSpan({
      model,
      operation: "openai-chat-completions",
      ...(requestAffinityKey === undefined ? {} : { requestAffinityKey })
    });
    timing.mark("request-start", { attempt: 1 });
    const client = createOpenAiSdkClient(
      model,
      requestAffinityKey,
      "openai-chat-completions",
      onProviderStatus
    );
    const requestBody = buildChatCompletionsRequestBody(model, systemPrompt, messages, tools, requestAffinityKey);
    const { data: responseStream, response } = await client.chat.completions
      .create(requestBody as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming, buildSdkRequestOptions(model, abortSignal))
      .withResponse();
    timing.mark("response-headers", { attempt: 1, status: response.status });

    const pendingToolCalls = new Map<number, PendingChatToolCall>();
    let finishReason: string | undefined;
    let tokenUsage: StepTokenUsage | undefined;

    for await (const streamChunk of responseStream) {
      timing.markOnce("first-sse-chunk");
      const chunk = streamChunk as unknown as Record<string, unknown>;
      const errorRecord = readOptionalRecord(chunk, "error");
      if (errorRecord !== undefined) {
        throw new Error(readOptionalString(errorRecord, "message") ?? "OpenAI-compatible API reported an error.");
      }

      const choices = chunk["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }

      const choice = choices[0];
      if (choice === null || typeof choice !== "object" || Array.isArray(choice)) {
        continue;
      }

      const choiceRecord = choice as Record<string, unknown>;
      const nextFinishReason = readOptionalString(choiceRecord, "finish_reason");
      if (nextFinishReason !== undefined && nextFinishReason !== "") {
        finishReason = nextFinishReason;
      }

      const usageRecord = readOptionalRecord(chunk, "usage");
      if (usageRecord !== undefined) {
        tokenUsage = {
          ...createEmptyStepTokenUsage(),
          input: readOptionalNumber(usageRecord, "prompt_tokens") ?? 0,
          output: readOptionalNumber(usageRecord, "completion_tokens") ?? 0,
          reasoning: readOptionalNumber(usageRecord, "completion_tokens_details.reasoning_tokens") ?? 0,
          cacheRead: readOptionalNumber(usageRecord, "prompt_tokens_details.cached_tokens") ?? 0,
          cacheWrite: 0
        };
      }

      const delta = readOptionalRecord(choiceRecord, "delta");
      if (delta !== undefined) {
        const reasoningContent = readFirstOptionalString(delta, ["reasoning_content", "reasoning", "reasoning_text"]);
        if (reasoningContent !== undefined && reasoningContent !== "") {
          yield { type: "reasoning-delta", text: reasoningContent };
        }

        const content = readOptionalString(delta, "content");
        if (content !== undefined && content !== "") {
          timing.markOnce("first-text-delta");
          yield { type: "text-delta", text: content };
        }

        const rawToolCalls = delta["tool_calls"];
        if (Array.isArray(rawToolCalls)) {
          for (const [arrayIndex, rawToolCall] of rawToolCalls.entries()) {
            if (rawToolCall === null || typeof rawToolCall !== "object" || Array.isArray(rawToolCall)) {
              continue;
            }

            const toolCall = rawToolCall as Record<string, unknown>;
            const id = readOptionalString(toolCall, "id");
            const index = resolveChatToolCallIndex(toolCall, arrayIndex, id, pendingToolCalls);
            const current = pendingToolCalls.get(index) ?? {
              id: `call_${index}`,
              name: "",
              argumentsJson: "",
              index
            };
            if (id !== undefined && id !== "") {
              current.id = id;
            }

            const extraContent = toolCall["extra_content"];
            if (isJsonObject(extraContent)) {
              current.extraContent = extraContent;
            }

            const functionRecord = readOptionalRecord(toolCall, "function");
            if (functionRecord !== undefined) {
              const name = readOptionalString(functionRecord, "name");
              if (name !== undefined && name !== "") {
                current.name = name;
              }

              const argumentsChunk = readOptionalString(functionRecord, "arguments");
              if (argumentsChunk !== undefined && argumentsChunk !== "") {
                current.argumentsJson += argumentsChunk;
              }
            }

            pendingToolCalls.set(index, current);
          }
        }
      }
    }

    const orderedToolCalls = [...pendingToolCalls.values()].sort((left, right) => left.index - right.index);
    for (const toolCall of orderedToolCalls) {
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: parseProviderToolArguments(toolCall.argumentsJson, "openai-chat-completions", toolCall.name),
        ...(toolCall.extraContent === undefined ? {} : { extraContent: toolCall.extraContent })
      };
    }

    if (abortSignal?.aborted ?? false) {
      timing.mark("request-abort");
      yield { type: "abort" };
      return;
    }

    yield {
      type: "finish-step",
      info: {
        ...(finishReason === undefined ? {} : { finishReason }),
        ...(tokenUsage === undefined ? {} : { tokenUsage })
      }
    };
    timing.mark("request-finish", {
      ...(finishReason === undefined ? {} : { finishReason })
    });
    yield { type: "finish" };
  } catch (error) {
    if (abortSignal?.aborted ?? false) {
      yield { type: "abort" };
      return;
    }

    yield { type: "error", error: formatProviderError(error, model) };
  }
}

function buildChatCompletionsRequestBody(
  model: AiModel,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  tools: readonly ToolDefinition[],
  requestAffinityKey: string | undefined
): Record<string, unknown> {
  const compat = getOpenAiChatCompat(model);
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: messagesToChatMessages(systemPrompt, messages, compat),
    ...(tools.length === 0 ? {} : { tools: toolsToChatTools(tools) }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.toolChoice === undefined ? {} : { tool_choice: model.toolChoice }),
    ...(compat.supportsUsageInStreaming ? { stream_options: { include_usage: true } } : {}),
    ...(compat.supportsStore ? { store: false } : {}),
    stream: true
  };

  if (model.maxOutputTokens !== undefined) {
    body[compat.maxTokensField] = model.maxOutputTokens;
  }

  Object.assign(body, buildChatReasoningOptions(model, compat));

  return mergeRequestBodyOptions({
    ...body
  }, buildProviderBodyOptions(model, requestAffinityKey));
}

function buildChatReasoningOptions(
  model: AiModel,
  compat: OpenAiChatCompat
): Record<string, unknown> {
  const configuredOptions = model.providerOptions ?? {};
  const reasoningEffort = readReasoningEffort(configuredOptions["reasoningEffort"]);

  switch (compat.thinkingFormat) {
    case "deepseek":
      return {
        ...(configuredOptions["thinking"] === undefined
          ? { thinking: { type: reasoningEffort === "none" ? "disabled" : "enabled" } }
          : {}),
        ...(reasoningEffort !== undefined
          && reasoningEffort !== "none"
          && compat.supportsReasoningEffort
          && configuredOptions["reasoning_effort"] === undefined
          ? { reasoning_effort: reasoningEffort }
          : {})
      };
    case "openrouter":
      return reasoningEffort !== undefined && configuredOptions["reasoning"] === undefined
        ? { reasoning: { effort: reasoningEffort } }
        : {};
    case "zai":
    case "qwen":
      return reasoningEffort !== undefined && configuredOptions["enable_thinking"] === undefined
        ? { enable_thinking: reasoningEffort !== "none" }
        : {};
    case "openai":
      return reasoningEffort !== undefined
        && reasoningEffort !== "none"
        && compat.supportsReasoningEffort
        && configuredOptions["reasoning_effort"] === undefined
        ? { reasoning_effort: reasoningEffort }
        : {};
    case "none":
      return {};
  }
}

function resolveChatToolCallIndex(
  toolCall: Record<string, unknown>,
  arrayIndex: number,
  id: string | undefined,
  pendingToolCalls: ReadonlyMap<number, PendingChatToolCall>
): number {
  const explicitIndex = readOptionalNumber(toolCall, "index");
  if (explicitIndex !== undefined) {
    return Math.max(0, Math.trunc(explicitIndex));
  }

  if (id !== undefined && id !== "") {
    const existingCall = [...pendingToolCalls.values()].find((item) => item.id === id);
    if (existingCall !== undefined) {
      return existingCall.index;
    }
  }

  return arrayIndex;
}

function readReasoningEffort(
  value: unknown
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  return value === "none"
    || value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    ? value
    : undefined;
}

function readFirstOptionalString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(record, key);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function messagesToChatMessages(
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  compat: OpenAiChatCompat
): readonly Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  if (systemPrompt.trim() !== "") {
    result.push({
      role: "system",
      content: systemPrompt
    });
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message === undefined) {
      continue;
    }

    switch (message.role) {
      case "user":
        result.push({
          role: "user",
          content: message.content
        });
        break;
      case "assistant": {
        const toolCalls = message.toolCalls.map((toolCall) => {
          const extraContent = toolCall.extraContent;
          return {
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.argumentsJson
            },
            ...(extraContent === undefined ? {} : { extra_content: extraContent })
          };
        });

        result.push({
          role: "assistant",
          content: message.content === "" && toolCalls.length > 0 ? "" : message.content,
          ...(compat.replaysAssistantReasoningContent && message.providerMetadata?.reasoningContent !== undefined
            ? { reasoning_content: message.providerMetadata.reasoningContent }
            : {}),
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls })
        });
        break;
      }
      case "summary":
        result.push({
          role: "user",
          content: formatContinuationSummaryForModel(message.content)
        });
        break;
      case "tool":
        result.push({
          role: "tool",
          tool_call_id: splitToolCallId(message.toolCallId),
          content: message.content,
          ...(compat.requiresToolResultName ? { name: message.toolName } : {})
        });
        if (compat.requiresAssistantAfterToolResult && messages[messageIndex + 1]?.role === "user") {
          result.push({
            role: "assistant",
            content: "I have processed the tool results."
          });
        }
        break;
    }
  }

  return result;
}

function toolsToChatTools(tools: readonly ToolDefinition[]): readonly Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}
