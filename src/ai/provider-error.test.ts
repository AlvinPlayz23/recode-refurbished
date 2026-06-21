/**
 * Provider error formatting tests.
 */

import { describe, expect, it } from "bun:test";
import { formatProviderError } from "./provider-error.ts";
import type { AiModel } from "./types.ts";

describe("provider error formatting", () => {
  it("explains rate-limit errors with retry guidance", () => {
    const headers = new Headers({ "retry-after": "12" });
    const error = {
      status: 429,
      headers,
      error: {
        message: "You exceeded your current quota.",
        type: "rate_limit_exceeded"
      }
    };

    expect(formatProviderError(error, testModel())).toBe(
      "OpenAI request failed for gpt-4.1: rate limited by the provider (HTTP 429). Retry after 12s. Retries were attempted when enabled; wait a moment, lower concurrency, or check quota/billing. Details: You exceeded your current quota. · rate_limit_exceeded"
    );
  });

  it("explains authentication failures", () => {
    const error = {
      status: 401,
      message: "Incorrect API key provided."
    };

    expect(formatProviderError(error, testModel())).toBe(
      "OpenAI request failed for gpt-4.1: authentication failed (HTTP 401). Check the API key configured for this provider. Details: Incorrect API key provided."
    );
  });

  it("explains connection failures", () => {
    expect(formatProviderError(new TypeError("fetch failed"), testModel())).toBe(
      "OpenAI request failed for gpt-4.1: could not reach the provider. Check your network connection, base URL, proxy, or provider status. Details: fetch failed"
    );
  });
});

function testModel(): AiModel {
  return {
    provider: "openai",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-4.1",
    apiKey: "test",
    api: "openai-responses"
  };
}
