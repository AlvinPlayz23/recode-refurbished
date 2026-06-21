/**
 * Tool argument JSON parsing.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import { isRecord } from "../shared/is-record.ts";
import type { ToolArguments } from "./tool.ts";

/**
 * Parse a tool call argument JSON string into a validated object.
 */
export function parseToolArguments(argumentsJson: string): ToolArguments {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(argumentsJson);
  } catch (error) {
    throw new ToolExecutionError("Tool arguments must be valid JSON.", { cause: error });
  }

  if (!isRecord(parsedValue)) {
    throw new ToolExecutionError("Tool arguments must decode to a JSON object.");
  }

  return parsedValue;
}
