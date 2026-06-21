/**
 * Session-step processing for the Recode agent loop.
 */

import { streamAssistantResponse } from "../ai/stream-assistant-response.ts";
import { formatProviderError } from "../ai/provider-error.ts";
import type { AiModel, ProviderStatusEvent } from "../ai/types.ts";
import { DoomLoopDetectedError, ModelResponseError, OperationAbortedError } from "../errors/recode-error.ts";
import type { SessionEventObserver } from "../session/session-event.ts";
import type { ConversationMessage, ToolCall, ToolResultMessage } from "../transcript/message.ts";
import { formatQuestionAnswerSummary, parseQuestionToolResult } from "../tools/ask-user-question-tool.ts";
import { executeToolCall } from "../tools/execute-tool-call.ts";
import { withFileMutationQueue } from "../tools/file-mutation-queue.ts";
import type { ToolExecutionContext, ToolMetadataUpdate } from "../tools/tool.ts";
import { parseToolArguments } from "../tools/tool-arguments.ts";
import { createToolErrorMessage } from "../tools/tool-result-format.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import type { StepStats } from "./step-stats.ts";
import { SUBAGENT_TASK_CONCURRENCY_LIMIT } from "./subagent.ts";

const DOOM_LOOP_TURN_LIMIT = 15;
const DEFAULT_PARALLEL_TOOL_LIMIT = 6;

type ToolScheduleMode = "parallel" | "sequential" | "mutation";

interface ScheduledToolCall {
  readonly toolCall: ToolCall;
  readonly mode: ToolScheduleMode;
  readonly mutationKey?: string;
}

/**
 * Tool call observer.
 */
export interface ToolCallObserver {
  (toolCall: ToolCall): void;
}

/**
 * Text delta observer.
 */
export interface TextDeltaObserver {
  (delta: string): void;
}

/**
 * Tool result observer.
 */
export interface ToolResultObserver {
  (toolResult: ToolResultMessage): void;
}

/**
 * Live tool metadata update with the tool identity attached.
 */
export interface ToolMetadataUpdateNotification {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly update: ToolMetadataUpdate;
}

/**
 * Live tool metadata observer.
 */
export interface ToolMetadataObserver {
  (update: ToolMetadataUpdateNotification): void;
}

/**
 * Step completion observer.
 */
export interface StepObserver {
  (step: StepStats): void;
}

/**
 * Provider request status observer.
 */
export interface ProviderStatusObserver {
  (event: ProviderStatusEvent): void;
}

/**
 * Dependencies for processing one model step.
 */
export interface AgentSessionStepOptions {
  readonly stepId: string;
  readonly systemPrompt: string;
  readonly languageModel: AiModel;
  readonly toolRegistry: ToolRegistry;
  readonly abortSignal?: AbortSignal;
  readonly requestAffinityKey?: string;
  readonly onSessionEvent?: SessionEventObserver;
  readonly onToolCall?: ToolCallObserver;
  readonly onTextDelta?: TextDeltaObserver;
  readonly onProviderStatus?: ProviderStatusObserver;
}

/**
 * Dependencies for executing tools requested by one model step.
 */
export interface AgentSessionToolOptions {
  readonly toolRegistry: ToolRegistry;
  readonly toolContext: ToolExecutionContext;
  readonly abortSignal?: AbortSignal;
  readonly onSessionEvent?: SessionEventObserver;
  readonly onToolMetadata?: ToolMetadataObserver;
  readonly onToolResult?: ToolResultObserver;
}

/**
 * Result of one streamed model step.
 */
export interface AgentSessionStepResult {
  readonly assistantMessage: ConversationMessage;
  readonly toolCalls: readonly ToolCall[];
  readonly stepStats: StepStats;
  readonly accumulatedText: string;
}

/**
 * Guard against repeated identical tool-call batches.
 */
export class DoomLoopGuard {
  private previousToolSignatureBatch: string | undefined;
  private repeatedToolBatchCount = 0;

