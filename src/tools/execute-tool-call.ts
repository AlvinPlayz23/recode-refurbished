/**
 * Tool call executor.
 *
 * @author dev
 */

import type { ToolCall, ToolResultMessage } from "../transcript/message.ts";
import type { ToolExecutionContext } from "./tool.ts";
import { checkToolApproval } from "./tool-approval-policy.ts";
import { parseToolArguments } from "./tool-arguments.ts";
import { ToolRegistry } from "./tool-registry.ts";
import {
  createToolErrorMessage,
  createToolResultMessage,
  errorToMessage
} from "./tool-result-format.ts";

/**
 * Execute one tool call and return the corresponding tool result message.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
  context: ToolExecutionContext
): Promise<ToolResultMessage> {
  const tool = registry.get(toolCall.name);

  if (tool === undefined) {
    return createToolErrorMessage(toolCall, `Unknown tool: ${toolCall.name}`);
  }

  try {
    const parsedArguments = parseToolArguments(toolCall.argumentsJson);
    const approvalResult = await checkToolApproval(toolCall.name, parsedArguments, context);
    if (approvalResult !== undefined) {
      return createToolErrorMessage(toolCall, approvalResult);
    }
    const result = await tool.execute(parsedArguments, context);

    return createToolResultMessage(toolCall, result);
  } catch (error) {
    return createToolErrorMessage(toolCall, errorToMessage(error));
  }
}
