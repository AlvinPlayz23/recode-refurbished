/**
 * Pure todo summary formatting helpers.
 */

import type { TodoItem } from "../../tools/tool.ts";

/**
 * Format a compact composer chip label for the current todo state.
 */
export function formatTodoChip(todos: readonly TodoItem[]): string {
  if (todos.length === 0) {
    return "Todos 0";
  }

  return `Todos ${formatTodoSummary(todos)}`;
}

/**
 * Format completed/total todo counts.
 */
export function formatTodoSummary(todos: readonly TodoItem[]): string {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return `${completed}/${todos.length}`;
}
