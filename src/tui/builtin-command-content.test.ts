/**
 * Tests for built-in command content helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRecodeConfigFile, type RecodeConfigFile } from "../config/recode-config.ts";
import type { ConversationMessage } from "../transcript/message.ts";
import type { RuntimeConfig, RuntimeProviderConfig } from "../runtime/runtime-config.ts";
import {
  buildBuiltinConfigBody,
  buildBuiltinHelpBody,
  buildBuiltinStatusBody,
  buildContextWindowFallbackKey,
  buildContextWindowStatusSnapshot
} from "./builtin-command-content.ts";

const tempRoots: string[] = [];

describe("builtin command content", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot !== undefined) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("builds the help body from registered built-in commands", () => {
    const body = buildBuiltinHelpBody();

    expect(body).toContain("## Available Commands");
    expect(body).toContain("`/help`");
    expect(body).toContain("`/models`");
  });

  it("builds a context-window snapshot from configured or fallback values", () => {
    const runtimeConfig = createRuntimeConfig({ contextWindowTokens: 128000, maxOutputTokens: 4096 });
    const fallbackKey = buildContextWindowFallbackKey(runtimeConfig.providerId, runtimeConfig.model);

    const configuredSnapshot = buildContextWindowStatusSnapshot(runtimeConfig, {}, undefined);
    const fallbackSnapshot = buildContextWindowStatusSnapshot(
      omitContextWindow(runtimeConfig),
      { [fallbackKey]: 64000 },
      { estimatedTokens: 1234, source: "rough" }
    );

    expect(configuredSnapshot.contextWindowTokens).toBe(128000);
    expect(configuredSnapshot.source).toBe("configured");
    expect(fallbackSnapshot.contextWindowTokens).toBe(64000);
    expect(fallbackSnapshot.source).toBe("fallback");
    expect(fallbackSnapshot.lastEstimate?.estimatedTokens).toBe(1234);
  });

  it("builds the status body with transcript stats", () => {
    const runtimeConfig = createRuntimeConfig();
    const transcript: readonly ConversationMessage[] = [
      {
        role: "summary",
        kind: "continuation",
        content: "Earlier context."
      },
      {
        role: "assistant",
        content: "Done",
        toolCalls: [],
        stepStats: {
          finishReason: "stop",
          durationMs: 42,
          toolCallCount: 1,
          tokenUsage: {
            input: 10,
            output: 20,
            reasoning: 3,
            cacheRead: 0,
            cacheWrite: 0
          }
        }
      }
    ];

    const body = buildBuiltinStatusBody(
      runtimeConfig,
      "arrow",
      "build",
      3,
      transcript.length,
      transcript,
      buildContextWindowStatusSnapshot(runtimeConfig, {}, undefined)
    );

    expect(body).toContain("## Current Status");
    expect(body).toContain("Completed assistant steps: 1");
    expect(body).toContain("Total tool calls: 1");
    expect(body).toContain("Total tokens: 30");
    expect(body).toContain("Compaction summaries: 1");
    expect(body).toContain("Last step duration: 42 ms");
  });

  it("builds the config body from persisted provider config", () => {
    const runtimeConfig = createRuntimeConfig();

    const body = buildBuiltinConfigBody(runtimeConfig, "senren-dusk", "arrow");

    expect(body).toContain("## Recode Configuration");
    expect(body).toContain("Todo panel: enabled");
    expect(body).toContain("Primary");
    expect(body).toContain("`gpt-4.1`");
  });
});

function createRuntimeConfig(
  overrides: Partial<RuntimeConfig> = {}
): RuntimeConfig {
  const tempRoot = mkdtempSync(join(tmpdir(), "recode-builtin-content-"));
  tempRoots.push(tempRoot);

  const configPath = join(tempRoot, "config.json");
  const providers = overrides.providers ?? [createProvider("primary", "Primary", "gpt-4.1")];
  const providerId = overrides.providerId ?? providers[0]?.id ?? "primary";
  const providerName = overrides.providerName ?? providers[0]?.name ?? "Primary";
  const model = overrides.model ?? providers[0]?.defaultModelId ?? "gpt-4.1";

  const config: RecodeConfigFile = {
    version: 1,
    activeProviderId: providerId,
    providers: providers.map(({ source: _source, ...provider }) => provider)
  };
  saveRecodeConfigFile(configPath, config);

  return {
    workspaceRoot: tempRoot,
    configPath,
    provider: "openai",
    providerId,
    providerName,
    model,
    providers,
    approvalMode: "approval",
    approvalAllowlist: [],
    permissionRules: [],
    baseUrl: "https://api.openai.com/v1",
    ...overrides
  };
}

function createProvider(
  id: string,
  name: string,
  modelId: string
): RuntimeProviderConfig {
  return {
    id,
    name,
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [{ id: modelId }],
    defaultModelId: modelId,
    source: "config"
  };
}

function omitContextWindow(runtimeConfig: RuntimeConfig): RuntimeConfig {
  const { contextWindowTokens: _contextWindowTokens, ...rest } = runtimeConfig;
  return rest;
}
