/**
 * Tests for live subagent chat view helpers.
 */

import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "../transcript/message.ts";
import {
  appendLiveSubagentTextDelta,
  appendLiveSubagentToolCall,
  appendLiveSubagentToolResult,
  applyLiveSubagentTranscriptUpdate,
  createLiveSubagentTask,
  createLiveSubagentTasksFromRecords,
  cycleChatView
} from "./subagent-view.ts";
import type { LiveSubagentTask } from "./subagent-view.ts";

describe("subagent view helpers", () => {
  it("cycles parent and subagents in creation order", () => {
    const tasks = [
      createTask("task_1", "First"),
      createTask("task_2", "Second")
    ];

    expect(cycleChatView({ kind: "parent" }, tasks)).toEqual({ kind: "subagent", taskId: "task_1" });
    expect(cycleChatView({ kind: "subagent", taskId: "task_1" }, tasks)).toEqual({ kind: "subagent", taskId: "task_2" });
    expect(cycleChatView({ kind: "subagent", taskId: "task_2" }, tasks)).toEqual({ kind: "parent" });
    expect(cycleChatView({ kind: "subagent", taskId: "missing" }, tasks)).toEqual({ kind: "parent" });
  });

  it("creates completed live tasks from saved records", () => {
    const tasks = createLiveSubagentTasksFromRecords([
      {
        id: "task_1",
        subagentType: "explore",
        description: "Inspect routing",
        prompt: "Inspect routing",
        transcript: [{ role: "user", content: "Inspect routing" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        providerId: "test-provider",
        providerName: "Test Provider",
        model: "test-model",
        status: "completed"
      }
    ]);

    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["user", "Inspect routing"]
    ]);
  });

  it("renders child transcript updates and live streaming activity", () => {
    let tasks: readonly LiveSubagentTask[] = [createTask("task_1", "Inspect routing")];

    tasks = applyLiveSubagentTranscriptUpdate(tasks, "task_1", [
      { role: "user", content: "Inspect routing" }
    ]);
    expect(tasks[0]?.entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["user", "Inspect routing"]
    ]);

    tasks = appendLiveSubagentTextDelta(tasks, "task_1", "Reading");
    tasks = appendLiveSubagentTextDelta(tasks, "task_1", " files");
    expect(tasks[0]?.streamingBody).toBe("Reading files");

    tasks = appendLiveSubagentToolCall(tasks, "task_1", {
      id: "call_read",
      name: "Read",
      argumentsJson: JSON.stringify({ path: "src/index.ts" })
    });
    expect(tasks[0]?.entries.map((entry) => entry.body)).toContain("Read · src/index.ts");

    const result: ToolResultMessage = {
      role: "tool",
      toolCallId: "call_read",
      toolName: "Read",
      content: "file contents",
      isError: true
    };
    tasks = appendLiveSubagentToolResult(tasks, "task_1", result);
    expect(tasks[0]?.entries.at(-1)?.kind).toBe("error");
    expect(tasks[0]?.entries.at(-1)?.body).toContain("Read failed");
  });
});

function createTask(id: string, description: string) {
  return createLiveSubagentTask({
    id,
    subagentType: "explore",
    description,
    prompt: description,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "test-provider",
    providerName: "Test Provider",
    model: "test-model",
    status: "running"
  });
}