  /**
   * Throw if the current tool-call batch repeats too many times.
   */
  check(toolCalls: readonly ToolCall[]): void {
    const currentToolSignatureBatch = buildToolSignatureBatch(toolCalls);
    if (currentToolSignatureBatch === this.previousToolSignatureBatch) {
      this.repeatedToolBatchCount += 1;
    } else {
      this.previousToolSignatureBatch = currentToolSignatureBatch;
      this.repeatedToolBatchCount = 1;
    }

    if (this.repeatedToolBatchCount >= DOOM_LOOP_TURN_LIMIT) {
      throw new DoomLoopDetectedError(
        `Detected a repeated tool-call loop after ${DOOM_LOOP_TURN_LIMIT} identical turns: ${describeToolBatch(toolCalls)}`
      );
    }
  }
}

/**
 * Consume one assistant stream and return the transcript-ready assistant step.
 */
export async function processAgentSessionStep(
  options: AgentSessionStepOptions,
  messages: readonly ConversationMessage[]
): Promise<AgentSessionStepResult> {
  const turnStartedAt = Date.now();
  const stream = streamAssistantResponse({
    model: options.languageModel,
    systemPrompt: options.systemPrompt,
    messages,
    tools: options.toolRegistry.list(),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    ...(options.requestAffinityKey === undefined ? {} : { requestAffinityKey: options.requestAffinityKey }),
    ...(options.onProviderStatus === undefined ? {} : { onProviderStatus: options.onProviderStatus })
  });

  let accumulatedText = "";
  let accumulatedReasoningContent = "";
  const toolCalls: ToolCall[] = [];
  let finishReason: string | undefined;
  let tokenUsage: StepStats["tokenUsage"] | undefined;
  let costUsd: number | undefined;

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case "text-delta":
        accumulatedText += part.text;
        options.onSessionEvent?.({
          type: "assistant.text.delta",
          timestamp: Date.now(),
          stepId: options.stepId,
          delta: part.text
        });
        options.onTextDelta?.(part.text);
        break;
      case "reasoning-delta":
        accumulatedReasoningContent += part.text;
        options.onSessionEvent?.({
          type: "assistant.reasoning.delta",
          timestamp: Date.now(),
          stepId: options.stepId,
          delta: part.text
        });
        break;
      case "error":
        throw new ModelResponseError(
          typeof part.error === "string" ? part.error : formatProviderError(part.error, options.languageModel)
        );
      case "abort":
        throw new OperationAbortedError("Request aborted");
      case "tool-call": {
        const toolCall: ToolCall = {
          id: part.toolCallId,
          name: part.toolName,
          argumentsJson: JSON.stringify(part.input),
          ...(part.extraContent === undefined ? {} : { extraContent: part.extraContent })
        };
        toolCalls.push(toolCall);
        options.onSessionEvent?.({
          type: "tool.started",
          timestamp: Date.now(),
          stepId: options.stepId,
          toolCall
        });
        options.onToolCall?.(toolCall);
        break;
      }
      case "finish-step":
        finishReason = part.info?.finishReason ?? finishReason;
        tokenUsage = part.info?.tokenUsage ?? tokenUsage;
        costUsd = part.info?.costUsd ?? costUsd;
        break;
      case "finish":
        break;
    }
  }

  throwIfAborted(options.abortSignal);

  const stepStats: StepStats = {
    finishReason: finishReason ?? inferFinishReason(toolCalls.length),
    durationMs: Math.max(0, Date.now() - turnStartedAt),
    toolCallCount: toolCalls.length,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(tokenUsage === undefined ? {} : { tokenUsage })
  };

  options.onSessionEvent?.({
    type: "assistant.step.finished",
    timestamp: Date.now(),
    stepId: options.stepId,
    finalText: accumulatedText,
    stepStats
  });

  return {
    accumulatedText,
    toolCalls,
    stepStats,
    assistantMessage: {
      role: "assistant",
      content: accumulatedText,
      toolCalls,
      ...(accumulatedReasoningContent === ""
        ? {}
        : { providerMetadata: { reasoningContent: accumulatedReasoningContent } }),
      stepStats
    }
  };
}

