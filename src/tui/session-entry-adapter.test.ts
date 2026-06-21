/**
 * Tests for projecting normalized session events into TUI transcript rows.
 */

import { describe, expect, it } from "bun:test";
import { applySessionEvent, createEmptySessionState } from "../session/session-state.ts";
import type { SessionEvent } from "../session/session-event.ts";
import { uiEntriesFromSessionState } from "./transcript/transcript-entry-state.ts";

describe("session entry adapter", () => {
  it("projects a live Bash event stream into stable TUI rows", () => {
    const events: readonly SessionEvent[] = [
      {
        type: "user.submitted",
        timestamp: 1,
        content: "run tests",
        modelContent: "run tests"
      },
      {
        type: "assistant.step.started",
        timestamp: 2,
        stepId: "step_1"
      },
      {
        type: "assistant.reasoning.delta",
        timestamp: 3,
        stepId: "step_1",
        delta: "Need to run the command."
      },
      {
        type: "assistant.text.delta",
        timestamp: 4,
        stepId: "step_1",
        delta: "I will run tests."
      },
      {
        type: "tool.started",
        timestamp: 4,
        stepId: "step_1",
        toolCall: {
          id: "call_bash",
          name: "Bash",
          argumentsJson: "{\"command\":\"bun test\"}"
        }
      },
      {
        type: "tool.metadata.updated",
        timestamp: 5,
        toolCallId: "call_bash",
        toolName: "Bash",
        update: {
          metadata: {
            kind: "bash-output",
            command: "bun test",
            output: "1 pass"
          }
        }
      },
      {
        type: "tool.completed",
        timestamp: 6,
        toolResult: {
          role: "tool",
          toolCallId: "call_bash",
          toolName: "Bash",
          content: "exit_code: 0",
          isError: false,
          metadata: {
            kind: "bash-output",
            command: "bun test",
            output: "1 pass\nexit_code: 0"
          }
        }
      },
      {
        type: "assistant.step.finished",
        timestamp: 7,
        stepId: "step_1",
        finalText: "I will run tests.",
        stepStats: {
          finishReason: "tool_calls",
          durationMs: 10,
          toolCallCount: 1
        }
      }
    ];

    const state = events.reduce(applySessionEvent, createEmptySessionState());
    const rows = uiEntriesFromSessionState(state);

    expect(rows.map((row) => [row.kind, row.body, row.toolStatus])).toEqual([
      ["user", "run tests", undefined],
      ["reasoning", "Need to run the command.", undefined],
      ["assistant", "I will run tests.", undefined],
      ["tool-preview", "Bash · bun test", "completed"]
    ]);
    expect(rows[3]?.metadata).toEqual({
      kind: "bash-output",
      command: "bun test",
      output: "1 pass\nexit_code: 0"
    });
  });

  it("projects provider retries and failed tools into status and error rows", () => {
    let state = createEmptySessionState();
    state = applySessionEvent(state, {
      type: "provider.retry",
      timestamp: 1,
      status: {
        type: "retry",
        operation: "openai-responses",
        attempt: 2,
        maxAttempts: 3
      }
    });
    state = applySessionEvent(state, {
      type: "tool.started",
      timestamp: 2,
      stepId: "step_1",
      toolCall: {
        id: "call_read",
        name: "Read",
        argumentsJson: "{\"path\":\"missing.ts\"}"
      }
    });
    state = applySessionEvent(state, {
      type: "tool.errored",
      timestamp: 3,
      toolResult: {
        role: "tool",
        toolCallId: "call_read",
        toolName: "Read",
        content: "File does not exist",
        isError: true
      }
    });

    expect(uiEntriesFromSessionState(state).map((row) => [row.kind, row.body, row.toolStatus])).toEqual([
      ["status", "Retrying provider request (2/3)", undefined],
      ["tool", "Read · missing.ts", "error"],
      ["error", "Read failed: File does not exist", "error"]
    ]);
  });
});
