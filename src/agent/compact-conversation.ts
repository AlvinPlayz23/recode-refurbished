/**
 * Conversation compaction and context-estimation helpers.
 *
 * @author dev
 */

import { streamAssistantResponse } from "../ai/stream-assistant-response.ts";
import { formatProviderError } from "../ai/provider-error.ts";
import type { AiModel } from "../ai/types.ts";
import {
  ConversationCompactionError,
  ContextWindowExceededError,
  ModelResponseError,
  OperationAbortedError
} from "../errors/recode-error.ts";
import type {
  ContinuationSummaryMessage,
  ConversationMessage
} from "../transcript/message.ts";
import type { CompactionSessionSnapshot } from "../history/recode-history-types.ts";
import type { StepTokenUsage } from "./step-stats.ts";

const DEFAULT_SUMMARY_CONTEXT_WINDOW_TOKENS = 200_000;
const MAX_RESERVED_CONTEXT_TOKENS = 20_000;
const MESSAGE_OVERHEAD_TOKENS = 12;
const TOOL_CALL_OVERHEAD_TOKENS = 8;
const CHARACTERS_PER_TOKEN_ESTIMATE = 4;
const MICROCOMPACT_TOOL_CONTENT_LIMIT = 4_000;
const MICROCOMPACT_TOOL_EDGE_CHARS = 1_600;
const COMPACTION_SYSTEM_PROMPT = [
  "You are compacting an ongoing Recode coding session.",
  "Write a concise continuation summary for the same assistant to keep working from.",
  "Preserve only durable context:",
  "- the user's goals and constraints",
  "- important decisions and tradeoffs",
  "- files changed or inspected",
  "- relevant tool results and errors",
  "- unfinished work and next steps",
  "Do not invent facts.",
  "Do not restate every message.",
  "Use short markdown bullets when useful."
].join("\n");
const COMPACTION_REQUEST_PROMPT = [
  "Summarize the earlier conversation so the same assistant can continue later.",
  "Focus on durable context and unresolved work."
].join("\n");

/**
 * Default fallback context window used when a model limit is unknown.
 */
export const DEFAULT_FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * Estimated context-window usage for a pending request.
 */
export interface ContextTokenEstimate {
  readonly estimatedTokens: number;
  readonly source: "usage-based" | "rough";
}

/**
 * Auto-compaction decision derived from an estimate and model limits.
 */
export interface AutoCompactionDecision {
  readonly estimatedTokens: number;
  readonly reservedTokens: number;
  readonly usableContextTokens: number;
  readonly shouldCompact: boolean;
}

/**
 * One transcript split into compactable prefix and preserved tail.
 */
export interface CompactionWindow {
  readonly existingSummaries: readonly ContinuationSummaryMessage[];
  readonly compactableMessages: readonly ConversationMessage[];
  readonly tailMessages: readonly ConversationMessage[];
}

/**
 * Manual or automatic compaction result.
 */
export type CompactConversationResult =
  | {
      readonly kind: "noop";
      readonly reason: "nothing-to-compact";
    }
  | {
      readonly kind: "compacted";
      readonly transcript: readonly ConversationMessage[];
      readonly summaryMessage: ContinuationSummaryMessage;
      readonly compactedMessageCount: number;
    };

/** Result of cheap deterministic tool-result microcompaction. */
export type MicrocompactConversationResult =
  | {
      readonly kind: "noop";
    }
  | {
      readonly kind: "compacted";
      readonly transcript: readonly ConversationMessage[];
      readonly compactedToolResultCount: number;
    };

/**
 * Options for transcript compaction.
 */
export interface CompactConversationOptions {
  readonly transcript: readonly ConversationMessage[];
  readonly languageModel: AiModel;
  readonly abortSignal?: AbortSignal;
}

/**
 * Build a durable snapshot for a completed compaction.
 */
export function createCompactionSessionSnapshot(
  beforeTranscript: readonly ConversationMessage[],
  result: Extract<CompactConversationResult, { readonly kind: "compacted" }>,
  reason: CompactionSessionSnapshot["reason"]
): CompactionSessionSnapshot {
  return {
    kind: "compaction",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    compactedMessageCount: result.compactedMessageCount,
    summary: result.summaryMessage.content,
    beforeTranscript,
    afterTranscript: result.transcript
  };
}

/**
 * Estimate how much context the next request is likely to consume.
 */
