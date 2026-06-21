/**
 * Normalized lifecycle events emitted by a Recode agent run.
 */

import type { StepStats } from "../agent/step-stats.ts";
import type { ProviderStatusEvent } from "../ai/types.ts";
import type { ToolMetadataUpdate } from "../tools/tool.ts";
import type { ToolCall, ToolResultMessage } from "../transcript/message.ts";

/** One normalized event in a Recode session run. */
export type SessionEvent =
  | UserSubmittedSessionEvent
  | AssistantStepStartedSessionEvent
  | AssistantReasoningDeltaSessionEvent
  | AssistantTextDeltaSessionEvent
  | AssistantStepFinishedSessionEvent
  | ToolStartedSessionEvent
  | ToolMetadataUpdatedSessionEvent
  | ToolCompletedSessionEvent
  | ToolErroredSessionEvent
  | ProviderRetrySessionEvent
  | SessionCompactedSessionEvent;

/** Session event observer used by runtime and UI adapters. */
export interface SessionEventObserver {
  (event: SessionEvent): void;
}

export interface UserSubmittedSessionEvent {
  readonly type: "user.submitted";
  readonly timestamp: number;
  readonly content: string;
  readonly modelContent: string;
}

export interface AssistantStepStartedSessionEvent {
  readonly type: "assistant.step.started";
  readonly timestamp: number;
  readonly stepId: string;
}

export interface AssistantTextDeltaSessionEvent {
  readonly type: "assistant.text.delta";
  readonly timestamp: number;
  readonly stepId: string;
  readonly delta: string;
}

export interface AssistantReasoningDeltaSessionEvent {
  readonly type: "assistant.reasoning.delta";
  readonly timestamp: number;
  readonly stepId: string;
  readonly delta: string;
}

export interface AssistantStepFinishedSessionEvent {
  readonly type: "assistant.step.finished";
  readonly timestamp: number;
  readonly stepId: string;
  readonly finalText: string;
  readonly stepStats: StepStats;
}

export interface ToolStartedSessionEvent {
  readonly type: "tool.started";
  readonly timestamp: number;
  readonly stepId: string;
  readonly toolCall: ToolCall;
}

export interface ToolMetadataUpdatedSessionEvent {
  readonly type: "tool.metadata.updated";
  readonly timestamp: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly update: ToolMetadataUpdate;
}

export interface ToolCompletedSessionEvent {
  readonly type: "tool.completed";
  readonly timestamp: number;
  readonly toolResult: ToolResultMessage;
}

export interface ToolErroredSessionEvent {
  readonly type: "tool.errored";
  readonly timestamp: number;
  readonly toolResult: ToolResultMessage;
}

export interface ProviderRetrySessionEvent {
  readonly type: "provider.retry";
  readonly timestamp: number;
  readonly status: ProviderStatusEvent;
}

export interface SessionCompactedSessionEvent {
  readonly type: "session.compacted";
  readonly timestamp: number;
  readonly content: string;
}

