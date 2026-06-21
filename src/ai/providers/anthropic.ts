/**
 * Streaming adapter for Anthropic Messages.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { formatContinuationSummaryForModel, type ConversationMessage } from "../../transcript/message.ts";
import type { ToolDefinition } from "../../tools/tool.ts";
import { parseProviderToolArguments, parseStreamingJsonObject } from "../json.ts";
import {
  buildProviderBodyOptions,
  mergeRequestBodyOptions
} from "../provider-request-options.ts";
import { formatProviderError } from "../provider-error.ts";
import { createProviderTimingSpan } from "../provider-timing.ts";
import { getAnthropicCompat } from "../provider-compat.ts";
import { buildSdkRequestOptions, createAnthropicSdkClient } from "../sdk-request.ts";
import { iterateSseMessages } from "../sse.ts";
import type { AiModel, AiStreamPart, ProviderStatusEvent } from "../types.ts";
import { createEmptyStepTokenUsage, type StepTokenUsage } from "../../agent/step-stats.ts";
import {
  readNumber,
  readOptionalNumber,
  readOptionalRecord,
  readOptionalString,
  readRecord,
  readString
} from "./provider-json.ts";

interface PendingAnthropicToolUse {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly inputFromStart: Record<string, unknown>;
  argumentsJson: string;
  sawArgumentDelta: boolean;
}

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

/**
 * Stream a response from the Anthropic Messages API.
 */