export function estimateConversationContextTokens(
  transcript: readonly ConversationMessage[],
  pendingUserPrompt?: string
): ContextTokenEstimate {
  const pendingPromptTokens = estimateTextTokens(pendingUserPrompt ?? "");
  const lastUsageIndex = findLastAssistantUsageIndex(transcript);

  if (lastUsageIndex !== -1) {
    const baseMessage = transcript[lastUsageIndex];
    const baseUsage = baseMessage?.role === "assistant"
      ? countContextWindowTokens(baseMessage.stepStats?.tokenUsage)
      : undefined;

    if (baseUsage !== undefined) {
      const trailingMessages = transcript.slice(lastUsageIndex + 1);
      return {
        estimatedTokens: baseUsage + estimateTranscriptTokens(trailingMessages) + pendingPromptTokens,
        source: "usage-based"
      };
    }
  }

  return {
    estimatedTokens: estimateTranscriptTokens(transcript) + pendingPromptTokens,
    source: "rough"
  };
}

/**
 * Compute the reserved compaction buffer for one model.
 */
export function calculateReservedContextTokens(maxOutputTokens?: number): number {
  return Math.min(MAX_RESERVED_CONTEXT_TOKENS, maxOutputTokens ?? MAX_RESERVED_CONTEXT_TOKENS);
}

/**
 * Decide whether a transcript should be compacted before the next step.
 */
export function evaluateAutoCompaction(
  estimate: ContextTokenEstimate,
  contextWindowTokens: number,
  maxOutputTokens?: number
): AutoCompactionDecision {
  const reservedTokens = calculateReservedContextTokens(maxOutputTokens);
  const usableContextTokens = Math.max(1, contextWindowTokens - reservedTokens);

  return {
    estimatedTokens: estimate.estimatedTokens,
    reservedTokens,
    usableContextTokens,
    shouldCompact: estimate.estimatedTokens >= usableContextTokens
  };
}

/**
 * Split a transcript into compactable prefix and preserved tail.
 */
export function splitTranscriptForCompaction(transcript: readonly ConversationMessage[]): CompactionWindow {
  const existingSummaries = transcript.filter((message): message is ContinuationSummaryMessage => message.role === "summary");
  const nonSummaryMessages = transcript.filter((message) => message.role !== "summary");
  const tailStartIndex = findTailStartIndex(nonSummaryMessages);

  return {
    existingSummaries,
    compactableMessages: nonSummaryMessages.slice(0, tailStartIndex),
    tailMessages: nonSummaryMessages.slice(tailStartIndex)
  };
}

/**
 * Deterministically trim old oversized tool results before full summarization.
 */
export function microcompactToolResults(transcript: readonly ConversationMessage[]): MicrocompactConversationResult {
  const split = splitTranscriptForCompaction(transcript);
  let compactedToolResultCount = 0;
  const compactableMessages = split.compactableMessages.map((message) => {
    if (message.role !== "tool") {
      return message;
    }

    const compactedContent = microcompactText(message.content);
    const compactedMetadata = message.metadata?.kind === "bash-output"
      ? {
          ...message.metadata,
          output: microcompactText(message.metadata.output)
        }
      : message.metadata;

    if (compactedContent === message.content && compactedMetadata === message.metadata) {
      return message;
    }

    compactedToolResultCount += 1;
    return {
      ...message,
      content: compactedContent,
      ...(compactedMetadata === undefined ? {} : { metadata: compactedMetadata })
    };
  });

  if (compactedToolResultCount === 0) {
    return { kind: "noop" };
  }

  return {
    kind: "compacted",
    transcript: [
      ...split.existingSummaries,
      ...compactableMessages,
      ...split.tailMessages
    ],
    compactedToolResultCount
  };
}

/**
 * Compact older transcript history into one continuation summary.
 */
export async function compactConversation(options: CompactConversationOptions): Promise<CompactConversationResult> {
  const split = splitTranscriptForCompaction(options.transcript);
  if (split.compactableMessages.length === 0) {
    return {
      kind: "noop",
      reason: "nothing-to-compact"
    };
  }

  const summaryText = await summarizeCompactionWindow(split, options.languageModel, options.abortSignal);
  const summaryMessage: ContinuationSummaryMessage = {
    role: "summary",
    kind: "continuation",
    content: summaryText
  };

  return {
    kind: "compacted",
    transcript: [summaryMessage, ...split.tailMessages],
    summaryMessage,
    compactedMessageCount: split.compactableMessages.length
  };
}

/**
 * Ensure a pending request fits after compaction.
 */
export function assertConversationFitsContextWindow(
  transcript: readonly ConversationMessage[],
  pendingUserPrompt: string,
  contextWindowTokens: number,
  maxOutputTokens?: number
): ContextTokenEstimate {
  const estimate = estimateConversationContextTokens(transcript, pendingUserPrompt);
  const decision = evaluateAutoCompaction(estimate, contextWindowTokens, maxOutputTokens);

  if (decision.shouldCompact) {
    throw new ContextWindowExceededError(
      `Even after compaction, the next request is still estimated at ${estimate.estimatedTokens.toLocaleString()} tokens, `
      + `which exceeds the usable context window of ${decision.usableContextTokens.toLocaleString()} tokens. `
      + "Try /compact earlier, shorten the request, or configure a larger context window for this model."
    );
  }

  return estimate;
}

