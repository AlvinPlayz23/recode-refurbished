/**
 * Provider serialization tests for continuation summaries.
 *
 * @author dev
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { ConversationMessage } from "../../transcript/message.ts";
import { streamAnthropicMessages } from "./anthropic.ts";
import { streamOpenAiChat } from "./openai-chat.ts";
import { streamOpenAiResponses } from "./openai-responses.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("continuation summary serialization", () => {
  it("serializes summary messages for OpenAI Chat", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamOpenAiChat(
      {
        provider: "openai-chat",
        providerId: "openai-chat",
        providerName: "OpenAI Chat",
        modelId: "gpt-4.1-mini",
        apiKey: "test",
        baseUrl: "https://example.com/v1",
        api: "openai-chat-completions"
      },
      "system",
      [buildSummaryMessage("Keep the file edits and pending bugfix in mind.")],
      []
    ));

    expect(requestBody?.messages).toEqual([
      { role: "system", content: "system" },
      {
        role: "user",
        content: "System-generated continuation summary:\nKeep the file edits and pending bugfix in mind."
      }
    ]);
  });

  it("preserves OpenAI-compatible tool call extra content for Gemini", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamOpenAiChat(
      {
        provider: "gemini",
        providerId: "gemini",
        providerName: "Google AI Studio",
        modelId: "gemini-3-flash-preview",
        apiKey: "test",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        api: "openai-chat-completions"
      },
      "",
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "Bash",
              argumentsJson: "{\"command\":\"echo hi\"}",
              extraContent: {
                google: {
                  thought_signature: "sig_123"
                }
              }
            }
          ]
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "Bash",
          content: "exit_code: 0",
          isError: false
        }
      ],
      []
    ));

    expect(requestBody?.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "Bash",
              arguments: "{\"command\":\"echo hi\"}"
            },
            extra_content: {
              google: {
                thought_signature: "sig_123"
              }
            }
          }
        ]
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "exit_code: 0"
      }
    ]);
  });

  it("replays DeepSeek assistant reasoning content", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamOpenAiChat(
      {
        provider: "deepseek",
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-v4-flash-free",
        apiKey: "test",
        baseUrl: "https://api.deepseek.com/v1",
        api: "openai-chat-completions"
      },
      "",
      [
        {
          role: "assistant",
          content: "",
          providerMetadata: {
            reasoningContent: "I need to call the date tool."
          },
          toolCalls: [
            {
              id: "call_1",
              name: "Bash",
              argumentsJson: "{\"command\":\"date\"}"
            }
          ]
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "Bash",
          content: "2026-05-14",
          isError: false
        }
      ],
      []
    ));

    expect(requestBody?.messages).toEqual([
      {
        role: "assistant",
        content: "",
        reasoning_content: "I need to call the date tool.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "Bash",
              arguments: "{\"command\":\"date\"}"
            }
          }
        ]
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "2026-05-14"
      }
    ]);
  });

  it("replays DeepSeek reasoning content when routed through a generic provider", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamOpenAiChat(
      {
        provider: "openai-chat",
        providerId: "zen",
        providerName: "Zen",
        modelId: "deepseek-v4-flash-free",
        apiKey: "test",
        baseUrl: "https://zen.example/v1",
        api: "openai-chat-completions"
      },
      "",
      [
        {
          role: "assistant",
          content: "",
          providerMetadata: {
            reasoningContent: "I need the current date before continuing."
          },
          toolCalls: [
            {
              id: "call_1",
              name: "Bash",
              argumentsJson: "{\"command\":\"date\"}"
            }
          ]
        }
      ],
      []
    ));

    const messages = requestBody?.messages as Array<Record<string, unknown>> | undefined;
    expect(messages?.[0]?.["reasoning_content"]).toBe("I need the current date before continuing.");
  });

  it("serializes summary messages for OpenAI Responses", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamOpenAiResponses(
      {
        provider: "openai",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-4.1",
        apiKey: "test",
        baseUrl: "https://example.com/v1",
        api: "openai-responses"
      },
      "",
      [buildSummaryMessage("Remember the architecture decisions.")],
      []
    ));

    expect(requestBody?.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "System-generated continuation summary:\nRemember the architecture decisions."
          }
        ]
      }
    ]);
  });

  it("serializes summary messages for Anthropic", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamAnthropicMessages(
      {
        provider: "anthropic",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet",
        apiKey: "test",
        baseUrl: "https://example.com/v1",
        api: "anthropic-messages"
      },
      "",
      [buildSummaryMessage("Carry over the unresolved parser issue.")],
      []
    ));

    expect(requestBody?.messages).toEqual([
      {
        role: "user",
        content: "System-generated continuation summary:\nCarry over the unresolved parser issue."
      }
    ]);
  });

  it("normalizes Anthropic empty messages and grouped tool results", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamAnthropicMessages(
      {
        provider: "anthropic",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet",
        apiKey: "test",
        baseUrl: "https://example.com/v1",
        api: "anthropic-messages"
      },
      "",
      [
        {
          role: "user",
          content: ""
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "toolu/bad+id=",
              name: "Read",
              argumentsJson: "{\"path\":\"README.md\"}"
            }
          ]
        },
        {
          role: "tool",
          toolCallId: "toolu/bad+id=",
          toolName: "Read",
          content: "one",
          isError: false
        },
        {
          role: "tool",
          toolCallId: "toolu:two",
          toolName: "Grep",
          content: "two",
          isError: true
        }
      ],
      []
    ));

    expect(requestBody?.messages).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_bad_id_",
            name: "Read",
            input: { path: "README.md" }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_bad_id_",
            content: "one",
            is_error: false
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_two",
            content: "two",
            is_error: true
          }
        ]
      }
    ]);
  });

  it("omits Anthropic eager tool streaming when compat disables it", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let requestHeaders: Headers | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    await consumeStream(streamAnthropicMessages(
      {
        provider: "anthropic",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet",
        apiKey: "test",
        baseUrl: "https://example.com/v1",
        api: "anthropic-messages",
        providerOptions: {
          compat: {
            supportsEagerToolInputStreaming: false
          }
        }
      },
      "",
      [],
      [
        {
          name: "Read",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
          },
          async execute() {
            return { content: "", isError: false };
          }
        }
      ]
    ));

    expect(requestHeaders?.get("anthropic-beta")).toContain("fine-grained-tool-streaming-2025-05-14");
    expect(requestBody?.tools).toEqual([
      {
        name: "Read",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false
        }
      }
    ]);
  });
});

function buildSummaryMessage(content: string): ConversationMessage {
  return {
    role: "summary",
    kind: "continuation",
    content
  };
}

async function consumeStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _part of stream) {
    // Intentionally empty: we only need the request body.
  }
}