export async function* streamAnthropicMessages(
  model: AiModel,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  tools: readonly ToolDefinition[],
  abortSignal?: AbortSignal,
  requestAffinityKey?: string,
  onProviderStatus?: (event: ProviderStatusEvent) => void
): AsyncGenerator<AiStreamPart> {
  try {
    const compat = getAnthropicCompat(model);
    const betaFeatures = tools.length > 0 && !compat.supportsEagerToolInputStreaming
      ? [FINE_GRAINED_TOOL_STREAMING_BETA]
      : [];
    const timing = createProviderTimingSpan({
      model,
      operation: "anthropic-messages",
      ...(requestAffinityKey === undefined ? {} : { requestAffinityKey })
    });
    timing.mark("request-start", { attempt: 1 });
    const client = createAnthropicSdkClient(
      model,
      requestAffinityKey,
      "anthropic-messages",
      onProviderStatus,
      betaFeatures
    );
    const requestBody = buildAnthropicRequestBody(model, systemPrompt, messages, tools, requestAffinityKey);
    const response = await client.messages
      .create(requestBody as unknown as Anthropic.Messages.MessageCreateParamsStreaming, buildSdkRequestOptions(model, abortSignal))
      .asResponse();
    timing.mark("response-headers", { attempt: 1, status: response.status });

    if (response.body === null) {
      throw new Error("Anthropic Messages API returned an empty response body.");
    }

    const pendingToolUses = new Map<number, PendingAnthropicToolUse>();
    let finishReason: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let hasUsage = false;

    for await (const sse of iterateSseMessages(response.body, abortSignal, {
      onChunk() {
        timing.markOnce("first-sse-chunk");
      }
    })) {
      if (sse.data === "[DONE]") {
        continue;
      }

      const event = JSON.parse(sse.data) as Record<string, unknown>;
      const eventType = typeof event["type"] === "string" ? event["type"] : sse.event;

      switch (eventType) {
        case "content_block_start": {
          const index = readNumber(event, "index");
          const contentBlock = readRecord(event, "content_block");
          const contentBlockType = readString(contentBlock, "type");

          if (contentBlockType === "tool_use") {
            const inputFromStart = readOptionalRecord(contentBlock, "input") ?? {};
            pendingToolUses.set(index, {
              index,
              id: normalizeAnthropicToolCallId(readString(contentBlock, "id")),
              name: readString(contentBlock, "name"),
              inputFromStart,
              argumentsJson: "",
              sawArgumentDelta: false
            });
          }
          break;
        }
        case "content_block_delta": {
          const index = readNumber(event, "index");
          const delta = readRecord(event, "delta");
          const deltaType = readString(delta, "type");

          if (deltaType === "text_delta") {
            const text = readString(delta, "text");
            if (text !== "") {
              timing.markOnce("first-text-delta");
              yield { type: "text-delta", text };
            }
          } else if (deltaType === "input_json_delta") {
            const pendingToolUse = pendingToolUses.get(index);
            if (pendingToolUse !== undefined) {
              if (!pendingToolUse.sawArgumentDelta) {
                pendingToolUse.argumentsJson = "";
                pendingToolUse.sawArgumentDelta = true;
              }
              pendingToolUse.argumentsJson += readString(delta, "partial_json");
            }
          }
          break;
        }
        case "content_block_stop": {
          const index = readNumber(event, "index");
          const pendingToolUse = pendingToolUses.get(index);
          if (pendingToolUse !== undefined) {
            yield {
              type: "tool-call",
              toolCallId: pendingToolUse.id,
              toolName: pendingToolUse.name,
              input: pendingToolUse.sawArgumentDelta
                ? parseStreamingJsonObject(pendingToolUse.argumentsJson)
                : pendingToolUse.inputFromStart
            };
            pendingToolUses.delete(index);
          }
          break;
        }
        case "message_start": {
          const message = readOptionalRecord(event, "message");
          const usage = message === undefined ? undefined : readOptionalRecord(message, "usage");
          if (usage !== undefined) {
            inputTokens += readOptionalNumber(usage, "input_tokens") ?? 0;
            cacheReadTokens += readOptionalNumber(usage, "cache_read_input_tokens") ?? 0;
            cacheWriteTokens += readOptionalNumber(usage, "cache_creation_input_tokens") ?? 0;
            hasUsage = true;
          }
          break;
        }
        case "message_delta": {
          const delta = readOptionalRecord(event, "delta");
          const usage = readOptionalRecord(event, "usage");
          const nextFinishReason = delta === undefined ? undefined : readOptionalString(delta, "stop_reason");
          if (nextFinishReason !== undefined && nextFinishReason !== "") {
            finishReason = nextFinishReason;
          }
          if (usage !== undefined) {
            outputTokens += readOptionalNumber(usage, "output_tokens") ?? 0;
            hasUsage = true;
          }
          break;
        }
        case "error": {
          const errorRecord = readOptionalRecord(event, "error");
          if (errorRecord !== undefined) {
            throw new Error(readOptionalString(errorRecord, "message") ?? "Anthropic API reported an error.");
          }
          throw new Error("Anthropic API reported an error.");
        }
      }
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
        ...(hasUsage
          ? {
              tokenUsage: {
                ...createEmptyStepTokenUsage(),
                // Anthropic reports input_tokens as the non-cached portion only.
                // Normalize to total input so cacheRead/cacheWrite stay breakdowns,
                // matching OpenAI token-usage semantics.
                input: inputTokens + cacheReadTokens + cacheWriteTokens,
                output: outputTokens,
                cacheRead: cacheReadTokens,
                cacheWrite: cacheWriteTokens
              } as StepTokenUsage
            }
          : {})
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

function buildAnthropicRequestBody(
  model: AiModel,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  tools: readonly ToolDefinition[],
  requestAffinityKey: string | undefined
): Record<string, unknown> {
  return mergeRequestBodyOptions({
    model: model.modelId,
    max_tokens: model.maxOutputTokens ?? 4096,
    ...(systemPrompt.trim() === "" ? {} : { system: systemPrompt }),
    messages: messagesToAnthropicMessages(messages),
    ...(tools.length === 0 ? {} : { tools: toolsToAnthropicTools(tools, getAnthropicCompat(model).supportsEagerToolInputStreaming) }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.toolChoice === undefined ? {} : { tool_choice: { type: model.toolChoice === "required" ? "any" : "auto" } }),
    stream: true
  }, buildProviderBodyOptions(model, requestAffinityKey));
}

function messagesToAnthropicMessages(messages: readonly ConversationMessage[]): readonly Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    switch (message.role) {
      case "user":
        if (message.content.trim() !== "") {
          result.push({
            role: "user",
            content: message.content
          });
        }
        break;
      case "summary":
        result.push({
          role: "user",
          content: formatContinuationSummaryForModel(message.content)
        });
        break;
      case "assistant": {
        const contentBlocks: Record<string, unknown>[] = [];

        if (message.content !== "") {
          contentBlocks.push({
            type: "text",
            text: message.content
          });
        }

        for (const toolCall of message.toolCalls) {
          contentBlocks.push({
            type: "tool_use",
            id: normalizeAnthropicToolCallId(toolCall.id),
            name: toolCall.name,
            input: parseProviderToolArguments(toolCall.argumentsJson, "anthropic-replay", toolCall.name)
          });
        }

        if (contentBlocks.length > 0) {
          result.push({
            role: "assistant",
            content: contentBlocks
          });
        }
        break;
      }
      case "tool": {
        const toolResults: Record<string, unknown>[] = [
          {
            type: "tool_result",
            tool_use_id: normalizeAnthropicToolCallId(message.toolCallId),
            content: message.content,
            is_error: message.isError
          }
        ];

        while (index + 1 < messages.length && messages[index + 1]?.role === "tool") {
          index += 1;
          const nextToolResult = messages[index];
          if (nextToolResult === undefined) {
            continue;
          }
          if (nextToolResult.role !== "tool") {
            continue;
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: normalizeAnthropicToolCallId(nextToolResult.toolCallId),
            content: nextToolResult.content,
            is_error: nextToolResult.isError
          });
        }

        result.push({
          role: "user",
          content: toolResults
        });
        break;
      }
    }
  }

  return result;
}

function toolsToAnthropicTools(
  tools: readonly ToolDefinition[],
  supportsEagerToolInputStreaming: boolean
): readonly Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {})
  }));
}

function normalizeAnthropicToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
