/**
 * Internal entrypoint for streaming assistant responses.
 */

import { streamAnthropicMessages } from "./providers/anthropic.ts";
import { streamOpenAiChat } from "./providers/openai-chat.ts";
import { streamOpenAiResponses } from "./providers/openai-responses.ts";
import type { AiResponseStream, StreamAssistantResponseOptions } from "./types.ts";

/**
 * Stream one assistant turn through the active provider adapter.
 */
export function streamAssistantResponse(options: StreamAssistantResponseOptions): AiResponseStream {
  switch (options.model.api) {
    case "openai-responses":
      return {
        fullStream: streamOpenAiResponses(
          options.model,
          options.systemPrompt,
          options.messages,
          options.tools,
          options.abortSignal,
          options.requestAffinityKey,
          options.onProviderStatus
        )
      };
    case "openai-chat-completions":
      return {
        fullStream: streamOpenAiChat(
          options.model,
          options.systemPrompt,
          options.messages,
          options.tools,
          options.abortSignal,
          options.requestAffinityKey,
          options.onProviderStatus
        )
      };
    case "anthropic-messages":
      return {
        fullStream: streamAnthropicMessages(
          options.model,
          options.systemPrompt,
          options.messages,
          options.tools,
          options.abortSignal,
          options.requestAffinityKey,
          options.onProviderStatus
        )
      };
  }
}
