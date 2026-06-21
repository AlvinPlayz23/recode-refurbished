/**
 * End-to-end smoke test for the one-shot app path.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AiResponseStream, AiStreamPart } from "../ai/types.ts";
import { loadConversation, resolveHistoryRoot } from "../history/recode-history.ts";
import { createLanguageModel } from "../models/create-model-client.ts";
import { DEFAULT_SYSTEM_PROMPT } from "../prompt/system-prompt.ts";
import { loadRuntimeConfig } from "../runtime/runtime-config.ts";
import { createTools } from "../tools/create-tools.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import { persistConversationSession } from "../tui/session/conversation-session.ts";

const fakeStreamAssistantResponse = mock<(options: Record<string, unknown>) => AiResponseStream>();

mock.module("../ai/stream-assistant-response.ts", () => ({
  streamAssistantResponse: fakeStreamAssistantResponse
}));

const { runAgentLoop } = await import("../agent/run-agent-loop.ts");

const ENV_KEYS = [
  "RECODE_CONFIG_PATH",
  "RECODE_PROVIDER",
  "RECODE_ACTIVE_PROVIDER",
  "RECODE_API_KEY",
  "RECODE_BASE_URL",
  "RECODE_MODEL",
  "RECODE_PROVIDER_HEADERS",
  "RECODE_PROVIDER_OPTIONS",
  "RECODE_MAX_OUTPUT_TOKENS",
  "RECODE_TEMPERATURE",
  "RECODE_TOOL_CHOICE"
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, Bun.env[key]]));
const tempRoots: string[] = [];

afterEach(() => {
  fakeStreamAssistantResponse.mockReset();

  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }

  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe("app end-to-end smoke path", () => {
  it("boots runtime config, streams from a fake provider, runs a tool, saves history, and exits cleanly", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-app-e2e-"));
    tempRoots.push(workspaceRoot);
    const configPath = join(workspaceRoot, ".recode", "config.json");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(join(workspaceRoot, "README.md"), "# Recode\n\nLocal coding agent.\n", "utf8");
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      activeProviderId: "fake-openai-chat",
      providers: [
        {
          id: "fake-openai-chat",
          name: "Fake OpenAI Chat",
          kind: "openai-chat",
          baseUrl: "https://fake-provider.test/v1",
          apiKey: "test-key",
          models: [{ id: "fake-model" }],
          defaultModelId: "fake-model",
          options: {
            maxRetries: 0
          }
        }
      ]
    }, null, 2), "utf8");
    configureIsolatedEnv(configPath);

    const capturedRequests: Array<{ readonly messages: unknown; readonly tools: unknown }> = [];
    fakeStreamAssistantResponse
      .mockImplementationOnce((options) => {
        capturedRequests.push({
          messages: options.messages,
          tools: options.tools
        });
        return makeStreamResult([
          {
            type: "tool-call",
            toolCallId: "call_read",
            toolName: "Read",
            input: { path: "README.md" }
          },
          { type: "finish-step", info: { finishReason: "tool_calls" } },
          { type: "finish" }
        ]);
      })
      .mockImplementationOnce((options) => {
        capturedRequests.push({
          messages: options.messages,
          tools: options.tools
        });
        return makeStreamResult([
          { type: "text-delta", text: "Read README and saved the result." },
          { type: "finish-step", info: { finishReason: "stop" } },
          { type: "finish" }
        ]);
      });

    const runtimeConfig = loadRuntimeConfig(workspaceRoot);
    const languageModel = createLanguageModel(runtimeConfig);
    const toolRegistry = new ToolRegistry(createTools());

    const result = await runAgentLoop({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      initialUserPrompt: "Inspect the README.",
      languageModel,
      toolRegistry,
      requestAffinityKey: "app-e2e",
      toolContext: {
        workspaceRoot: runtimeConfig.workspaceRoot,
        approvalMode: "yolo",
        approvalAllowlist: [],
        permissionRules: []
      }
    });

    const historyRoot = resolveHistoryRoot(runtimeConfig.configPath);
    const conversation = persistConversationSession(
      historyRoot,
      runtimeConfig,
      result.transcript,
      undefined,
      "build"
    );
    const savedConversation = loadConversation(historyRoot, conversation.id);

    expect(result.finalText).toBe("Read README and saved the result.");
    expect(fakeStreamAssistantResponse).toHaveBeenCalledTimes(2);
    expect(Array.isArray(capturedRequests[0]?.tools)).toBe(true);
    expect(capturedRequests[1]?.messages).toContainEqual({
      role: "tool",
      toolCallId: "call_read",
      toolName: "Read",
      content: "# Recode\n\nLocal coding agent.\n",
      isError: false
    });
    expect(savedConversation?.transcript).toEqual(result.transcript);
    expect(savedConversation?.transcript.some((message) =>
      message.role === "tool"
      && message.toolName === "Read"
      && message.content.includes("Local coding agent")
    )).toBe(true);
  });
});

function configureIsolatedEnv(configPath: string): void {
  Bun.env.RECODE_CONFIG_PATH = configPath;
  Bun.env.RECODE_PROVIDER = "openai-chat";
  Bun.env.RECODE_ACTIVE_PROVIDER = "fake-openai-chat";
  Bun.env.RECODE_API_KEY = "test-key";
  Bun.env.RECODE_BASE_URL = "https://fake-provider.test/v1";
  Bun.env.RECODE_MODEL = "fake-model";
  delete Bun.env.RECODE_PROVIDER_HEADERS;
  delete Bun.env.RECODE_PROVIDER_OPTIONS;
  delete Bun.env.RECODE_MAX_OUTPUT_TOKENS;
  delete Bun.env.RECODE_TEMPERATURE;
  delete Bun.env.RECODE_TOOL_CHOICE;
}

async function* yieldParts(parts: readonly AiStreamPart[]): AsyncGenerator<AiStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

function makeStreamResult(parts: readonly AiStreamPart[]): AiResponseStream {
  return { fullStream: yieldParts(parts) };
}
