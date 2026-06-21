/**
 * Tests for prompt-turn session projection.
 */

import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "../../session/session-event.ts";
import type { UiEntry } from "../transcript/transcript-entry-state.ts";
import type { SpinnerPhase } from "../appearance/spinner.ts";
import { createPromptTurnSession } from "./prompt-turn-session.ts";

describe("prompt turn session", () => {
  test("projects session events and updates busy/provider state", () => {
    let entries: readonly UiEntry[] = [];
    let sessionEvents: readonly SessionEvent[] = [];
    let busyPhase: SpinnerPhase = "thinking";
    let providerStatusText: string | undefined;
    let invalidatedWorkspace: string | undefined;
    let fileSuggestionBumps = 0;

    const turn = createPromptTurnSession({
      baseEntries: [],
      baseSessionEvents: [],
      workspaceRoot: "/workspace",
      setEntries(setter) {
        entries = setter(entries);
      },
      setSessionEvents(value) {
        sessionEvents = value;
      },
      setBusyPhase(value) {
        busyPhase = value;
      },
      getBusyPhase() {
        return busyPhase;
      },
      setProviderStatusText(value) {
        providerStatusText = value;
      },
      invalidateWorkspaceFileSuggestions(workspaceRoot) {
        invalidatedWorkspace = workspaceRoot;
      },
      bumpFileSuggestionVersion() {
        fileSuggestionBumps += 1;
      },
      setTodos() {},
      closeTodoDropup() {},
      setTranscriptMessages() {},
      setLastContextEstimate() {}
    });

    turn.handleSessionEvent({
      type: "provider.retry",
      timestamp: 1,
      status: {
        type: "retry",
        operation: "openai-chat-completions",
        attempt: 1,
        maxAttempts: 3
      }
    });
    expect(busyPhase as string).toBe("retrying");
    expect(providerStatusText).toBe("retry 1/3");

    turn.handleSessionEvent({
      type: "assistant.step.started",
      timestamp: 2,
      stepId: "step"
    });
    turn.handleSessionEvent({
      type: "assistant.text.delta",
      timestamp: 3,
      stepId: "step",
      delta: "hello"
    });
    expect(busyPhase as string).toBe("thinking");
    expect(providerStatusText).toBeUndefined();
    expect(entries.some((entry) => entry.kind === "assistant" && entry.body === "hello")).toBe(true);

    turn.handleSessionEvent({
      type: "tool.completed",
      timestamp: 4,
      toolResult: {
        role: "tool",
        toolCallId: "todo",
        toolName: "TodoWrite",
        content: "updated",
        isError: false,
        metadata: {
          kind: "todo-list",
          todos: []
        }
      }
    });
    expect(invalidatedWorkspace).toBe("/workspace");
    expect(fileSuggestionBumps).toBe(1);
    expect(sessionEvents).toHaveLength(4);
    expect(turn.getAllSessionEvents()).toHaveLength(4);
  });

  test("builds a partial transcript snapshot from projected assistant text", () => {
    const turn = createPromptTurnSession({
      baseEntries: [],
      baseSessionEvents: [],
      workspaceRoot: "/workspace",
      setEntries() {},
      setSessionEvents() {},
      setBusyPhase() {},
      getBusyPhase() {
        return "thinking";
      },
      setProviderStatusText() {},
      invalidateWorkspaceFileSuggestions() {},
      bumpFileSuggestionVersion() {},
      setTodos() {},
      closeTodoDropup() {},
      setTranscriptMessages() {},
      setLastContextEstimate() {}
    });

    turn.handleSessionEvent({
      type: "assistant.step.started",
      timestamp: 1,
      stepId: "step"
    });
    turn.handleSessionEvent({
      type: "assistant.text.delta",
      timestamp: 2,
      stepId: "step",
      delta: "partial"
    });

    expect(turn.buildTranscriptSnapshot()).toEqual([
      {
        role: "assistant",
        content: "partial",
        toolCalls: []
      }
    ]);
  });

  test("compacts high-frequency stream events for persisted session history", () => {
    let sessionEvents: readonly SessionEvent[] = [];
    const turn = createPromptTurnSession({
      baseEntries: [],
      baseSessionEvents: [],
      workspaceRoot: "/workspace",
      setEntries() {},
      setSessionEvents(value) {
        sessionEvents = value;
      },
      setBusyPhase() {},
      getBusyPhase() {
        return "thinking";
      },
      setProviderStatusText() {},
      invalidateWorkspaceFileSuggestions() {},
      bumpFileSuggestionVersion() {},
      setTodos() {},
      closeTodoDropup() {},
      setTranscriptMessages() {},
      setLastContextEstimate() {}
    });

    turn.handleSessionEvent({ type: "assistant.step.started", timestamp: 1, stepId: "step" });
    turn.handleSessionEvent({ type: "assistant.text.delta", timestamp: 2, stepId: "step", delta: "hel" });
    turn.handleSessionEvent({ type: "assistant.text.delta", timestamp: 3, stepId: "step", delta: "lo" });
    turn.handleSessionEvent({
      type: "tool.metadata.updated",
      timestamp: 4,
      toolCallId: "bash",
      toolName: "Bash",
      update: { metadata: { kind: "bash-output", command: "cmd", output: "first" } }
    });
    turn.handleSessionEvent({
      type: "tool.metadata.updated",
      timestamp: 5,
      toolCallId: "bash",
      toolName: "Bash",
      update: { metadata: { kind: "bash-output", command: "cmd", output: "second" } }
    });

    expect(sessionEvents).toHaveLength(3);
    expect(sessionEvents[1]).toMatchObject({
      type: "assistant.text.delta",
      delta: "hello"
    });
    expect(sessionEvents[2]).toMatchObject({
      type: "tool.metadata.updated",
      update: { metadata: { kind: "bash-output", output: "second" } }
    });
  });
});
