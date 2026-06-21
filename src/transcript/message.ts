/**
 * Conversation message model definitions.
 *
 * @author dev
 */

import type { ToolResultMetadata } from "../tools/tool.ts";
import type { StepStats } from "../agent/step-stats.ts";
import type { JsonObject } from "../shared/json-value.ts";

/**
 * A tool call emitted by the model.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  readonly extraContent?: JsonObject;
}

/**
 * Provider-specific assistant metadata needed to replay compatible histories.
 */
export interface AssistantProviderMetadata {
  readonly reasoningContent?: string;
}

/**
 * User message.
 */
export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

/**
 * Assistant message.
 */
export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
  readonly providerMetadata?: AssistantProviderMetadata;
  readonly stepStats?: StepStats;
}

/**
 * Tool result message.
 */
export interface ToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
  readonly metadata?: ToolResultMetadata;
}

/**
 * Compacted continuation summary preserved in the transcript.
 */
export interface ContinuationSummaryMessage {
  readonly role: "summary";
  readonly kind: "continuation";
  readonly content: string;
}

/**
 * Union of all internal conversation message types used by Recode.
 */
export type ConversationMessage = UserMessage | AssistantMessage | ToolResultMessage | ContinuationSummaryMessage;

const CONTINUATION_SUMMARY_PREFIX = "System-generated continuation summary:\n";

/**
 * Format one continuation summary for provider message serialization.
 */
export function formatContinuationSummaryForModel(content: string): string {
  const normalized = content.trim();
  return normalized === ""
    ? CONTINUATION_SUMMARY_PREFIX.trimEnd()
    : `${CONTINUATION_SUMMARY_PREFIX}${normalized}`;
}

/**
 * Format one continuation summary for transcript display.
 */
export function formatContinuationSummaryForDisplay(content: string): string {
  const normalized = content.trim();
  return normalized === ""
    ? "## Continuation Summary"
    : `## Continuation Summary\n\n${normalized}`;
}
