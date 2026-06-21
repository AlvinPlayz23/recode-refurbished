/**
 * Tool result message formatting.
 */

import type { ToolCall, ToolResultMessage } from "../transcript/message.ts";
import type { ToolResult } from "./tool.ts";

/**
 * Convert a successful tool execution result into a transcript message.
 */
export function createToolResultMessage(
  toolCall: ToolCall,
  result: ToolResult
): ToolResultMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    isError: result.isError,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata })
  };
}

/**
 * Convert a tool execution failure into a transcript message.
 */
export function createToolErrorMessage(toolCall: ToolCall, message: string): ToolResultMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: formatToolFailureContent(toolCall.name, message),
    isError: true
  };
}

/**
 * Normalize an unknown thrown value into user-facing text.
 */
export function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function formatToolFailureContent(toolName: string, message: string): string {
  const hint = getToolFailureRecoveryHint(toolName, message);
  const base = `Tool execution failed: ${message}`;

  return hint === undefined ? base : `${base}\n\nRecovery hint: ${hint}`;
}

function getToolFailureRecoveryHint(toolName: string, message: string): string | undefined {
  if (message.includes("denied by user")) {
    return undefined;
  }

  switch (toolName) {
    case "ApplyPatch":
      return [
        message.includes("hunk target")
          ? "Read the target file again before retrying; the file content may have changed or your context may be stale."
          : "Retry with a Begin Patch/End Patch envelope.",
        "Use headers like '*** Update File: path'.",
        "Prefix hunk lines with ' ', '+', or '-'.",
        "Include a smaller unique context block that matches the freshly read file."
      ].join(" ");
    case "Edit":
      return message.includes("exactly once") || message.includes("not found")
        ? "Read the file again, then retry with an oldText block that matches exactly and is unique. Include a few nearby lines if the target is ambiguous."
        : "Retry with a valid path plus oldText/newText strings. Use Write for a full file rewrite.";
    case "Write":
      return "Retry with a workspace-relative path and the full intended file content.";
    case "Read":
      return "Check the path with Glob or Grep, then retry with a workspace-relative path.";
    case "Glob":
      return "Retry with a non-empty pattern and, if needed, a narrower workspace-relative path.";
    case "Grep":
      return "Retry with a valid regular expression and an existing file or directory path. Use outputMode 'files_with_matches' for broad searches.";
    case "WebFetch":
      return "Retry with a public http:// or https:// URL. For binary or very large pages, use WebSearch or request a text/html source instead.";
    case "WebSearch":
      return "Retry with a more specific query, fewer results, or livecrawl 'fallback'. If Exa reports auth or quota issues, check RECODE_EXA_API_KEY or EXA_API_KEY.";
    case "Bash":
      return "For read-only shell commands, simplify the command and keep paths inside the workspace. For edits, prefer Edit, Write, or ApplyPatch.";
    case "AskUserQuestion":
      return "Retry with 1-4 questions, each with non-empty options and short labels.";
    case "TodoWrite":
      return "Retry with a todos array. Each item needs content, activeForm, status, and priority. Use at most one in_progress item.";
    case "Task":
      return "Retry with description, prompt, and subagentType set to explore or general. Use the returned task_id only when resuming an existing child task.";
    default:
      return undefined;
  }
}
