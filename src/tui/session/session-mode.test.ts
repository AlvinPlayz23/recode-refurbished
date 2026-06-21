/**
 * Tests for session mode helpers.
 */

import { describe, expect, it } from "bun:test";
import { filterToolsForSessionMode, getSessionModeLabel } from "./session-mode.ts";
import type { ToolDefinition } from "../../tools/tool.ts";

describe("session mode helpers", () => {
  it("returns display labels", () => {
    expect(getSessionModeLabel("build")).toBe("BUILD");
    expect(getSessionModeLabel("plan")).toBe("PLAN");
  });

  it("keeps all tools in build mode", () => {
    expect(filterToolsForSessionMode(createTools(), "build").map((tool) => tool.name)).toEqual([
      "AskUserQuestion",
      "TodoWrite",
      "Task",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch"
    ]);
  });

  it("keeps AskUserQuestion and read-only tools in plan mode", () => {
    expect(filterToolsForSessionMode(createTools(), "plan").map((tool) => tool.name)).toEqual([
      "AskUserQuestion",
      "TodoWrite",
      "Read",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch"
    ]);
  });
});

function createTools(): readonly ToolDefinition[] {
  return [
    createTool("AskUserQuestion"),
    createTool("TodoWrite"),
    createTool("Task"),
    createTool("Read"),
    createTool("Write"),
    createTool("Edit"),
    createTool("Glob"),
    createTool("Grep"),
    createTool("WebFetch"),
    createTool("WebSearch")
  ];
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    async execute() {
      return {
        content: name,
        isError: false
      };
    }
  };
}
