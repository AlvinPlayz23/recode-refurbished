/**
 * Provider stream fixture tests.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { AiModel, AiStreamPart, ProviderStatusEvent } from "../types.ts";
import { streamAnthropicMessages } from "./anthropic.ts";
import { streamOpenAiChat } from "./openai-chat.ts";
import { streamOpenAiResponses } from "./openai-responses.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider stream fixtures", () => {
  it("parses OpenAI Responses text, tool calls, and finish usage", async () => {
    stubSseFetch([
      sse({ type: "response.reasoning_summary_text.delta", delta: "Considering. " }),
      sse({ type: "response.reasoning_text.delta", delta: "Need a file." }),
      sse({ type: "response.output_text.delta", delta: "Hello" }),
      sse({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "item_1",
          call_id: "call_1",
          name: "Read",
          arguments: "{\"path\":\"README.md\"}"
        }
      }),
      sse({
        type: "response.completed",
        response: {
          status: "completed",
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            output_tokens_details: { reasoning_tokens: 2 },
            input_tokens_details: { cached_tokens: 3 }
          }
        }
      })
    ]);

    const parts = await collectParts(streamOpenAiResponses(
      openAiResponsesModel(),
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      { type: "reasoning-delta", text: "Considering. " },
      { type: "reasoning-delta", text: "Need a file." },
      { type: "text-delta", text: "Hello" },
      {
        type: "tool-call",
        toolCallId: "call_1|item_1",
        toolName: "Read",
        input: { path: "README.md" }
      },
      {
        type: "finish-step",
        info: {
          finishReason: "completed",
          tokenUsage: {
            input: 11,
            output: 7,
            reasoning: 2,
            cacheRead: 3,
            cacheWrite: 0
          }
        }
      },
      { type: "finish" }
    ]);
  });

  it("parses OpenAI Chat streamed content and accumulated tool arguments", async () => {
    stubSseFetch([
      sse({
        choices: [
          {
            delta: { reasoning_content: "Thinking. " },
            finish_reason: null
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: { reasoning: "Still thinking." },
            finish_reason: null
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: { content: "Hello" },
            finish_reason: null
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "Read",
                    arguments: "{\"path\""
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: ":\"README.md\"}"
                  }
                }
              ]
            },
            finish_reason: "tool_calls"
          }
        ]
      }),
      "data: [DONE]\n\n"
    ]);

    const parts = await collectParts(streamOpenAiChat(
      openAiChatModel(),
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      { type: "reasoning-delta", text: "Thinking. " },
      { type: "reasoning-delta", text: "Still thinking." },
      { type: "text-delta", text: "Hello" },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "Read",
        input: { path: "README.md" }
      },
      {
        type: "finish-step",
        info: { finishReason: "tool_calls" }
      },
      { type: "finish" }
    ]);
  });

  it("parses OpenAI Chat reasoning_text deltas from compatible providers", async () => {
    stubSseFetch([
      sse({
        choices: [
          {
            delta: { reasoning_text: "Planning." },
            finish_reason: null
          }
        ]
      }),
      "data: [DONE]\n\n"
    ]);

    const parts = await collectParts(streamOpenAiChat(
      openAiChatModel(),
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      { type: "reasoning-delta", text: "Planning." },
      {
        type: "finish-step",
        info: {}
      },
      { type: "finish" }
    ]);
  });

  it("emits provider retry status when the OpenAI SDK retries a request", async () => {
    let requestCount = 0;
    const events: ProviderStatusEvent[] = [];
    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after-ms": "1"
          }
        });
      }

      return new Response(sse({
        choices: [
          {
            delta: { content: "ok" },
            finish_reason: "stop"
          }
        ]
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as unknown as typeof fetch;

    const parts = await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerOptions: {
          maxRetries: 1
        }
      },
      "",
      [],
      [],
      undefined,
      undefined,
      (event) => {
        events.push(event);
      }
    ));

    expect(requestCount).toBe(2);
    expect(events).toEqual([
      {
        type: "request-start",
        operation: "openai-chat-completions",
        attempt: 1,
        maxAttempts: 2
      },
      {
        type: "retry",
        operation: "openai-chat-completions",
        attempt: 2,
        maxAttempts: 2
      }
    ]);
    expect(parts).toContainEqual({ type: "text-delta", text: "ok" });
  });

  it("formats OpenAI SDK authentication errors for users", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: {
        message: "Incorrect API key provided.",
        type: "invalid_request_error"
      }
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    })) as unknown as typeof fetch;

    const parts = await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerOptions: {
          maxRetries: 0
        }
      },
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      {
        type: "error",
        error: "OpenAI Chat request failed for gpt-4.1: authentication failed (HTTP 401). Check the API key configured for this provider. Details: Incorrect API key provided. · invalid_request_error"
      }
    ]);
  });

  it("parses OpenAI-compatible tool calls when provider omits streamed tool indexes", async () => {
    stubSseFetch([
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: "call_1",
                  extra_content: {
                    google: {
                      thought_signature: "sig_123"
                    }
                  },
                  function: {
                    name: "Write",
                    arguments: "{\"path\":\"index.html\""
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  function: {
                    arguments: ",\"content\":\"<html></html>\"}"
                  }
                }
              ]
            },
            finish_reason: "tool_calls"
          }
        ]
      }),
      "data: [DONE]\n\n"
    ]);

    const parts = await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        provider: "gemini",
        providerId: "gemini",
        providerName: "Google AI Studio",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
      },
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "Write",
        input: {
          path: "index.html",
          content: "<html></html>"
        },
        extraContent: {
          google: {
            thought_signature: "sig_123"
          }
        }
      },
      {
        type: "finish-step",
        info: { finishReason: "tool_calls" }
      },
      { type: "finish" }
    ]);
  });

  it("adds OpenRouter low-latency routing and prompt cache affinity", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1"
      },
      "",
      [],
      [],
      undefined,
      "conversation-1"
    ));

    expect(requestBody?.usage).toEqual({ include: true });
    expect(requestBody?.provider).toEqual({ sort: "latency" });
    expect(requestBody?.prompt_cache_key).toBe("conversation-1");
  });

  it("enables DeepSeek thinking mode for OpenAI Chat-compatible requests", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/v1"
      },
      "",
      [],
      []
    ));

    expect(requestBody?.thinking).toEqual({ type: "enabled" });
  });

  it("maps chat reasoningEffort for DeepSeek, OpenRouter, Qwen, and native OpenAI", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/v1",
        providerOptions: { reasoningEffort: "high" }
      },
      "",
      [],
      []
    ));
    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        providerOptions: { reasoningEffort: "medium" }
      },
      "",
      [],
      []
    ));
    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "qwen",
        providerName: "Qwen",
        modelId: "qwen3.5-plus",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        providerOptions: { reasoningEffort: "none" }
      },
      "",
      [],
      []
    ));
    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5-mini",
        providerOptions: { reasoningEffort: "low" }
      },
      "",
      [],
      []
    ));

    expect(requestBodies[0]?.thinking).toEqual({ type: "enabled" });
    expect(requestBodies[0]?.reasoning_effort).toBe("high");
    expect(requestBodies[0]?.reasoningEffort).toBeUndefined();
    expect(requestBodies[1]?.reasoning).toEqual({ effort: "medium" });
    expect(requestBodies[1]?.reasoningEffort).toBeUndefined();
    expect(requestBodies[2]?.enable_thinking).toBe(false);
    expect(requestBodies[2]?.reasoningEffort).toBeUndefined();
    expect(requestBodies[3]?.reasoning_effort).toBe("low");
    expect(requestBodies[3]?.reasoningEffort).toBeUndefined();
  });

  it("lets chat reasoningEffort disable DeepSeek thinking mode", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/v1",
        providerOptions: { reasoningEffort: "none" }
      },
      "",
      [],
      []
    ));

    expect(requestBody?.thinking).toEqual({ type: "disabled" });
    expect(requestBody?.reasoning_effort).toBeUndefined();
    expect(requestBody?.reasoningEffort).toBeUndefined();
  });

  it("uses OpenAI Chat max_completion_tokens and SDK request controls by default", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let requestInit: RequestInit | undefined;
    const abortController = new AbortController();
    globalThis.fetch = (async (_input, init) => {
      requestInit = init;
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5-mini",
        maxOutputTokens: 1234,
        providerOptions: {
          timeoutMs: 4321,
          maxRetries: 1
        }
      },
      "",
      [],
      [],
      abortController.signal
    ));

    expect(requestBody?.max_completion_tokens).toBe(1234);
    expect(requestBody?.max_tokens).toBeUndefined();
    expect(requestBody?.store).toBe(false);
    expect(requestBody?.stream_options).toEqual({ include_usage: true });
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(requestInit?.signal?.aborted).toBe(false);
  });

  it("lets OpenAI Chat compat override max token field and tool result shape", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await collectParts(streamOpenAiChat(
      {
        ...openAiChatModel(),
        maxOutputTokens: 99,
        providerOptions: {
          compat: {
            maxTokensField: "max_tokens",
            requiresToolResultName: true,
            requiresAssistantAfterToolResult: true,
            supportsUsageInStreaming: false,
            supportsStore: false
          }
        }
      },
      "",
      [
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "Read",
          content: "ok",
          isError: false
        },
        {
          role: "user",
          content: "continue"
        }
      ],
      []
    ));

    expect(requestBody?.max_tokens).toBe(99);
    expect(requestBody?.max_completion_tokens).toBeUndefined();
    expect(requestBody?.stream_options).toBeUndefined();
    expect(requestBody?.store).toBeUndefined();
    expect(requestBody?.compat).toBeUndefined();
    expect(requestBody?.messages).toEqual([
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "ok",
        name: "Read"
      },
      {
        role: "assistant",
        content: "I have processed the tool results."
      },
      {
        role: "user",
        content: "continue"
      }
    ]);
  });

  it("parses Anthropic text, tool use blocks, and usage", async () => {
    stubSseFetch([
      sse({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 5,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1
          }
        }
      }),
      sse({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Hello"
        }
      }),
      sse({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { path: "README.md" }
        }
      }),
      sse({
        type: "content_block_stop",
        index: 1
      }),
      sse({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 9 }
      })
    ]);

    const parts = await collectParts(streamAnthropicMessages(
      anthropicModel(),
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      { type: "text-delta", text: "Hello" },
      {
        type: "tool-call",
        toolCallId: "toolu_1",
        toolName: "Read",
        input: { path: "README.md" }
      },
      {
        type: "finish-step",
        info: {
          finishReason: "tool_use",
          tokenUsage: {
            input: 8,
            output: 9,
            reasoning: 0,
            cacheRead: 2,
            cacheWrite: 1
          }
        }
      },
      { type: "finish" }
    ]);
  });

  it("parses Anthropic streamed tool arguments instead of concatenating initial input", async () => {
    stubSseFetch([
      sse({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu/bad+id=",
          name: "Write",
          input: { stale: true }
        }
      }),
      sse({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: "{\"path\":\"index.html\""
        }
      }),
      sse({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: ",\"content\":\"hi\"}"
        }
      }),
      sse({
        type: "content_block_stop",
        index: 0
      })
    ]);

    const parts = await collectParts(streamAnthropicMessages(
      anthropicModel(),
      "",
      [],
      []
    ));

    expect(parts).toEqual([
      {
        type: "tool-call",
        toolCallId: "toolu_bad_id_",
        toolName: "Write",
        input: {
          path: "index.html",
          content: "hi"
        }
      },
      { type: "finish-step", info: {} },
      { type: "finish" }
    ]);
  });
});

function stubSseFetch(events: readonly string[]): void {
  globalThis.fetch = (async () => new Response(events.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  })) as unknown as typeof fetch;
}

function sse(value: Record<string, unknown>): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

async function collectParts(stream: AsyncIterable<AiStreamPart>): Promise<readonly AiStreamPart[]> {
  const parts: AiStreamPart[] = [];

  for await (const part of stream) {
    parts.push(part);
  }

  return parts;
}

function openAiResponsesModel(): AiModel {
  return {
    provider: "openai",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-4.1",
    apiKey: "test",
    baseUrl: "https://example.com/v1",
    api: "openai-responses"
  };
}

function openAiChatModel(): AiModel {
  return {
    provider: "openai-chat",
    providerId: "openai-chat",
    providerName: "OpenAI Chat",
    modelId: "gpt-4.1",
    apiKey: "test",
    baseUrl: "https://example.com/v1",
    api: "openai-chat-completions"
  };
}

function anthropicModel(): AiModel {
  return {
    provider: "anthropic",
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-sonnet",
    apiKey: "test",
    baseUrl: "https://example.com/v1",
    api: "anthropic-messages"
  };
}
