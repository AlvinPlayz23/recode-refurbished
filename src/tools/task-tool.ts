/**
 * Task tool for delegating work to built-in subagents.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import { isSubagentType, type SubagentTaskRequest } from "../agent/subagent.ts";
import type { ToolArguments, ToolDefinition, ToolResult } from "./tool.ts";

const MAX_SUMMARY_LENGTH = 320;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

/**
 * Parsed Task tool input.
 */
export interface TaskToolInput {
  readonly description: string;
  readonly prompt: string;
  readonly subagentType: "explore" | "general";
  readonly taskId?: string;
}

/**
 * Create the Task tool definition.
 */
export function createTaskTool(): ToolDefinition {
  return {
    name: "Task",
    description: [
      "Delegate a bounded piece of work to a named Recode subagent.",
      "Use explore for read-only code/web research.",
      "Use general for multi-step implementation work.",
      "Pass taskId to resume a prior child task."
    ].join(" "),
    inputSchema: {
      type: "object",
      required: ["description", "prompt", "subagentType"],
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "Short human-readable task summary for the transcript row."
        },
        prompt: {
          type: "string",
          description: "Detailed instructions for the subagent."
        },
        subagentType: {
          type: "string",
          description: "Subagent type: explore or general."
        },
        taskId: {
          type: "string",
          description: "Optional existing task ID to resume."
        }
      }
    },
    async execute(arguments_: ToolArguments, context): Promise<ToolResult> {
      const input = parseTaskToolInput(arguments_);
      if (context.runSubagentTask === undefined) {
        throw new ToolExecutionError("Task tool is unavailable because no subagent runtime is configured.");
      }

      const request: SubagentTaskRequest = {
        description: input.description,
        prompt: input.prompt,
        subagentType: input.subagentType,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal })
      };
      const result = await context.runSubagentTask(request);
      const summary = summarizeTaskResult(result.finalText);

      return {
        isError: false,
        content: [
          `task_id: ${result.taskId}`,
          `subagent_type: ${result.subagentType}`,
          `resumed: ${result.resumed ? "true" : "false"}`,
          "",
          "<task_result>",
          result.finalText.trim() === "" ? "(no final text)" : result.finalText.trim(),
          "</task_result>"
        ].join("\n"),
        metadata: {
          kind: "task-result",
          taskId: result.taskId,
          subagentType: result.subagentType,
          description: result.description,
          status: "completed",
          summary,
          resumed: result.resumed
        }
      };
    }
  };
}

/**
 * Parse and validate Task tool input.
 */
export function parseTaskToolInput(arguments_: ToolArguments): TaskToolInput {
  const description = readRequiredString(arguments_, "description");
  const prompt = readRequiredString(arguments_, "prompt");
  const subagentTypeValue = readRequiredString(arguments_, "subagentType");

  if (!isSubagentType(subagentTypeValue)) {
    throw new ToolExecutionError("subagentType must be either explore or general.");
  }

  const taskId = readOptionalTaskId(arguments_, "taskId");

  return {
    description,
    prompt,
    subagentType: subagentTypeValue,
    ...(taskId === undefined ? {} : { taskId })
  };
}

function readRequiredString(arguments_: ToolArguments, key: string): string {
  const value = arguments_[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError(`${key} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalTaskId(arguments_: ToolArguments, key: string): string | undefined {
  const value = arguments_[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError("taskId must be a non-empty string when provided.");
  }

  const trimmed = value.trim();
  if (!TASK_ID_PATTERN.test(trimmed)) {
    throw new ToolExecutionError("taskId may only contain letters, numbers, underscore, dash, colon, and dot.");
  }

  return trimmed;
}

function summarizeTaskResult(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    return "(no final text)";
  }

  return normalized.length <= MAX_SUMMARY_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
