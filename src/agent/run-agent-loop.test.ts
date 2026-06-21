/**
 * Main agent loop tests.
 *
 * @author Zhenxin
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { ConversationMessage } from "../transcript/message.ts";
import type { AiResponseStream } from "../ai/types.ts";
import type { ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "../tools/tool.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";

type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, string> }
  | { type: "error"; error: unknown }
  | { type: "abort" }
  | { type: "finish-step"; info?: { finishReason?: string } }
  | { type: "finish" };

const fakeStreamAssistantResponse = mock<(options: Record<string, unknown>) => AiResponseStream>();

mock.module("../ai/stream-assistant-response.ts", () => ({
  streamAssistantResponse: fakeStreamAssistantResponse
}));

const { runAgentLoop } = await import("./run-agent-loop.ts");

async function* yieldParts(parts: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const part of parts) {
    yield part;
  }
}

function makeStreamResult(parts: StreamPart[]): { fullStream: AsyncIterable<StreamPart> } {
  return { fullStream: yieldParts(parts) };
}

function textPart(text: string): StreamPart {
  return { type: "text-delta", text };
}

function toolCallPart(toolCallId: string, toolName: string, input: Record<string, string>): StreamPart {
  return { type: "tool-call", toolCallId, toolName, input };
}

function finishParts(): StreamPart[] {
  return [{ type: "finish-step" }, { type: "finish" }];
}

describe("runAgentLoop", () => {
  beforeEach(() => {
    fakeStreamAssistantResponse.mockClear();
  });

  it("executes tool calls until the assistant returns final text", async () => {
    const capturedRequests: Array<{ messages: unknown[] }> = [];

    fakeStreamAssistantResponse
      .mockImplementationOnce((options) => {
        capturedRequests.push({ messages: JSON.parse(JSON.stringify(options.messages as unknown[])) as unknown[] });
        return makeStreamResult([
          toolCallPart("call_1", "echo_tool", { text: "hello" }),
          ...finishParts()
        ]);
      })
      .mockImplementationOnce((options) => {
        capturedRequests.push({ messages: JSON.parse(JSON.stringify(options.messages as unknown[])) as unknown[] });
        return makeStreamResult([
          textPart("done"),
          ...finishParts()
        ]);
      });

    const registry = new ToolRegistry([createEchoTool()]);
    const result = await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "Say hello",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
    });

    expect(result.finalText).toBe("done");
    expect(result.steps).toHaveLength(2);
    expect(capturedRequests).toHaveLength(2);

    const toolMessage = (capturedRequests[1]?.messages as Array<Record<string, unknown>>).find((m) => m.role === "tool");

    expect(toolMessage).toEqual({
      role: "tool",
      toolCallId: "call_1",
      toolName: "echo_tool",
      content: "echo: hello",
      isError: false
    });
  });

  it("appends previous messages before the new user prompt", async () => {
    const capturedRequests: Array<{ messages: unknown[] }> = [];

    fakeStreamAssistantResponse.mockImplementationOnce((options) => {
      capturedRequests.push({ messages: JSON.parse(JSON.stringify(options.messages as unknown[])) as unknown[] });
      return makeStreamResult([
        textPart("continued"),
        ...finishParts()
      ]);
    });

    const registry = new ToolRegistry([createEchoTool()]);
    await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "next turn",
      previousMessages: [
        { role: "user", content: "first turn" },
        { role: "assistant", content: "first reply", toolCalls: [] }
      ],
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    });

    expect(capturedRequests[0]?.messages).toEqual([
      { role: "user", content: "first turn" },
      { role: "assistant", content: "first reply", toolCalls: [] },
      { role: "user", content: "next turn" }
    ]);
  });

  it("can send a synthetic model prompt while publishing the public user prompt", async () => {
    const capturedRequests: Array<{ messages: unknown[] }> = [];
    const updates: ConversationMessage[][] = [];

    fakeStreamAssistantResponse.mockImplementationOnce((options) => {
      capturedRequests.push({ messages: JSON.parse(JSON.stringify(options.messages as unknown[])) as unknown[] });
      return makeStreamResult([
        textPart("planned"),
        ...finishParts()
      ]);
    });

    const result = await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "create a page",
      initialModelUserPrompt: "<system-reminder>plan mode</system-reminder>\n\ncreate a page",
      languageModel: {} as never,
      toolRegistry: new ToolRegistry([createEchoTool()]),
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onTranscriptUpdate(transcript) {
        updates.push([...transcript]);
      }
    });

    expect(capturedRequests[0]?.messages).toEqual([
      { role: "user", content: "<system-reminder>plan mode</system-reminder>\n\ncreate a page" }
    ]);
    expect(updates[0]).toEqual([
      { role: "user", content: "create a page" }
    ]);
    expect(result.transcript[0]).toEqual({
      role: "user",
      content: "create a page"
    });
  });

  it("emits tool call notifications during stream consumption", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        textPart("thinking"),
        toolCallPart("call_2", "echo_tool", { text: "world" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    const events: Array<{ type: "text" | "tool"; value: string }> = [];
    const registry = new ToolRegistry([createEchoTool()]);
    await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "Say world",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onToolCall(toolCall) {
        events.push({ type: "tool", value: `${toolCall.name}:${toolCall.id}` });
      },
      onTextDelta(delta) {
        events.push({ type: "text", value: delta });
      }
    });

    expect(events).toEqual([
      { type: "text", value: "thinking" },
      { type: "tool", value: "echo_tool:call_2" },
      { type: "text", value: "done" }
    ]);
  });

  it("streams text deltas through onTextDelta callback", async () => {
    fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
      textPart("Hello"),
      textPart(" "),
      textPart("world"),
      ...finishParts()
    ]));

    const deltas: string[] = [];
    const registry = new ToolRegistry([createEchoTool()]);
    const result = await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "greet",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onTextDelta(delta) {
        deltas.push(delta);
      }
    });

    expect(deltas).toEqual(["Hello", " ", "world"]);
    expect(result.finalText).toBe("Hello world");
    expect(result.steps[0]?.finishReason).toBe("stop");
  });

  it("stores provider reasoning deltas on assistant messages", async () => {
    fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
      { type: "reasoning-delta", text: "Need an answer. " },
      { type: "reasoning-delta", text: "Replying now." },
      textPart("done"),
      ...finishParts()
    ]));

    const reasoningEvents: string[] = [];
    const result = await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "reason",
      languageModel: {} as never,
      toolRegistry: new ToolRegistry([createEchoTool()]),
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onSessionEvent(event) {
        if (event.type === "assistant.reasoning.delta") {
          reasoningEvents.push(event.delta);
        }
      }
    });

    const assistantMessage = result.transcript.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      role: "assistant",
      providerMetadata: {
        reasoningContent: "Need an answer. Replying now."
      }
    });
    expect(reasoningEvents).toEqual(["Need an answer. ", "Replying now."]);
  });

  it("forwards provider status events through onProviderStatus", async () => {
    const providerEvents: unknown[] = [];

    fakeStreamAssistantResponse.mockImplementationOnce((options) => {
      const onProviderStatus = options.onProviderStatus as ((event: unknown) => void) | undefined;
      onProviderStatus?.({
        type: "retry",
        operation: "openai-chat-completions",
        attempt: 2,
        maxAttempts: 3
      });
      return makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]);
    });

    await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "hello",
      languageModel: {} as never,
      toolRegistry: new ToolRegistry([createEchoTool()]),
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onProviderStatus(event) {
        providerEvents.push(event);
      }
    });

    expect(providerEvents).toEqual([
      {
        type: "retry",
        operation: "openai-chat-completions",
        attempt: 2,
        maxAttempts: 3
      }
    ]);
  });

  it("emits tool result notifications after tool execution", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_3", "echo_tool", { text: "preview" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    const toolResults: Array<Record<string, unknown>> = [];
    const registry = new ToolRegistry([createEchoTool()]);

    await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "preview",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onToolResult(toolResult) {
        toolResults.push(toolResult as unknown as Record<string, unknown>);
      }
    });

    expect(toolResults).toEqual([
      {
        role: "tool",
        toolCallId: "call_3",
        toolName: "echo_tool",
        content: "echo: preview",
        isError: false
      }
    ]);
  });

  it("emits normalized session events including live tool metadata", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_1", "metadata_tool", { text: "hello" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    const events: string[] = [];
    const registry = new ToolRegistry([createMetadataTool()]);

    await runAgentLoop({
      systemPrompt: "test-system-prompt",
      initialUserPrompt: "Say hello",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onSessionEvent(event) {
        events.push(event.type);
      }
    });

    expect(events).toEqual([
      "user.submitted",
      "assistant.step.started",
      "tool.started",
      "assistant.step.finished",
      "tool.metadata.updated",
      "tool.completed",
      "assistant.step.started",
      "assistant.text.delta",
      "assistant.step.finished"
    ]);
  });

  it("runs sibling Task calls with bounded concurrency while preserving result order", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        ...Array.from({ length: 8 }, (_value, index) =>
          toolCallPart(`call_${index + 1}`, "Task", { index: String(index + 1) })),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    let activeCount = 0;
    let maxActiveCount = 0;
    const registry = new ToolRegistry([createDelayedTaskTool(
      () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
      },
      () => {
        activeCount -= 1;
      }
    )]);

    const result = await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "delegate",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    });

    const taskResults = result.transcript.filter((message) => message.role === "tool");
    expect(maxActiveCount).toBe(6);
    expect(taskResults.map((message) => message.content)).toEqual([
      "task 1",
      "task 2",
      "task 3",
      "task 4",
      "task 5",
      "task 6",
      "task 7",
      "task 8"
    ]);
  });

  it("runs read tool batches concurrently while preserving transcript order", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_1", "Read", { path: "slow.txt", delay: "20" }),
        toolCallPart("call_2", "Read", { path: "fast.txt", delay: "1" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    let activeCount = 0;
    let maxActiveCount = 0;
    const registry = new ToolRegistry([createDelayedReadTool(
      () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
      },
      () => {
        activeCount -= 1;
      }
    )]);

    const result = await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "read",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    });

    const toolResults = result.transcript.filter((message) => message.role === "tool");
    expect(maxActiveCount).toBe(2);
    expect(toolResults.map((message) => message.content)).toEqual([
      "read slow.txt",
      "read fast.txt"
    ]);
  });

  it("keeps Bash as a sequential barrier between parallel tool batches", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_1", "Read", { path: "first.txt", delay: "5" }),
        toolCallPart("call_2", "Read", { path: "second.txt", delay: "5" }),
        toolCallPart("call_3", "Bash", { command: "echo barrier" }),
        toolCallPart("call_4", "Read", { path: "third.txt", delay: "1" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    const events: string[] = [];
    const registry = new ToolRegistry([
      createDelayedReadTool(
        (path) => events.push(`start:${path}`),
        (path) => events.push(`finish:${path}`)
      ),
      createRecordedBashTool(events)
    ]);

    await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "schedule",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    });

    const bashStartIndex = events.indexOf("start:bash");
    const thirdReadStartIndex = events.indexOf("start:third.txt");
    expect(events.slice(0, 2).sort()).toEqual(["start:first.txt", "start:second.txt"]);
    expect(bashStartIndex).toBeGreaterThan(events.indexOf("finish:first.txt"));
    expect(bashStartIndex).toBeGreaterThan(events.indexOf("finish:second.txt"));
    expect(thirdReadStartIndex).toBeGreaterThan(events.indexOf("finish:bash"));
  });

  it("serializes same-file mutations while allowing different files to overlap", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_1", "Write", { path: "same.txt", delay: "5" }),
        toolCallPart("call_2", "Write", { path: "same.txt", delay: "5" }),
        toolCallPart("call_3", "Write", { path: "other.txt", delay: "5" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        textPart("done"),
        ...finishParts()
      ]));

    const activeByPath = new Map<string, number>();
    const maxActiveByPath = new Map<string, number>();
    let maxTotalActive = 0;
    const registry = new ToolRegistry([createDelayedWriteTool(
      (path) => {
        const active = (activeByPath.get(path) ?? 0) + 1;
        activeByPath.set(path, active);
        maxActiveByPath.set(path, Math.max(maxActiveByPath.get(path) ?? 0, active));
        maxTotalActive = Math.max(maxTotalActive, Array.from(activeByPath.values()).reduce((total, value) => total + value, 0));
      },
      (path) => {
        activeByPath.set(path, (activeByPath.get(path) ?? 1) - 1);
      }
    )]);

    const result = await runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "write",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    });

    const toolResults = result.transcript.filter((message) => message.role === "tool");
    expect(maxActiveByPath.get("same.txt")).toBe(1);
    expect(maxTotalActive).toBeGreaterThan(1);
    expect(toolResults.map((message) => message.content)).toEqual([
      "wrote same.txt",
      "wrote same.txt",
      "wrote other.txt"
    ]);
  });

  it("publishes partial transcript updates before a later model error", async () => {
    fakeStreamAssistantResponse
      .mockImplementationOnce(() => makeStreamResult([
        toolCallPart("call_4", "failing_tool", { text: "project" }),
        ...finishParts()
      ]))
      .mockImplementationOnce(() => makeStreamResult([
        { type: "error", error: new Error("provider timeout") }
      ]));

    const updates: ConversationMessage[][] = [];
    const registry = new ToolRegistry([createFailingTool()]);

    await expect(runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "what is this project",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      onTranscriptUpdate(transcript) {
        updates.push([...transcript]);
      }
    })).rejects.toThrow("provider timeout");

    expect(updates.at(-1)).toEqual([
      { role: "user", content: "what is this project" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_4",
            name: "failing_tool",
            argumentsJson: "{\"text\":\"project\"}"
          }
        ],
        stepStats: {
          finishReason: "tool_calls",
          durationMs: expect.any(Number) as unknown as number,
          toolCallCount: 1
        }
      },
      {
        role: "tool",
        toolCallId: "call_4",
        toolName: "failing_tool",
        content: "Tool execution failed: tool timed out",
        isError: true
      }
    ]);
  });

  it("throws when the stream emits an error part", async () => {
    fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
      { type: "error", error: new Error("boom") }
    ]));

    const registry = new ToolRegistry([createEchoTool()]);

    await expect(runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "greet",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    })).rejects.toThrow("boom");
  });

  it("throws when the stream is aborted", async () => {
    fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
      textPart("partial"),
      { type: "abort" }
    ]));

    const registry = new ToolRegistry([createEchoTool()]);

    await expect(runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "greet",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    })).rejects.toThrow("Request aborted");
  });

  it("publishes tool results before stopping an aborted tool phase", async () => {
    fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
      toolCallPart("call_1", "abort_tool", {}),
      ...finishParts()
    ]));

    const abortController = new AbortController();
    const transcriptUpdates: Array<readonly ConversationMessage[]> = [];
    const registry = new ToolRegistry([createAbortDuringTool(abortController)]);

    await expect(runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "run tool",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" },
      abortSignal: abortController.signal,
      onTranscriptUpdate(transcript) {
        transcriptUpdates.push(transcript);
      }
    })).rejects.toThrow("Request aborted");

    expect(fakeStreamAssistantResponse).toHaveBeenCalledTimes(1);
    expect(transcriptUpdates.at(-1)).toEqual([
      { role: "user", content: "run tool" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "abort_tool",
            argumentsJson: "{}"
          }
        ],
        stepStats: {
          finishReason: "tool_calls",
          durationMs: expect.any(Number) as unknown as number,
          toolCallCount: 1
        }
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "abort_tool",
        content: "aborted after tool work",
        isError: true
      }
    ]);
  });

  it("stops repeated identical tool-call turns as a doom loop", async () => {
    for (let index = 1; index <= 15; index += 1) {
      fakeStreamAssistantResponse.mockImplementationOnce(() => makeStreamResult([
        toolCallPart(`call_${index}`, "echo_tool", { text: "loop" }),
        ...finishParts()
      ]));
    }

    const registry = new ToolRegistry([createEchoTool()]);

    await expect(runAgentLoop({
      systemPrompt: "test",
      initialUserPrompt: "loop",
      languageModel: {} as never,
      toolRegistry: registry,
      toolContext: { workspaceRoot: "/tmp/recode", approvalMode: "yolo" }
    })).rejects.toThrow("Detected a repeated tool-call loop");
  });
});

function createEchoTool(): ToolDefinition {
  return {
    name: "echo_tool",
    description: "Echo a string back to the caller.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to echo."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      const text = arguments_["text"];

      if (typeof text !== "string") {
        throw new Error("echo_tool requires a text string.");
      }

      return {
        content: `echo: ${text}`,
        isError: false
      };
    }
  };
}

function createFailingTool(): ToolDefinition {
  return {
    name: "failing_tool",
    description: "Always fail.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(_arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      throw new Error("tool timed out");
    }
  };
}

function createMetadataTool(): ToolDefinition {
  return {
    name: "metadata_tool",
    description: "Emit live metadata, then echo.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const text = arguments_["text"];

      if (typeof text !== "string") {
        throw new Error("metadata_tool requires a text string.");
      }

      await context.updateToolMetadata?.({
        title: "metadata",
        metadata: {
          kind: "bash-output",
          command: "metadata_tool",
          output: text
        }
      });

      return {
        content: `metadata: ${text}`,
        isError: false
      };
    }
  };
}

function createAbortDuringTool(abortController: AbortController): ToolDefinition {
  return {
    name: "abort_tool",
    description: "Abort during tool execution.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(_arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      expect(context.abortSignal).toBe(abortController.signal);
      abortController.abort();
      return {
        content: "aborted after tool work",
        isError: true
      };
    }
  };
}

function createDelayedTaskTool(onStart: () => void, onFinish: () => void): ToolDefinition {
  return {
    name: "Task",
    description: "Delayed task.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      const index = arguments_["index"];
      if (typeof index !== "string") {
        throw new Error("missing index");
      }

      onStart();
      await new Promise((resolve) => setTimeout(resolve, 5));
      onFinish();
      return {
        content: `task ${index}`,
        isError: false
      };
    }
  };
}

function createDelayedReadTool(
  onStart: (path: string) => void,
  onFinish: (path: string) => void
): ToolDefinition {
  return {
    name: "Read",
    description: "Delayed read.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      const path = readStringArgument(arguments_, "path");
      const delay = Number(readStringArgument(arguments_, "delay"));
      onStart(path);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? delay : 1));
      onFinish(path);
      return {
        content: `read ${path}`,
        isError: false
      };
    }
  };
}

function createRecordedBashTool(events: string[]): ToolDefinition {
  return {
    name: "Bash",
    description: "Recorded bash.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(_arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      events.push("start:bash");
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push("finish:bash");
      return {
        content: "bash",
        isError: false
      };
    }
  };
}

function createDelayedWriteTool(
  onStart: (path: string) => void,
  onFinish: (path: string) => void
): ToolDefinition {
  return {
    name: "Write",
    description: "Delayed write.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true
    },
    async execute(arguments_: ToolArguments, _context: ToolExecutionContext): Promise<ToolResult> {
      const path = readStringArgument(arguments_, "path");
      const delay = Number(readStringArgument(arguments_, "delay"));
      onStart(path);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? delay : 1));
      onFinish(path);
      return {
        content: `wrote ${path}`,
        isError: false
      };
    }
  };
}

function readStringArgument(arguments_: ToolArguments, key: string): string {
  const value = arguments_[key];
  if (typeof value !== "string") {
    throw new Error(`missing ${key}`);
  }
  return value;
}
