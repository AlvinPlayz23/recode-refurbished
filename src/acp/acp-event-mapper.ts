/**
 * Convert Recode session events into ACP session updates.
 */

import type { SessionEvent } from "../session/session-event.ts";
import type { ToolResultMetadata } from "../tools/tool.ts";
import type { ToolCall } from "../transcript/message.ts";
import { parseToolArguments } from "../tools/tool-arguments.ts";
import type {
  AcpPlanEntry,
  AcpSessionNotification,
  AcpToolCallContent,
  AcpToolKind,
  AcpToolLocation
} from "./acp-types.ts";
import type { JsonRpcObject } from "./json-rpc.ts";

const TEXT_LIMIT = 4_000;
const REASONING_TOOL_PREFIX = "reasoning";

/** Map one normalized Recode event to zero or more ACP notifications. */
export function mapSessionEventToAcpNotifications(
  event: SessionEvent,
  sessionId: string
): readonly AcpSessionNotification[] {
  switch (event.type) {
    case "user.submitted":
      return [];
    case "assistant.text.delta":
      if (event.delta.length === 0) {
        return [];
      }
      return [{
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: event.delta },
          messageId: event.stepId
        }
      }];
    case "assistant.reasoning.delta": {
      if (event.delta.length === 0) {
        return [];
      }
      const toolCallId = reasoningToolCallId(event.stepId);
      return [
        {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: "Thinking",
            kind: "think",
            status: "in_progress"
          }
        },
        {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "in_progress",
            content: [{ type: "content", content: { type: "text", text: limitText(event.delta) } }]
          }
        }
      ];
    }
    case "tool.started":
      return [mapToolStarted(event.toolCall, sessionId)];
    case "tool.metadata.updated": {
      const content = event.update.content === undefined
        ? metadataToContent(event.update.metadata)
        : [{ type: "content" as const, content: { type: "text" as const, text: limitText(event.update.content) } }];
      return [{
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          status: "in_progress",
          ...(event.update.title === undefined ? {} : { title: event.update.title }),
          ...(content.length === 0 ? {} : { content })
        }
      }];
    }
    case "tool.completed":
    case "tool.errored": {
      const content = toolResultToContent(event.toolResult.content, event.toolResult.metadata);
      return [{
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolResult.toolCallId,
          status: event.type === "tool.errored" ? "failed" : "completed",
          rawOutput: {
            content: event.toolResult.content,
            isError: event.toolResult.isError
          },
          ...(content.length === 0 ? {} : { content })
        }
      }];
    }
    default:
      return [];
  }
}

/** Build the synthetic ACP tool call id used for streamed reasoning. */
export function reasoningToolCallId(stepId: string): string {
  return `${REASONING_TOOL_PREFIX}:${stepId}`;
}

function mapToolStarted(toolCall: ToolCall, sessionId: string): AcpSessionNotification {
  const rawInput = readToolArguments(toolCall.argumentsJson);
  const locations = rawInput === undefined ? [] : extractLocations(rawInput);
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: toolCall.id,
      title: buildToolTitle(toolCall.name, rawInput),
      kind: mapToolKind(toolCall.name),
      status: "pending",
      ...(rawInput === undefined ? {} : { rawInput }),
      ...(locations.length === 0 ? {} : { locations })
    }
  };
}

/** Map Recode tool names to ACP tool kinds. */
export function mapToolKind(toolName: string): AcpToolKind {
  switch (toolName) {
    case "Read":
      return "read";
    case "Write":
    case "Edit":
    case "ApplyPatch":
      return "edit";
    case "Glob":
    case "Grep":
      return "search";
    case "Bash":
      return "execute";
    case "TodoWrite":
    case "AskUserQuestion":
    case "Task":
      return "think";
    case "WebFetch":
    case "WebSearch":
      return "fetch";
    default:
      return "other";
  }
}

function readToolArguments(argumentsJson: string): JsonRpcObject | undefined {
  try {
    return parseToolArguments(argumentsJson);
  } catch {
    return undefined;
  }
}

function buildToolTitle(toolName: string, input: JsonRpcObject | undefined): string {
  if (input === undefined) {
    return toolName;
  }

  const subject = readString(input, "path")
    ?? readString(input, "command")
    ?? readString(input, "pattern")
    ?? readString(input, "query")
    ?? readString(input, "url");
  return subject === undefined ? toolName : `${toolName}: ${subject}`;
}

function extractLocations(input: JsonRpcObject): readonly AcpToolLocation[] {
  const locations: AcpToolLocation[] = [];
  for (const key of ["path", "oldPath", "newPath"]) {
    const path = readString(input, key);
    if (path !== undefined && !locations.some((item) => item.path === path)) {
      locations.push({ path });
    }
  }

  return locations;
}

function toolResultToContent(text: string, metadata: ToolResultMetadata | undefined): readonly AcpToolCallContent[] {
  const metadataContent = metadataToContent(metadata);
  const normalized = text.trim();
  if (normalized === "" || metadataContent.some((item) => item.type === "content" && item.content.text === normalized)) {
    return metadataContent;
  }

  return [
    ...metadataContent,
    { type: "content", content: { type: "text", text: limitText(normalized) } }
  ];
}

function metadataToContent(metadata: ToolResultMetadata | undefined): readonly AcpToolCallContent[] {
  if (metadata === undefined) {
    return [];
  }

  switch (metadata.kind) {
    case "edit-preview":
      return [{
        type: "diff",
        path: metadata.path,
        oldText: metadata.oldText,
        newText: metadata.newText
      }];
    case "bash-output":
      return [{
        type: "content",
        content: { type: "text", text: limitText(metadata.output) }
      }];
    case "todo-list":
      return [{
        type: "content",
        content: {
          type: "text",
          text: metadata.todos.map((todo) => `${todo.status}: ${todo.content}`).join("\n")
        }
      }];
    case "task-result":
      return [{
        type: "content",
        content: { type: "text", text: limitText(metadata.summary) }
      }];
  }
}

/** Convert TodoWrite metadata into ACP plan entries. */
export function todoMetadataToPlanEntries(metadata: ToolResultMetadata | undefined): readonly AcpPlanEntry[] | undefined {
  if (metadata?.kind !== "todo-list") {
    return undefined;
  }

  return metadata.todos.map((todo) => ({
    content: todo.content,
    priority: todo.priority,
    status: todo.status === "cancelled" ? "completed" : todo.status
  }));
}

function readString(input: JsonRpcObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function limitText(text: string): string {
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT - 1)}…`;
}