/**
 * Execute tool calls and return transcript messages produced by the tool phase.
 */
export async function executeAgentSessionToolCalls(
  toolCalls: readonly ToolCall[],
  options: AgentSessionToolOptions
): Promise<readonly ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  const scheduledCalls = toolCalls.map((toolCall) => scheduleToolCall(toolCall));

  for (let index = 0; index < scheduledCalls.length; index += 1) {
    const scheduledCall = scheduledCalls[index]!;
    if (scheduledCall.mode !== "sequential") {
      const batch = collectParallelToolBatch(scheduledCalls, index);
      const batchMessages = await executeParallelToolBatch(batch, options);
      messages.push(...batchMessages);
      index += batch.length - 1;
      if (options.abortSignal?.aborted ?? false) {
        return messages;
      }
      continue;
    }

    const toolCall = scheduledCall.toolCall;

    if (options.abortSignal?.aborted ?? false) {
      const abortedResult = createToolErrorMessage(toolCall, "Request aborted");
      messages.push(abortedResult);
      publishToolResultEvent(abortedResult, options);
      options.onToolResult?.(abortedResult);
      return messages;
    }

    const toolResult = await executeToolCall(
      toolCall,
      options.toolRegistry,
      withToolRuntimeContext(options.toolContext, toolCall, options.abortSignal, options.onToolMetadata, options.onSessionEvent)
    );
    messages.push(toolResult);
    publishToolResultEvent(toolResult, options);
    options.onToolResult?.(toolResult);

    if (options.abortSignal?.aborted ?? false) {
      return messages;
    }

    const followUpUserMessage = buildSyntheticUserMessageFromToolResult(
      toolResult.toolName,
      toolResult.content,
      toolResult.isError
    );
    if (followUpUserMessage !== undefined) {
      messages.push(followUpUserMessage);
    }
  }

  return messages;
}

function collectParallelToolBatch(
  scheduledCalls: readonly ScheduledToolCall[],
  startIndex: number
): readonly ScheduledToolCall[] {
  const batch: ScheduledToolCall[] = [];

  for (let index = startIndex; index < scheduledCalls.length; index += 1) {
    const scheduledCall = scheduledCalls[index]!;
    if (scheduledCall.mode === "sequential") {
      break;
    }
    batch.push(scheduledCall);
  }

  return batch;
}

async function executeParallelToolBatch(
  scheduledCalls: readonly ScheduledToolCall[],
  options: AgentSessionToolOptions
): Promise<readonly ConversationMessage[]> {
  const results = await runWithConcurrency(
    scheduledCalls,
    getParallelToolLimit(scheduledCalls),
    async (scheduledCall) => {
      const toolCall = scheduledCall.toolCall;
      if (options.abortSignal?.aborted ?? false) {
        return createToolErrorMessage(toolCall, "Request aborted");
      }

      const execute = async () =>
        await executeToolCall(
          toolCall,
          options.toolRegistry,
          withToolRuntimeContext(options.toolContext, toolCall, options.abortSignal, options.onToolMetadata, options.onSessionEvent)
        );

      return scheduledCall.mode === "mutation"
        ? await withFileMutationQueue(options.toolContext.workspaceRoot, scheduledCall.mutationKey ?? "*", execute)
        : await execute();
    }
  );

  const messages: ConversationMessage[] = [];
  for (const toolResult of results) {
    messages.push(toolResult);
    publishToolResultEvent(toolResult, options);
    options.onToolResult?.(toolResult);

    const followUpUserMessage = buildSyntheticUserMessageFromToolResult(
      toolResult.toolName,
      toolResult.content,
      toolResult.isError
    );
    if (followUpUserMessage !== undefined) {
      messages.push(followUpUserMessage);
    }
  }

  return messages;
}

function scheduleToolCall(toolCall: ToolCall): ScheduledToolCall {
  if (isSequentialTool(toolCall.name)) {
    return { toolCall, mode: "sequential" };
  }

  if (isMutationTool(toolCall.name)) {
    return {
      toolCall,
      mode: "mutation",
      mutationKey: readMutationKey(toolCall)
    };
  }

  return { toolCall, mode: "parallel" };
}

