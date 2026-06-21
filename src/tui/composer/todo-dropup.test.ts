/**
 * Tests for composer todo dropup helpers.
 */

import { describe, expect, it } from "bun:test";
import type { TodoItem } from "../../tools/tool.ts";
import { formatTodoChip, formatTodoSummary } from "./todo-summary.ts";

describe("todo dropup helpers", () => {
  it("formats completed and total todo counts", () => {
    const todos: readonly TodoItem[] = [
      { content: "Done", activeForm: "Doing done", status: "completed", priority: "low" },
      { content: "Active", activeForm: "Doing active", status: "in_progress", priority: "high" },
      { content: "Pending", activeForm: "Doing pending", status: "pending", priority: "medium" }
    ];

    expect(formatTodoSummary(todos)).toBe("1/3");
    expect(formatTodoChip(todos)).toBe("Todos 1/3");
  });

  it("handles an empty todo chip", () => {
    expect(formatTodoChip([])).toBe("Todos 0");
  });
});
