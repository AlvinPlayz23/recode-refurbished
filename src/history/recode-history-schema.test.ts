/**
 * Direct tests for persisted history JSON schema parsing.
 */

import { describe, expect, it } from "bun:test";
import {
  conversationToMeta,
  createEmptyHistoryIndex,
  parseConversationRecord,
  parseHistoryIndex
} from "./recode-history-schema.ts";
import type { SavedConversationRecord } from "./recode-history-types.ts";

describe("recode history schema", () => {
  it("returns an empty index for non-object input", () => {
    expect(parseHistoryIndex("nope")).toEqual(createEmptyHistoryIndex());
  });

  it("parses step stats with token usage", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "assistant",
          content: "Done.",
          toolCalls: [],
          stepStats: {
            finishReason: "stop",
            durationMs: 12.8,
            toolCallCount: 0,
            costUsd: 0.01,
            tokenUsage: {
              input: 10,
              output: 20,
              reasoning: 3,
              cacheRead: 4,
              cacheWrite: 5
            }
          }
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "assistant",
      content: "Done.",
      toolCalls: [],
      stepStats: {
        finishReason: "stop",
        durationMs: 12,
        toolCallCount: 0,
        costUsd: 0.01,
        tokenUsage: {
          input: 10,
          output: 20,
          reasoning: 3,
          cacheRead: 4,
          cacheWrite: 5
        }
      }
    });
  });

  it("drops invalid token usage while keeping valid step stats", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "assistant",
          content: "Done.",
          toolCalls: [],
          stepStats: {
            finishReason: "tool_calls",
            durationMs: 20,
            toolCallCount: 1,
            tokenUsage: {
              input: 10,
              output: "bad",
              reasoning: 0,
              cacheRead: 0,
              cacheWrite: 0
            }
          }
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "assistant",
      content: "Done.",
      toolCalls: [],
      stepStats: {
        finishReason: "tool_calls",
        durationMs: 20,
        toolCallCount: 1
      }
    });
  });

  it("preserves provider-specific tool call extra content", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "Bash",
              argumentsJson: "{\"command\":\"echo hi\"}",
              extraContent: {
                google: {
                  thought_signature: "sig_123"
                }
              }
            }
          ]
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          name: "Bash",
          argumentsJson: "{\"command\":\"echo hi\"}",
          extraContent: {
            google: {
              thought_signature: "sig_123"
            }
          }
        }
      ]
    });
  });

  it("preserves assistant provider metadata", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "assistant",
          content: "",
          providerMetadata: {
            reasoningContent: "I should call a tool."
          },
          toolCalls: []
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "assistant",
      content: "",
      providerMetadata: {
        reasoningContent: "I should call a tool."
      },
      toolCalls: []
    });
  });

  it("parses edit-preview tool result metadata", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "Edit",
          content: "Edited file: src/index.ts",
          isError: false,
          metadata: {
            kind: "edit-preview",
            path: "src/index.ts",
            oldText: "old",
            newText: "new",
            replacementCount: 2
          }
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "Edit",
      content: "Edited file: src/index.ts",
      isError: false,
      metadata: {
        kind: "edit-preview",
        path: "src/index.ts",
        oldText: "old",
        newText: "new",
        replacementCount: 2
      }
    });
  });

  it("parses todo-list tool result metadata", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "TodoWrite",
          content: "Updated todo list",
          isError: false,
          metadata: {
            kind: "todo-list",
            todos: [
              { content: "Inspect code", activeForm: "Inspecting code", status: "completed", priority: "medium" },
              { content: "Add tests", activeForm: "Adding tests", status: "in_progress", priority: "high" },
              { content: "", activeForm: "Waiting", status: "pending", priority: "low" },
              { content: "Bad status", activeForm: "Bad status", status: "started", priority: "low" },
              { content: "Missing active form", status: "pending", priority: "low" }
            ]
          }
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "TodoWrite",
      content: "Updated todo list",
      isError: false,
      metadata: {
        kind: "todo-list",
        todos: [
          { content: "Inspect code", activeForm: "Inspecting code", status: "completed", priority: "medium" },
          { content: "Add tests", activeForm: "Adding tests", status: "in_progress", priority: "high" }
        ]
      }
    });
  });

  it("parses task-result metadata and embedded subagent task records", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        {
          role: "tool",
          toolCallId: "call_task",
          toolName: "Task",
          content: "task_id: task_1",
          isError: false,
          metadata: {
            kind: "task-result",
            taskId: "task_1",
            subagentType: "explore",
            description: "Inspect routing",
            status: "completed",
            summary: "Routing lives in src/routes.ts.",
            resumed: false
          }
        }
      ],
      subagentTasks: [
        {
          id: "task_1",
          subagentType: "explore",
          description: "Inspect routing",
          prompt: "Find routing.",
          transcript: [{ role: "user", content: "Find routing." }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          providerId: "openai",
          providerName: "OpenAI",
          model: "gpt-4.1",
          status: "completed"
        }
      ]
    });

    expect(record?.transcript[0]).toEqual({
      role: "tool",
      toolCallId: "call_task",
      toolName: "Task",
      content: "task_id: task_1",
      isError: false,
      metadata: {
        kind: "task-result",
        taskId: "task_1",
        subagentType: "explore",
        description: "Inspect routing",
        status: "completed",
        summary: "Routing lives in src/routes.ts.",
        resumed: false
      }
    });
    expect(record?.subagentTasks?.[0]?.id).toBe("task_1");
    expect(record?.subagentTasks?.[0]?.transcript).toEqual([{ role: "user", content: "Find routing." }]);
  });

  it("keeps continuation summaries and rejects malformed summary messages", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [
        { role: "summary", kind: "continuation", content: "Earlier context." },
        { role: "summary", kind: "other", content: "Skip me." }
      ]
    });

    expect(record?.transcript).toEqual([
      { role: "summary", kind: "continuation", content: "Earlier context." }
    ]);
  });

  it("parses compaction session snapshots", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [{ role: "summary", kind: "continuation", content: "Current summary." }],
      sessionSnapshots: [
        {
          kind: "compaction",
          id: "snapshot-1",
          createdAt: "2026-01-01T00:00:01.000Z",
          reason: "manual",
          compactedMessageCount: 2,
          summary: "Earlier context.",
          beforeTranscript: [
            { role: "user", content: "Start" },
            { role: "assistant", content: "Done", toolCalls: [] }
          ],
          afterTranscript: [
            { role: "summary", kind: "continuation", content: "Earlier context." }
          ]
        }
      ]
    });

    expect(record?.sessionSnapshots).toEqual([
      {
        kind: "compaction",
        id: "snapshot-1",
        createdAt: "2026-01-01T00:00:01.000Z",
        reason: "manual",
        compactedMessageCount: 2,
        summary: "Earlier context.",
        beforeTranscript: [
          { role: "user", content: "Start" },
          { role: "assistant", content: "Done", toolCalls: [] }
        ],
        afterTranscript: [
          { role: "summary", kind: "continuation", content: "Earlier context." }
        ]
      }
    ]);
  });

  it("parses persisted session events", () => {
    const record = parseConversationRecord({
      ...baseConversationMeta(),
      transcript: [{ role: "user", content: "Hello" }],
      sessionEvents: [
        {
          type: "user.submitted",
          timestamp: 1,
          content: "Hello",
          modelContent: "Hello"
        },
        {
          type: "assistant.reasoning.delta",
          timestamp: 2,
          stepId: "step-1",
          delta: "Thinking"
        },
        {
          type: "assistant.text.delta",
          timestamp: 3,
          stepId: "step-1",
          delta: "Hi"
        },
        {
          type: "unknown",
          timestamp: 3
        }
      ]
    });

    expect(record?.sessionEvents).toEqual([
      {
        type: "user.submitted",
        timestamp: 1,
        content: "Hello",
        modelContent: "Hello"
      },
      {
        type: "assistant.reasoning.delta",
        timestamp: 2,
        stepId: "step-1",
        delta: "Thinking"
      },
      {
        type: "assistant.text.delta",
        timestamp: 3,
        stepId: "step-1",
        delta: "Hi"
      }
    ]);
  });

  it("converts conversation records to index metadata", () => {
    const record: SavedConversationRecord = {
      ...baseConversationMeta(),
      transcript: [{ role: "user", content: "hi" }]
    };

    expect(conversationToMeta(record)).toEqual(baseConversationMeta());
  });
});

function baseConversationMeta(): Omit<SavedConversationRecord, "transcript"> {
  return {
    id: "conversation-1",
    title: "Title",
    preview: "Preview",
    workspaceRoot: "/workspace",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "openai",
    providerName: "OpenAI",
    model: "gpt-4.1",
    mode: "build",
    messageCount: 1
  };
}
