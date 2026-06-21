/**
 * Streaming adapter for the OpenAI Responses API.
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
import {
  readOptionalNumber,
  readOptionalRecord,
  readOptionalString,
  readRecord,
  readString,
  splitToolCallId
} from "./provider-json.ts";

interface ResponsesRequestBody extends Record<string, unknown> {
  readonly model: string;
  readonly instructions?: string;
  readonly input: readonly unknown[];
  readonly tools?: readonly unknown[];
  readonly max_output_tokens?: number;
  readonly temperature?: number;
  readonly tool_choice?: "auto" | "required";
  readonly stream: true;
  readonly store: boolean;
}

interface PendingFunctionCall {
  callId: string;
  itemId: string | undefined;
  name: string;
  argumentsJson: string;
}

/**
 * Stream a response from the OpenAI Responses API.
 */
export async function* streamOpenAiResponses(
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
      operation: "openai-responses",
      ...(requestAffinityKey === undefined ? {} : { requestAffinityKey })
    });
    timing.mark("request-start", { attempt: 1 });
    const client = createOpenAiSdkClient(
      model,
      requestAffinityKey,
      "openai-responses",
      onProviderStatus
    );
    const requestBody = buildResponsesRequestBody(model, systemPrompt, messages, tools, requestAffinityKey);
    const { data: responseStream, response } = await client.responses
      .create(requestBody as unknown as OpenAI.Responses.ResponseCreateParamsStreaming, buildSdkRequestOptions(model, abortSignal))
      .withResponse();
    timing.mark("response-headers", { attempt: 1, status: response.status });

    let pendingFunctionCall: PendingFunctionCall | undefined;
    let finishInfo: { finishReason?: string; costUsd?: number; tokenUsage?: StepTokenUsage } | undefined;

    for await (const streamEvent of responseStream) {
      timing.markOnce("first-sse-chunk");
      const event = streamEvent as unknown as Record<string, unknown>;
      const eventType = typeof event["type"] === "string" ? event["type"] : undefined;

      switch (eventType) {
        case "response.output_item.added": {
          const item = readRecord(event, "item");
          const itemType = readString(item, "type");
          if (itemType === "function_call") {
            pendingFunctionCall = {
              callId: readString(item, "call_id"),
              itemId: readOptionalString(item, "id"),
              name: readString(item, "name"),
              argumentsJson: readOptionalString(item, "arguments") ?? ""
            };
          } else {
            pendingFunctionCall = undefined;
          }
          break;
        }
        case "response.output_text.delta":
        case "response.refusal.delta": {
          const delta = readString(event, "delta");
          if (delta !== "") {
            timing.markOnce("first-text-delta");
            yield { type: "text-delta", text: delta };
          }
          break;
        }
        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta": {
          const delta = readString(event, "delta");
          if (delta !== "") {
            yield { type: "reasoning-delta", text: delta };
          }
          break;
        }
        case "response.function_call_arguments.delta": {
          if (pendingFunctionCall !== undefined) {
            pendingFunctionCall.argumentsJson += readString(event, "delta");
          }
          break;
        }
        case "response.function_call_arguments.done": {
          if (pendingFunctionCall !== undefined) {
            pendingFunctionCall.argumentsJson = readString(event, "arguments");
          }
          break;
        }
        case "response.output_item.done": {
          const item = readRecord(event, "item");
          const itemType = readString(item, "type");

          if (itemType === "function_call") {
            const toolName = readString(item, "name");
            const toolCallId = buildResponsesToolCallId(readString(item, "call_id"), readOptionalString(item, "id"));
            const argumentsJson = readOptionalString(item, "arguments")
              ?? pendingFunctionCall?.argumentsJson
              ?? "{}";

            yield {
              type: "tool-call",
              toolCallId,
              toolName,
              input: parseProviderToolArguments(argumentsJson, "openai-responses", toolName)
            };
            pendingFunctionCall = undefined;
          } else {
            pendingFunctionCall = undefined;
          }
          break;
        }
        case "response.failed": {
          const responseRecord = readOptionalRecord(event, "response");
          const errorRecord = responseRecord === undefined ? undefined : readOptionalRecord(responseRecord, "error");
          if (errorRecord !== undefined) {
            const errorMessage = readOptionalString(errorRecord, "message");
            if (errorMessage !== undefined && errorMessage.trim() !== "") {
              throw new Error(errorMessage);
            }
          }
          throw new Error("OpenAI Responses API reported a failure.");
        }
        case "response.completed": {
          const responseRecord = readOptionalRecord(event, "response");
          if (responseRecord !== undefined) {
            finishInfo = readResponsesFinishInfo(responseRecord);
          }
          break;
        }
        case "response.incomplete": {
          const responseRecord = readOptionalRecord(event, "response");
          if (responseRecord !== undefined) {
            finishInfo = {
              ...readResponsesFinishInfo(responseRecord),
              finishReason: "max_output_tokens"
            };
          }
          break;
        }
        case "error":
          throw new Error(readString(event, "message"));
      }
    }

    if (abortSignal?.aborted ?? false) {
      timing.mark("request-abort");
      yield { type: "abort" };
      return;
    }

    yield { type: "finish-step", ...(finishInfo === undefined ? {} : { info: finishInfo }) };
    timing.mark("request-finish", {
      ...(finishInfo?.finishReason === undefined ? {} : { finishReason: finishInfo.finishReason })
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

function buildResponsesRequestBody(
  model: AiModel,
  systemPrompt: string,
  messages: readonly ConversationMessage[],
  tools: readonly ToolDefinition[],
  requestAffinityKey: string | undefined
): ResponsesRequestBody {
  return mergeRequestBodyOptions({
    model: model.modelId,
    ...(systemPrompt.trim() === "" ? {} : { instructions: systemPrompt }),
    input: messagesToResponsesInput(messages),
    ...(tools.length === 0 ? {} : { tools: toolsToResponsesTools(tools) }),
    ...(model.maxOutputTokens === undefined ? {} : { max_output_tokens: model.maxOutputTokens }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.toolChoice === undefined ? {} : { tool_choice: model.toolChoice }),
    stream: true,
    store: false
  }, buildProviderBodyOptions(model, requestAffinityKey)) as ResponsesRequestBody;
}

function messagesToResponsesInput(messages: readonly ConversationMessage[]): readonly unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        input.push({
          role: "user",
          content: [{ type: "input_text", text: message.content }]
        });
        break;
      case "assistant":
        if (message.content !== "") {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: message.content }]
          });
        }

        for (const toolCall of message.toolCalls) {
          input.push({
            type: "function_call",
            call_id: splitToolCallId(toolCall.id),
            name: toolCall.name,
            arguments: toolCall.argumentsJson
          });
        }
        break;
      case "summary":
        input.push({
          role: "user",
          content: [{ type: "input_text", text: formatContinuationSummaryForModel(message.content) }]
        });
        break;
      case "tool":
        input.push({
          type: "function_call_output",
          call_id: splitToolCallId(message.toolCallId),
          output: message.content
        });
        break;
    }
  }

  return input;
}

function toolsToResponsesTools(tools: readonly ToolDefinition[]): readonly unknown[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }));
}

function buildResponsesToolCallId(callId: string, itemId: string | undefined): string {
  return itemId === undefined || itemId === "" ? callId : `${callId}|${itemId}`;
}

function readResponsesFinishInfo(response: Record<string, unknown>): {
  finishReason?: string;
  costUsd?: number;
  tokenUsage?: StepTokenUsage;
} {
  const usage = readOptionalRecord(response, "usage");
  const tokenUsage = usage === undefined ? undefined : {
    ...createEmptyStepTokenUsage(),
    input: readOptionalNumber(usage, "input_tokens") ?? 0,
    output: readOptionalNumber(usage, "output_tokens") ?? 0,
    reasoning: readOptionalNumber(usage, "output_tokens_details.reasoning_tokens") ?? 0,
    cacheRead: readOptionalNumber(usage, "input_tokens_details.cached_tokens") ?? 0,
    cacheWrite: 0
  };

  const status = readOptionalString(response, "status");
  return {
    ...(status === undefined ? {} : { finishReason: status }),
    ...(tokenUsage === undefined ? {} : { tokenUsage })
  };
}
