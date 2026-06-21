/**
 * Model factory that builds the internal AI transport model descriptor.
 *
 * @author dev
 */

import type { AiModel } from "../ai/types.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";

/**
 * Build the internal AI model descriptor from runtime configuration.
 *
 * - anthropic: Anthropic Messages API
 * - openai and openai-oauth: OpenAI Responses API
 * - openai-chat and native compatible providers: OpenAI Chat Completions API
 */
export function createLanguageModel(config: RuntimeConfig): AiModel {
  return {
    provider: config.provider,
    providerId: config.providerId,
    providerName: config.providerName,
    modelId: config.model,
    apiKey: config.apiKey ?? "",
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.providerHeaders === undefined ? {} : { providerHeaders: config.providerHeaders }),
    ...(config.providerOptions === undefined ? {} : { providerOptions: config.providerOptions }),
    ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.toolChoice === undefined ? {} : { toolChoice: config.toolChoice }),
    ...(config.contextWindowTokens === undefined ? {} : { contextWindowTokens: config.contextWindowTokens }),
    api: resolveApiKind(config.provider)
  };
}

function resolveApiKind(provider: RuntimeConfig["provider"]): AiModel["api"] {
  switch (provider) {
    case "anthropic":
      return "anthropic-messages";
    case "openai-chat":
    case "gemini":
    case "groq":
    case "aihubmix":
    case "deepseek":
    case "z-ai":
    case "z-ai-coding":
    case "huggingface":
      return "openai-chat-completions";
    case "openai":
    case "openai-oauth":
      return "openai-responses";
  }
}
