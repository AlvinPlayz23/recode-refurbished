/**
 * Tests for the internal model factory.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import type { ProviderKind } from "../providers/provider-kind.ts";
import { createLanguageModel } from "./create-model-client.ts";

describe("createLanguageModel", () => {
  it("maps openai to the responses adapter", () => {
    const model = createLanguageModel({
      workspaceRoot: "/workspace",
      configPath: "/workspace/.recode/config.json",
      provider: "openai",
      providerId: "openai",
      providerName: "OpenAI",
      model: "gpt-4.1",
      providers: [],
      approvalMode: "approval",
      approvalAllowlist: [],
      permissionRules: [],
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      providerHeaders: { "x-test": "yes" },
      providerOptions: { timeoutMs: 1000 },
      maxOutputTokens: 2048,
      temperature: 0.2,
      toolChoice: "required",
      contextWindowTokens: 128000
    });

    expect(model.api).toBe("openai-responses");
    expect(model.modelId).toBe("gpt-4.1");
    expect(model.maxOutputTokens).toBe(2048);
    expect(model.temperature).toBe(0.2);
    expect(model.toolChoice).toBe("required");
    expect(model.contextWindowTokens).toBe(128000);
    expect(model.providerHeaders).toEqual({ "x-test": "yes" });
    expect(model.providerOptions).toEqual({ timeoutMs: 1000 });
  });

  it("maps openai-oauth to the responses adapter without requiring an API key", () => {
    const model = createLanguageModel({
      workspaceRoot: "/workspace",
      configPath: "/workspace/.recode/config.json",
      provider: "openai-oauth",
      providerId: "openai-oauth",
      providerName: "OpenAI Codex OAuth",
      model: "gpt-5.2-codex",
      providers: [],
      approvalMode: "approval",
      approvalAllowlist: [],
      permissionRules: [],
      baseUrl: "https://chatgpt.com/backend-api"
    });

    expect(model.api).toBe("openai-responses");
    expect(model.apiKey).toBe("");
  });

  const chatProviders: readonly ProviderKind[] = [
    "openai-chat",
    "gemini",
    "groq",
    "aihubmix",
    "deepseek",
    "z-ai",
    "z-ai-coding",
    "huggingface"
  ];

  for (const provider of chatProviders) {
    it(`maps ${provider} to the chat completions adapter`, () => {
      const model = createLanguageModel({
        workspaceRoot: "/workspace",
        configPath: "/workspace/.recode/config.json",
        provider,
        providerId: provider,
        providerName: provider,
        model: "model-id",
        providers: [],
        approvalMode: "approval",
        approvalAllowlist: [],
        permissionRules: [],
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test"
      });

      expect(model.api).toBe("openai-chat-completions");
    });
  }

  it("maps anthropic to the messages adapter", () => {
    const model = createLanguageModel({
      workspaceRoot: "/workspace",
      configPath: "/workspace/.recode/config.json",
      provider: "anthropic",
      providerId: "anthropic",
      providerName: "Anthropic",
      model: "claude-sonnet-4-20250514",
      providers: [],
      approvalMode: "approval",
      approvalAllowlist: [],
      permissionRules: [],
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test"
    });

    expect(model.api).toBe("anthropic-messages");
  });
});
