/**
 * Provider compatibility helpers adapted from pi-ai-style provider shims.
 */

import type { AiModel } from "./types.ts";
import { isJsonObject, type JsonObject } from "../shared/json-value.ts";

/**
 * Compatibility switches for OpenAI Chat Completions-compatible providers.
 */
export interface OpenAiChatCompat {
  readonly supportsStore: boolean;
  readonly supportsUsageInStreaming: boolean;
  readonly supportsReasoningEffort: boolean;
  readonly thinkingFormat: "none" | "openai" | "deepseek" | "openrouter" | "zai" | "qwen";
  readonly maxTokensField: "max_completion_tokens" | "max_tokens";
  readonly requiresToolResultName: boolean;
  readonly requiresAssistantAfterToolResult: boolean;
  readonly replaysAssistantReasoningContent: boolean;
}

/**
 * Compatibility switches for OpenAI Responses-compatible providers.
 */
export interface OpenAiResponsesCompat {
  readonly supportsLongCacheRetention: boolean;
  readonly sendSessionIdHeader: boolean;
}

/**
 * Compatibility switches for Anthropic Messages-compatible providers.
 */
export interface AnthropicCompat {
  readonly supportsEagerToolInputStreaming: boolean;
  readonly supportsLongCacheRetention: boolean;
}

/**
 * Resolve OpenAI Chat compatibility from provider identity, URL, and explicit overrides.
 */
export function getOpenAiChatCompat(model: AiModel): OpenAiChatCompat {
  const detected = detectOpenAiChatCompat(model);
  const compat = readCompatObject(model);

  return {
    supportsStore: readOptionalBoolean(compat, "supportsStore") ?? detected.supportsStore,
    supportsUsageInStreaming: readOptionalBoolean(compat, "supportsUsageInStreaming") ?? detected.supportsUsageInStreaming,
    supportsReasoningEffort: readOptionalBoolean(compat, "supportsReasoningEffort") ?? detected.supportsReasoningEffort,
    thinkingFormat: readOptionalThinkingFormat(compat, "thinkingFormat") ?? detected.thinkingFormat,
    maxTokensField: readOptionalMaxTokensField(compat, "maxTokensField") ?? detected.maxTokensField,
    requiresToolResultName: readOptionalBoolean(compat, "requiresToolResultName") ?? detected.requiresToolResultName,
    requiresAssistantAfterToolResult: readOptionalBoolean(compat, "requiresAssistantAfterToolResult") ?? detected.requiresAssistantAfterToolResult,
    replaysAssistantReasoningContent: readOptionalBoolean(compat, "replaysAssistantReasoningContent")
      ?? detected.replaysAssistantReasoningContent
  };
}

/**
 * Resolve OpenAI Responses compatibility from explicit overrides.
 */
export function getOpenAiResponsesCompat(model: AiModel): OpenAiResponsesCompat {
  const compat = readCompatObject(model);
  return {
    supportsLongCacheRetention: readOptionalBoolean(compat, "supportsLongCacheRetention") ?? true,
    sendSessionIdHeader: readOptionalBoolean(compat, "sendSessionIdHeader") ?? true
  };
}

/**
 * Resolve Anthropic compatibility from explicit overrides.
 */
export function getAnthropicCompat(model: AiModel): AnthropicCompat {
  const compat = readCompatObject(model);
  return {
    supportsEagerToolInputStreaming: readOptionalBoolean(compat, "supportsEagerToolInputStreaming") ?? true,
    supportsLongCacheRetention: readOptionalBoolean(compat, "supportsLongCacheRetention") ?? true
  };
}

function detectOpenAiChatCompat(model: AiModel): OpenAiChatCompat {
  const provider = model.providerId.toLowerCase();
  const providerName = model.providerName.toLowerCase();
  const modelId = model.modelId.toLowerCase();
  const baseUrl = (model.baseUrl ?? "").toLowerCase();
  const isDeepSeekReasoningModel = provider.includes("deepseek")
    || providerName.includes("deepseek")
    || modelId.includes("deepseek")
    || baseUrl.includes("deepseek.com");
  const isNativeOpenAi = model.provider === "openai-chat" && baseUrl.includes("api.openai.com");
  const isOpenRouter = provider.includes("openrouter") || baseUrl.includes("openrouter.ai");
  const isZai = provider === "z-ai" || provider === "z-ai-coding" || baseUrl.includes("api.z.ai");
  const isQwen = provider.includes("qwen") || providerName.includes("qwen") || modelId.includes("qwen");
  const isNonStandard = provider === "gemini"
    || provider === "groq"
    || isDeepSeekReasoningModel
    || provider === "z-ai"
    || provider === "z-ai-coding"
    || provider === "huggingface"
    || baseUrl.includes("generativelanguage.googleapis.com")
    || baseUrl.includes("groq.com")
    || baseUrl.includes("deepseek.com")
    || baseUrl.includes("api.z.ai")
    || baseUrl.includes("router.huggingface.co")
    || baseUrl.includes("openrouter.ai");

  return {
    supportsStore: isNativeOpenAi && !isNonStandard,
    supportsUsageInStreaming: isNativeOpenAi || baseUrl.includes("openrouter.ai"),
    supportsReasoningEffort: !isZai && !isQwen,
    thinkingFormat: isDeepSeekReasoningModel
      ? "deepseek"
      : isOpenRouter
        ? "openrouter"
        : isZai
          ? "zai"
          : isQwen
            ? "qwen"
            : isNativeOpenAi
              ? "openai"
              : "none",
    maxTokensField: baseUrl.includes("chutes.ai")
      ? "max_tokens"
      : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    replaysAssistantReasoningContent: isDeepSeekReasoningModel
  };
}

function readOptionalThinkingFormat(
  record: JsonObject,
  key: string
): OpenAiChatCompat["thinkingFormat"] | undefined {
  const value = record[key];
  return value === "none"
    || value === "openai"
    || value === "deepseek"
    || value === "openrouter"
    || value === "zai"
    || value === "qwen"
    ? value
    : undefined;
}

function readCompatObject(model: AiModel): JsonObject {
  const options = model.providerOptions ?? {};
  const compat = options["compat"];
  return isJsonObject(compat) ? compat : {};
}

function readOptionalBoolean(record: JsonObject, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalMaxTokensField(
  record: JsonObject,
  key: string
): "max_completion_tokens" | "max_tokens" | undefined {
  const value = record[key];
  return value === "max_completion_tokens" || value === "max_tokens" ? value : undefined;
}
