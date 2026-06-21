/**
 * Main agent loop implementation.
 *
 * @author Zhenxin
 */

import type { AiModel } from "../ai/types.ts";
import { OperationAbortedError } from "../errors/recode-error.ts";
import type { SessionEventObserver } from "../session/session-event.ts";
import type { ConversationMessage } from "../transcript/message.ts";
import type { ToolExecutionContext } from "../tools/tool.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import type { StepStats } from "./step-stats.ts";
import {
  DoomLoopGuard,
  executeAgentSessionToolCalls,
  processAgentSessionStep,
  type ProviderStatusObserver,
  type StepObserver,
  type TextDeltaObserver,
  type ToolCallObserver,
  type ToolMetadataObserver,
  type ToolResultObserver
} from "./session-processor.ts";

export type {
  StepObserver,
  TextDeltaObserver,
  ToolCallObserver,
  ToolMetadataObserver,
  ToolResultObserver,
  ProviderStatusObserver
} from "./session-processor.ts";

/**
 * Transcript update observer.
 */
export interface TranscriptObserver {
  (transcript: readonly ConversationMessage[]): void;
}

/**
 * Agent execution options.
 */
export interface AgentRunOptions {
  readonly systemPrompt: string;
  readonly initialUserPrompt: string;
  readonly initialModelUserPrompt?: string;
  readonly previousMessages?: readonly ConversationMessage[];
  readonly languageModel: AiModel;
  readonly toolRegistry: ToolRegistry;
  readonly toolContext: ToolExecutionContext;
  readonly abortSignal?: AbortSignal;
  readonly requestAffinityKey?: string;
  readonly onSessionEvent?: SessionEventObserver;
  readonly onToolCall?: ToolCallObserver;
  readonly onTextDelta?: TextDeltaObserver;
  readonly onToolMetadata?: ToolMetadataObserver;
  readonly onToolResult?: ToolResultObserver;
  readonly onProviderStatus?: ProviderStatusObserver;
  readonly onStepComplete?: StepObserver;
  readonly onTranscriptUpdate?: TranscriptObserver;
}

/**
 * Agent execution result.
 */
export interface AgentRunResult {
  readonly finalText: string;
  readonly transcript: readonly ConversationMessage[];
  readonly iterations: number;
  readonly steps: readonly StepStats[];
}

/**
 * Run the main Recode loop until the model stops requesting tools.
 */
export async function runAgentLoop(options: AgentRunOptions): Promise<AgentRunResult> {
  if (options.abortSignal?.aborted ?? false) {
    throw new OperationAbortedError("Request aborted");
  }

  const previousMessageCount = options.previousMessages?.length ?? 0;
  const modelInitialUserPrompt = options.initialModelUserPrompt ?? options.initialUserPrompt;
  const messages: ConversationMessage[] = [
    ...(options.previousMessages ?? []),
    {
      role: "user",
      content: modelInitialUserPrompt
    }
  ];
  options.onSessionEvent?.({
    type: "user.submitted",
    timestamp: Date.now(),
    content: options.initialUserPrompt,
    modelContent: modelInitialUserPrompt
  });
  publishTranscriptUpdate(options.onTranscriptUpdate, toPublicTranscript(messages, previousMessageCount, options.initialUserPrompt));

  let iterations = 0;
  const steps: StepStats[] = [];
  const doomLoopGuard = new DoomLoopGuard();

  while (true) {
    const stepId = crypto.randomUUID();
    options.onSessionEvent?.({
      type: "assistant.step.started",
      timestamp: Date.now(),
      stepId
    });
    const step = await processAgentSessionStep({
      stepId,
      systemPrompt: options.systemPrompt,
      languageModel: options.languageModel,
      toolRegistry: options.toolRegistry,
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.requestAffinityKey === undefined ? {} : { requestAffinityKey: options.requestAffinityKey }),
      ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
      ...(options.onToolCall === undefined ? {} : { onToolCall: options.onToolCall }),
      ...(options.onTextDelta === undefined ? {} : { onTextDelta: options.onTextDelta }),
      onProviderStatus(event) {
        if (event.type === "retry") {
          options.onSessionEvent?.({
            type: "provider.retry",
            timestamp: Date.now(),
            status: event
          });
        }
        options.onProviderStatus?.(event);
      }
    }, messages);

    messages.push(step.assistantMessage);
    publishTranscriptUpdate(options.onTranscriptUpdate, toPublicTranscript(messages, previousMessageCount, options.initialUserPrompt));
    steps.push(step.stepStats);
    options.onStepComplete?.(step.stepStats);

    iterations += 1;

    if (step.toolCalls.length === 0) {
      return {
        finalText: step.accumulatedText,
        transcript: toPublicTranscript(messages, previousMessageCount, options.initialUserPrompt),
        iterations,
        steps
      };
    }

    doomLoopGuard.check(step.toolCalls);
    const toolMessages = await executeAgentSessionToolCalls(step.toolCalls, {
      toolRegistry: options.toolRegistry,
      toolContext: options.toolContext,
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
      ...(options.onToolMetadata === undefined ? {} : { onToolMetadata: options.onToolMetadata }),
      ...(options.onToolResult === undefined ? {} : { onToolResult: options.onToolResult })
    });
    messages.push(...toolMessages);
    publishTranscriptUpdate(options.onTranscriptUpdate, toPublicTranscript(messages, previousMessageCount, options.initialUserPrompt));

    if (options.abortSignal?.aborted ?? false) {
      throw new OperationAbortedError("Request aborted");
    }
  }
}

function toPublicTranscript(
  messages: readonly ConversationMessage[],
  currentUserMessageIndex: number,
  publicUserPrompt: string
): readonly ConversationMessage[] {
  const currentUserMessage = messages[currentUserMessageIndex];
  if (currentUserMessage?.role !== "user" || currentUserMessage.content === publicUserPrompt) {
    return [...messages];
  }

  return messages.map((message, index) =>
    index === currentUserMessageIndex
      ? { role: "user", content: publicUserPrompt }
      : message
  );
}

function publishTranscriptUpdate(
  observer: TranscriptObserver | undefined,
  messages: readonly ConversationMessage[]
): void {
  observer?.([...messages]);
}
