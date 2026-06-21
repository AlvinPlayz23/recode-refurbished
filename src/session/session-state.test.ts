/**
 * Tests for normalized session event projection.
 */

import { describe, expect, it } from "bun:test";
import { applySessionEvent, createEmptySessionState } from "./session-state.ts";

describe("session state projector", () => {
  it("projects user, assistant text, tool lifecycle, metadata, and retry events", () => {
    let state = createEmptySessionState();

    state = applySessionEvent(state, {
      type: "user.submitted",
      timestamp: 1,
      content: "run tests",
      modelContent: "run tests"
    });
    state = applySessionEvent(state, {
      type: "assistant.step.started",
      timestamp: 2,
      stepId: "step_1"
    });
    state = applySessionEvent(state, {
      type: "assistant.reasoning.delta",
      timestamp: 3,
      stepId: "step_1",
      delta: "Need to inspect. "
    });
    state = applySessionEvent(state, {
      type: "assistant.text.delta",
      timestamp: 4,
      stepId: "step_1",
      delta: "I will "
    });
    state = applySessionEvent(state, {
      type: "assistant.text.delta",
      timestamp: 5,
      stepId: "step_1",
      delta: "check."
    });
    state = applySessionEvent(state, {
      type: "tool.started",
      timestamp: 5,
      stepId: "step_1",
      toolCall: {
        id: "call_1",
        name: "Bash",
        argumentsJson: "{\"command\":\"bun test\"}"
      }
    });
    state = applySessionEvent(state, {
      type: "tool.metadata.updated",
      timestamp: 6,
      toolCallId: "call_1",
      toolName: "Bash",
      update: {
        title: "bun test",
        metadata: {
          kind: "bash-output",
          command: "bun test",
          output: "1 pass"
        }
      }
    });
    state = applySessionEvent(state, {
      type: "tool.completed",
      timestamp: 7,
      toolResult: {
        role: "tool",
        toolCallId: "call_1",
        toolName: "Bash",
        content: "exit_code: 0",
        isError: false,
        metadata: {
          kind: "bash-output",
          command: "bun test",
          output: "exit_code: 0"
        }
      }
    });
    state = applySessionEvent(state, {
      type: "assistant.step.finished",
      timestamp: 8,
      stepId: "step_1",
      finalText: "I will check.",
      stepStats: {
        finishReason: "tool_calls",
        durationMs: 10,
        toolCallCount: 1
      }
    });

    expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool"]);
    expect(state.entries[1]).toMatchObject({
      kind: "assistant",
      reasoningContent: "Need to inspect. ",
      content: "I will check.",
      completed: true
    });
    expect(state.entries[2]).toMatchObject({
      kind: "tool",
      status: "completed",
      title: "bun test",
      content: "exit_code: 0"
    });
  });
});

