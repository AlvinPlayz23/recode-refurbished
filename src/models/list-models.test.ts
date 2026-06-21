/**
 * Tests for model listing helpers.
 *
 * @author dev
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { fetchOpenAiCompatibleModels, listModelsForProvider } from "./list-models.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("fetchOpenAiCompatibleModels", () => {
  it("parses models from an OpenAI-compatible models endpoint", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        data: [
          { id: "gpt-4.1" },
          { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" }
        ]
      }))
    ) as unknown as typeof fetch;

    const models = await fetchOpenAiCompatibleModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test"
    });

    expect(models).toEqual([
      { id: "gpt-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" }
    ]);
  });
});

describe("listModelsForProvider", () => {
  it("falls back to configured models when refresh is disabled", async () => {
    const group = await listModelsForProvider(
      {
        id: "local",
        name: "Local Ollama",
        kind: "openai-chat",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: [{ id: "qwen3:8b" }],
        defaultModelId: "qwen3:8b"
      },
      "local",
      false
    );

    expect(group.models).toEqual([
      {
        id: "qwen3:8b",
        providerId: "local",
        providerName: "Local Ollama",
        active: true,
        source: "config"
      }
    ]);
  });
});