function isSequentialTool(toolName: string): boolean {
  return toolName === "Bash" || toolName === "AskUserQuestion";
}

function isMutationTool(toolName: string): boolean {
  return toolName === "Write" || toolName === "Edit" || toolName === "ApplyPatch";
}

function readMutationKey(toolCall: ToolCall): string {
  if (toolCall.name === "ApplyPatch") {
    return readApplyPatchMutationKey(toolCall.argumentsJson);
  }

  try {
    const arguments_ = parseToolArguments(toolCall.argumentsJson);
    const path = arguments_["path"];
    return typeof path === "string" && path.trim() !== "" ? path : "*";
  } catch {
    return "*";
  }
}

function readApplyPatchMutationKey(argumentsJson: string): string {
  try {
    const arguments_ = parseToolArguments(argumentsJson);
    const patch = arguments_["patch"];
    if (typeof patch !== "string") {
      return "*";
    }

    const paths = Array.from(new Set(
      patch
        .split(/\r?\n/)
        .map((line) => readApplyPatchHeaderPath(line))
        .filter((path): path is string => path !== undefined)
    ));
    return paths.length === 1 ? paths[0]! : "*";
  } catch {
    return "*";
  }
}

function readApplyPatchHeaderPath(line: string): string | undefined {
  for (const prefix of ["*** Add File: ", "*** Delete File: ", "*** Update File: "]) {
    if (line.startsWith(prefix)) {
      const path = line.slice(prefix.length).trim();
      return path === "" ? undefined : path;
    }
  }
  return undefined;
}

function getParallelToolLimit(scheduledCalls: readonly ScheduledToolCall[]): number {
  return scheduledCalls.some((scheduledCall) => scheduledCall.toolCall.name === "Task")
    ? SUBAGENT_TASK_CONCURRENCY_LIMIT
    : DEFAULT_PARALLEL_TOOL_LIMIT;
}

async function runWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  limit: number,
  worker: (input: TInput) => Promise<TOutput>
): Promise<readonly TOutput[]> {
  const results: TOutput[] = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(inputs[index]!);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function withToolRuntimeContext(
  context: ToolExecutionContext,
  toolCall: ToolCall,
  abortSignal: AbortSignal | undefined,
  onToolMetadata: ToolMetadataObserver | undefined,
  onSessionEvent: SessionEventObserver | undefined
): ToolExecutionContext {
  return {
    ...context,
    ...(abortSignal === undefined ? {} : { abortSignal }),
    updateToolMetadata(update) {
      onToolMetadata?.({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        update
      });
      onSessionEvent?.({
        type: "tool.metadata.updated",
        timestamp: Date.now(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        update
      });
      return context.updateToolMetadata?.(update);
    }
  };
}

function publishToolResultEvent(toolResult: ToolResultMessage, options: AgentSessionToolOptions): void {
  options.onSessionEvent?.({
    type: toolResult.isError ? "tool.errored" : "tool.completed",
    timestamp: Date.now(),
    toolResult
  });
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted ?? false) {
    throw new OperationAbortedError("Request aborted");
  }
}

function inferFinishReason(toolCallCount: number): string {
  return toolCallCount > 0 ? "tool_calls" : "stop";
}

function buildToolSignatureBatch(toolCalls: readonly ToolCall[]): string {
  return toolCalls
    .map((toolCall) => `${toolCall.name}:${toolCall.argumentsJson}`)
    .join("\n");
}

function describeToolBatch(toolCalls: readonly ToolCall[]): string {
  return toolCalls
    .map((toolCall) => toolCall.name)
    .join(", ");
}

function buildSyntheticUserMessageFromToolResult(
  toolName: string,
  content: string,
  isError: boolean
): ConversationMessage | undefined {
  if (isError || toolName !== "AskUserQuestion") {
    return undefined;
  }

  const parsed = parseQuestionToolResult(content);
  if (parsed === undefined) {
    return undefined;
  }

  return {
    role: "user",
    content: formatQuestionAnswerSummary(parsed)
  };
}
