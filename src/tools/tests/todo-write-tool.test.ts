/**
 * Tests for the TodoWrite tool.
 */

import { describe, expect, it } from "bun:test";
import { ToolExecutionError } from "../../errors/recode-error.ts";
import { createTodoWriteTool, parseTodoWriteInput } from "../todo-write-tool.ts";

describe("TodoWrite tool", () => {
  it("rejects malformed todo lists", () => {
    expect(() => parseTodoWriteInput({})).toThrow(ToolExecutionError);
    expect(() => parseTodoWriteInput({ todos: [{ content: "", activeForm: "Doing it", status: "pending", priority: "high" }] })).toThrow(ToolExecutionError);
    expect(() => parseTodoWriteInput({ todos: [{ content: "Do it", activeForm: "", status: "pending", priority: "high" }] })).toThrow(ToolExecutionError);
    expect(() => parseTodoWriteInput({ todos: [{ content: "Do it", activeForm: "Doing it", status: "started", priority: "high" }] })).toThrow(ToolExecutionError);
    expect(() => parseTodoWriteInput({ todos: [{ content: "Do it", activeForm: "Doing it", status: "pending", priority: "urgent" }] })).toThrow(ToolExecutionError);
    expect(() => parseTodoWriteInput({
      todos: [
        { content: "One", activeForm: "Doing one", status: "in_progress", priority: "high" },
        { content: "Two", activeForm: "Doing two", status: "in_progress", priority: "medium" }
      ]
    })).toThrow(ToolExecutionError);
  });

  it("returns normalized todos as result metadata", async () => {
    const tool = createTodoWriteTool();
    const result = await tool.execute(
      {
        todos: [
          { content: "  Inspect   files  ", activeForm: " Inspecting  files ", status: "completed", priority: "medium" },
          { content: "Add tests", activeForm: "Adding tests", status: "in_progress", priority: "high" }
        ]
      },
      { workspaceRoot: "/workspace" }
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Updated todo list:");
    expect(result.metadata).toEqual({
      kind: "todo-list",
      todos: [
        { content: "Inspect files", activeForm: "Inspecting files", status: "completed", priority: "medium" },
        { content: "Add tests", activeForm: "Adding tests", status: "in_progress", priority: "high" }
      ]
    });
  });
});
