/**
 * Tests for provider-specific request shaping.
 */

import { describe, expect, it } from "bun:test";
import type { AiModel } from "./types.ts";
import {
  buildProviderBodyOptions,
  buildProviderHeaders,
  buildProviderTransportSettings
} from "./provider-request-options.ts";

describe("provider request options", () => {
  it("defaults OpenRouter to low-latency routing and prompt cache affinity", () => {
    const options = buildProviderBodyOptions(openRouterModel(), "conversation-1");

    expect(options).toEqual({
      usage: { include: true },
      provider: { sort: "latency" },
      prompt_cache_key: "conversation-1"
    });
  });

  it("lets explicit OpenRouter routing override latency defaults", () => {
    const options = buildProviderBodyOptions({
      ...openRouterModel(),
      providerOptions: {
        provider: { order: ["nvidia"] }
      }
    }, "conversation-1");

    expect(options).toEqual({
      usage: { include: true },
      provider: { order: ["nvidia"] },
      prompt_cache_key: "conversation-1"
    });
  });

  it("keeps transport-only settings out of provider request bodies", () => {
    const options = buildProviderBodyOptions({
      ...openRouterModel(),
      providerOptions: {
        timeoutMs: 1000,
        maxRetries: 4,
        reasoningEffort: "high",
        provider: { sort: "price" }
      }
    }, undefined);

    expect(options).toEqual({
      usage: { include: true },
      provider: { sort: "price" }
    });
  });

  it("merges default headers with affinity and configured headers", () => {
    const headers = buildProviderHeaders({
      ...openRouterModel(),
      providerHeaders: { "x-custom": "yes" }
    }, {
      "content-type": "application/json"
    }, "conversation-1");

    expect(headers).toEqual({
      "user-agent": "recode/0.1.0",
      "x-session-affinity": "conversation-1",
      "content-type": "application/json",
      "x-custom": "yes"
    });
  });

  it("extracts retry and timeout controls", () => {
    const settings = buildProviderTransportSettings({
      ...openRouterModel(),
      providerOptions: {
        maxRetries: 4,
        maxRetryDelayMs: 25,
        retryInitialDelayMs: 10,
        retryMaxDelayMs: 20,
        timeoutMs: 30,
        chunkTimeoutMs: 40
      }
    });

    expect(settings).toEqual({
      maxRetries: 4,
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 20,
      maxRetryDelayMs: 25,
      timeoutMs: 30,
      chunkTimeoutMs: 40
    });
  });

  it("keeps compatibility settings out of provider request bodies", () => {
    const options = buildProviderBodyOptions({
      ...openRouterModel(),
      providerOptions: {
        compat: { maxTokensField: "max_tokens" },
        cacheRetention: "long",
        provider: { sort: "price" }
      }
    }, undefined);

    expect(options).toEqual({
      usage: { include: true },
      provider: { sort: "price" }
    });
  });
});

function openRouterModel(): AiModel {
  return {
    provider: "openai-chat",
    providerId: "openrouter",
    providerName: "OpenRouter",
    modelId: "openai/gpt-4.1-mini",
    apiKey: "test",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-chat-completions"
  };
}
