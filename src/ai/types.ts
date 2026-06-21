/**
 * Types for Recode's internal AI transport layer.
 */

import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import type { JsonObject } from "../shared/json-value.ts";
import type { ConversationMessage } from "../transcript/message.ts";
import type { ToolDefinition } from "../tools/tool.ts";
import type { StepTokenUsage } from "../agent/step-stats.ts";

/**
 * Supported low-level API modes in the internal AI layer.
 */
export type AiApiKind = "openai-responses" | "openai-chat-completions" | "anthropic-messages";

/**
 * Internal model descriptor used by the AI transport layer.
 */
export interface AiModel {
  readonly provider: RuntimeConfig["provider"];
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly providerHeaders?: Readonly<Record<string, string>>;
  readonly providerOptions?: JsonObject;
  readonly api: AiApiKind;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly toolChoice?: "auto" | "required";
  readonly contextWindowTokens?: number;
}

/**
 * Provider-reported completion details for one streamed assistant step.
 */
export interface StreamCompletionInfo {
  readonly finishReason?: string;
  readonly costUsd?: number;
  readonly tokenUsage?: StepTokenUsage;
}

/**
 * Provider request status emitted while a model request is in flight.
 */
export interface ProviderStatusEvent {
  readonly type: "request-start" | "retry";
  readonly operation: AiApiKind;
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Normalized stream events emitted by provider adapters.
 */
export type AiStreamPart =
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly extraContent?: JsonObject;
    }
  | { readonly type: "error"; readonly error: unknown }
  | { readonly type: "abort" }
  | { readonly type: "finish-step"; readonly info?: StreamCompletionInfo }
  | { readonly type: "finish" };

/**
 * Stream wrapper consumed by the agent loop.
 */
export interface AiResponseStream {
  readonly fullStream: AsyncIterable<AiStreamPart>;
}

/**
 * Parameters for one streamed assistant response.
 */
export interface StreamAssistantResponseOptions {
  readonly model: AiModel;
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly abortSignal?: AbortSignal;
  readonly requestAffinityKey?: string;
  readonly onProviderStatus?: (event: ProviderStatusEvent) => void;
}
