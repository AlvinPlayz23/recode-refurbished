/**
 * Tests for the Task subagent delegation tool.
 */

import { describe, expect, it } from "bun:test";
import { createTaskTool, parseTaskToolInput } from "../task-tool.ts";

describe("Task tool", () => {
  it("parses valid Task input", () => {
    expect(parseTaskToolInput({
      description: "Inspect auth",
      prompt: "Find the auth entrypoint.",
      subagentType: "explore",
      taskId: "task_123"
    })).toEqual({
      description: "Inspect auth",
      prompt: "Find the auth entrypoint.",
      subagentType: "explore",
      taskId: "task_123"
    });
  });

  it("rejects unknown subagent types and invalid task IDs", () => {
    expect(() => parseTaskToolInput({
      description: "Bad",
      prompt: "Bad",
      subagentType: "writer"
    })).toThrow("subagentType must be either explore or general");

    expect(() => parseTaskToolInput({
      description: "Bad",
      prompt: "Bad",
      subagentType: "general",
      taskId: "../escape"
    })).toThrow("taskId may only contain");
  });

  it("returns task id and compact metadata from the subagent runtime", async () => {
    const tool = createTaskTool();
    const result = await tool.execute({
      description: "Summarize tests",
      prompt: "Read tests and summarize.",
      subagentType: "explore"
    }, {
      workspaceRoot: "/workspace",
      async runSubagentTask(request) {
        return {
          taskId: "task_abc",
          subagentType: request.subagentType,
          description: request.description,
          finalText: "Found focused tests.",
          transcript: [],
          resumed: false,
          providerId: "openai",
          providerName: "OpenAI",
          model: "gpt-test"
        };
      }
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("task_id: task_abc");
    expect(result.content).toContain("<task_result>");
    expect(result.metadata).toEqual({
      kind: "task-result",
      taskId: "task_abc",
      subagentType: "explore",
      description: "Summarize tests",
      status: "completed",
      summary: "Found focused tests.",
      resumed: false
    });
  });

  it("fails clearly when no subagent runtime is configured", async () => {
    await expect(createTaskTool().execute({
      description: "No runtime",
      prompt: "Try to run.",
      subagentType: "general"
    }, {
      workspaceRoot: "/workspace"
    })).rejects.toThrow("no subagent runtime is configured");
  });
});
