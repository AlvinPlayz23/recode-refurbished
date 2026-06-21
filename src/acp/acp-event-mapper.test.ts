/**
 * Tests for ACP session update mapping.
 */

import { describe, expect, test } from "bun:test";
import { createTools } from "../tools/create-tools.ts";
import type { SessionEvent } from "../session/session-event.ts";
import type { AcpToolKind } from "./acp-types.ts";
import { mapSessionEventToAcpNotifications, mapToolKind } from "./acp-event-mapper.ts";

describe("mapSessionEventToAcpNotifications", () => {
  test("maps assistant text deltas to agent message chunks", () => {
    const event: SessionEvent = {
      type: "assistant.text.delta",
      timestamp: 1,
      stepId: "step-1",
      delta: "hello"
    };

    expect(mapSessionEventToAcpNotifications(event, "sess-1")).toEqual([{
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
        messageId: "step-1"
      }
    }]);
  });

  test("maps assistant reasoning deltas to think tool updates", () => {
    const event: SessionEvent = {
      type: "assistant.reasoning.delta",
      timestamp: 1,
      stepId: "step-1",
      delta: "Checking context."
    };

    expect(mapSessionEventToAcpNotifications(event, "sess-1")).toEqual([
      {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "reasoning:step-1",
          title: "Thinking",
          kind: "think",
          status: "in_progress"
        }
      },
      {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "reasoning:step-1",
          status: "in_progress",
          content: [{ type: "content", content: { type: "text", text: "Checking context." } }]
        }
      }
    ]);
  });

  test("maps tool starts with kind, raw input, and locations", () => {
    const event: SessionEvent = {
      type: "tool.started",
      timestamp: 1,
      stepId: "step-1",
      toolCall: {
        id: "call-1",
        name: "Edit",
        argumentsJson: JSON.stringify({ path: "src/index.ts", oldText: "a", newText: "b" })
      }
    };

    expect(mapSessionEventToAcpNotifications(event, "sess-1")).toEqual([{
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Edit: src/index.ts",
        kind: "edit",
        status: "pending",
        rawInput: { path: "src/index.ts", oldText: "a", newText: "b" },
        locations: [{ path: "src/index.ts" }]
      }
    }]);
  });

  test("maps edit metadata to ACP diff content", () => {
    const event: SessionEvent = {
      type: "tool.completed",
      timestamp: 1,
      toolResult: {
        role: "tool",
        toolCallId: "call-1",
        toolName: "Edit",
        content: "Edited src/index.ts",
        isError: false,
        metadata: {
          kind: "edit-preview",
          path: "src/index.ts",
          oldText: "a",
          newText: "b"
        }
      }
    };

    const [notification] = mapSessionEventToAcpNotifications(event, "sess-1");
    expect(notification?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [
        {
          type: "diff",
          path: "src/index.ts",
          oldText: "a",
          newText: "b"
        },
        {
          type: "content",
          content: { type: "text", text: "Edited src/index.ts" }
        }
      ]
    });
  });
});

describe("mapToolKind", () => {
  test("maps every current Recode tool name to an ACP category", () => {
    const expectedKinds = new Map<string, AcpToolKind>([
      ["Bash", "execute"],
      ["AskUserQuestion", "think"],
      ["TodoWrite", "think"],
      ["Task", "think"],
      ["Read", "read"],
      ["Write", "edit"],
      ["Edit", "edit"],
      ["ApplyPatch", "edit"],
      ["Glob", "search"],
      ["Grep", "search"],
      ["WebFetch", "fetch"],
      ["WebSearch", "fetch"]
    ]);

    for (const tool of createTools()) {
      const expectedKind = expectedKinds.get(tool.name);
      if (expectedKind === undefined) {
        throw new Error(`Missing ACP kind expectation for tool: ${tool.name}`);
      }
      expect(mapToolKind(tool.name)).toBe(expectedKind);
    }

    expect(createTools().map((tool) => tool.name).sort()).toEqual([...expectedKinds.keys()].sort());
  });
});