function findTailStartIndex(messages: readonly ConversationMessage[]): number {
  const userMessageIndexes: number[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      userMessageIndexes.push(index);
    }
  }

  if (userMessageIndexes.length <= 2) {
    return 0;
  }

  return userMessageIndexes[userMessageIndexes.length - 2] ?? 0;
}

function findLastAssistantUsageIndex(messages: readonly ConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.stepStats?.tokenUsage !== undefined) {
      return index;
    }
  }

  return -1;
}

function estimateTranscriptTokens(messages: readonly ConversationMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: ConversationMessage): number {
  switch (message.role) {
    case "user":
      return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
    case "assistant":
      return MESSAGE_OVERHEAD_TOKENS
        + estimateTextTokens(message.content)
        + message.toolCalls.reduce((total, toolCall) =>
          total
          + TOOL_CALL_OVERHEAD_TOKENS
          + estimateTextTokens(toolCall.id)
          + estimateTextTokens(toolCall.name)
          + estimateTextTokens(toolCall.argumentsJson), 0);
    case "tool":
      return MESSAGE_OVERHEAD_TOKENS
        + estimateTextTokens(message.toolCallId)
        + estimateTextTokens(message.toolName)
        + estimateTextTokens(message.content)
        + estimateTextTokens(message.metadata === undefined ? "" : JSON.stringify(message.metadata));
    case "summary":
      return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
  }
}

function estimateTextTokens(value: string): number {
  const normalized = value.trim();
  if (normalized === "") {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / CHARACTERS_PER_TOKEN_ESTIMATE));
}

function microcompactText(value: string): string {
  if (value.length <= MICROCOMPACT_TOOL_CONTENT_LIMIT) {
    return value;
  }

  const removed = value.length - (MICROCOMPACT_TOOL_EDGE_CHARS * 2);
  return [
    value.slice(0, MICROCOMPACT_TOOL_EDGE_CHARS).trimEnd(),
    "",
    `[microcompacted ${removed.toLocaleString()} middle characters from an old tool result]`,
    "",
    value.slice(-MICROCOMPACT_TOOL_EDGE_CHARS).trimStart()
  ].join("\n");
}

function countContextWindowTokens(tokenUsage: StepTokenUsage | undefined): number | undefined {
  if (tokenUsage === undefined) {
    return undefined;
  }

  // input/output are normalized parent totals. Cache and reasoning fields are
  // breakdowns, so adding them here would double-count providers like OpenAI.
  return tokenUsage.input + tokenUsage.output;
}

async function summarizeCompactionWindow(
  split: CompactionWindow,
  languageModel: AiModel,
  abortSignal?: AbortSignal
): Promise<string> {
  const summaryMessages: ConversationMessage[] = [];

  if (split.existingSummaries.length > 0) {
    summaryMessages.push({
      role: "user",
      content: [
        "Earlier continuation summaries:",
        ...split.existingSummaries.map((message) => message.content.trim())
      ].join("\n\n")
    });
  }

  const stream = streamAssistantResponse({
    model: {
      ...languageModel,
      contextWindowTokens: languageModel.contextWindowTokens ?? DEFAULT_SUMMARY_CONTEXT_WINDOW_TOKENS
    },
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    messages: [
      ...summaryMessages,
      ...split.compactableMessages,
      {
        role: "user",
        content: COMPACTION_REQUEST_PROMPT
      }
    ],
    tools: [],
    ...(abortSignal === undefined ? {} : { abortSignal })
  });

  let summaryText = "";
  let finishReason: string | undefined;

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case "text-delta":
        summaryText += part.text;
        break;
      case "reasoning-delta":
        break;
      case "tool-call":
        throw new ConversationCompactionError("Compaction unexpectedly attempted to call a tool.");
      case "error":
        throw new ModelResponseError(
          typeof part.error === "string" ? part.error : formatProviderError(part.error, languageModel)
        );
      case "abort":
        throw new OperationAbortedError("Request aborted");
      case "finish-step":
        finishReason = part.info?.finishReason ?? finishReason;
        break;
      case "finish":
        break;
    }
  }

  if (finishReason === "max_output_tokens") {
    throw new ConversationCompactionError(
      "Compaction summary hit the model output limit. Raise the model's max output tokens or compact earlier."
    );
  }

  const normalizedSummary = summaryText.trim();
  if (normalizedSummary === "") {
    throw new ConversationCompactionError("Compaction returned an empty continuation summary.");
  }

  return normalizedSummary;
}
