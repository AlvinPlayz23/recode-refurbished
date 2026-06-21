/**
 * Tests for provider HTTP transport behavior.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { fetchProviderJson } from "./provider-transport.ts";
import type { AiModel } from "./types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider transport", () => {
  it("retries retryable provider responses before returning a stream", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
      }

      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as unknown as typeof fetch;

    const result = await fetchProviderJson({
      model: {
        ...model(),
        providerOptions: {
          maxRetries: 1,
          retryInitialDelayMs: 1,
          retryMaxDelayMs: 1
        }
      },
      url: "https://example.com/v1/chat/completions",
      operation: "test",
      headers: { "content-type": "application/json" },
      body: { stream: true }
    });

    expect(calls).toBe(2);
    expect(result.response.status).toBe(200);
  });

  it("does not retry non-retryable provider responses", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(fetchProviderJson({
      model: {
        ...model(),
        providerOptions: { maxRetries: 3 }
      },
      url: "https://example.com/v1/chat/completions",
      operation: "test",
      headers: { "content-type": "application/json" },
      body: { stream: true }
    })).rejects.toThrow("bad request");

    expect(calls).toBe(1);
  });
});

function model(): AiModel {
  return {
    provider: "openai-chat",
    providerId: "test",
    providerName: "Test",
    modelId: "test-model",
    apiKey: "test",
    baseUrl: "https://example.com/v1",
    api: "openai-chat-completions"
  };
}
