/**
 * TodoWrite tool implementation.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import type { TodoItem, ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "./tool.ts";

const VALID_TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const VALID_TODO_PRIORITIES = new Set(["high", "medium", "low"]);
const MAX_TODO_ITEMS = 30;
const MAX_TODO_CONTENT_LENGTH = 240;

interface TodoWriteInput {
  readonly todos: readonly TodoItem[];
}

/**
 * Create the TodoWrite tool definition.
 */
export function createTodoWriteTool(): ToolDefinition {
  return {
    name: "TodoWrite",
    description: [
      "Create or replace the current session todo list.",
      "Use this for multi-step tasks to track pending, in-progress, completed, or cancelled work.",
      "Keep items brief and update the whole list whenever progress changes."
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The complete updated todo list for the current session.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "Brief imperative description of the task, for example 'Run tests'."
              },
              activeForm: {
                type: "string",
                description: "Present-continuous form shown while active, for example 'Running tests'."
              },
              status: {
                type: "string",
                description: "Current status: pending, in_progress, completed, or cancelled."
              },
              priority: {
                type: "string",
                description: "Priority level: high, medium, or low."
              }
            },
            required: ["content", "activeForm", "status", "priority"],
            additionalProperties: false
          },
          maxItems: MAX_TODO_ITEMS
        }
      },
      required: ["todos"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseTodoWriteInput(arguments_);

      return {
        content: formatTodoWriteResult(input.todos),
        isError: false,
        metadata: {
          kind: "todo-list",
          todos: input.todos
        }
      };
    }
  };
}

/**
 * Parse and validate TodoWrite input.
 */
export function parseTodoWriteInput(arguments_: ToolArguments): TodoWriteInput {
  const todosValue = arguments_["todos"];
  if (!Array.isArray(todosValue)) {
    throw new ToolExecutionError("TodoWrite requires a 'todos' array.");
  }

  if (todosValue.length > MAX_TODO_ITEMS) {
    throw new ToolExecutionError(`TodoWrite accepts at most ${MAX_TODO_ITEMS} todo items.`);
  }

  const todos = todosValue.map(parseTodoItem);
  const activeCount = todos.filter((todo) => todo.status === "in_progress").length;
  if (activeCount > 1) {
    throw new ToolExecutionError("TodoWrite allows at most one todo item with status 'in_progress'.");
  }

  return {
    todos
  };
}

function parseTodoItem(value: unknown, index: number): TodoItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolExecutionError(`Todo item ${index + 1} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const content = readTodoContent(record["content"], index);
  const activeForm = readTodoActiveForm(record["activeForm"], index);
  const status = readTodoStatus(record["status"], index);
  const priority = readTodoPriority(record["priority"], index);

  return { content, activeForm, status, priority };
}

function readTodoContent(value: unknown, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError(`Todo item ${index + 1} requires a non-empty 'content' string.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > MAX_TODO_CONTENT_LENGTH) {
    throw new ToolExecutionError(`Todo item ${index + 1} content is too long.`);
  }

  return normalized;
}

function readTodoActiveForm(value: unknown, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError(`Todo item ${index + 1} requires a non-empty 'activeForm' string.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > MAX_TODO_CONTENT_LENGTH) {
    throw new ToolExecutionError(`Todo item ${index + 1} activeForm is too long.`);
  }

  return normalized;
}

function readTodoStatus(value: unknown, index: number): TodoItem["status"] {
  if (typeof value !== "string" || !VALID_TODO_STATUSES.has(value)) {
    throw new ToolExecutionError(`Todo item ${index + 1} status must be pending, in_progress, completed, or cancelled.`);
  }

  return value as TodoItem["status"];
}

function readTodoPriority(value: unknown, index: number): TodoItem["priority"] {
  if (typeof value !== "string" || !VALID_TODO_PRIORITIES.has(value)) {
    throw new ToolExecutionError(`Todo item ${index + 1} priority must be high, medium, or low.`);
  }

  return value as TodoItem["priority"];
}

function formatTodoWriteResult(todos: readonly TodoItem[]): string {
  if (todos.length === 0) {
    return "Updated todo list: no active todos.";
  }

  return [
    "Updated todo list:",
    ...todos.map((todo) => `- [${todo.status}] (${todo.priority}) ${todo.content}`)
  ].join("\n");
}
