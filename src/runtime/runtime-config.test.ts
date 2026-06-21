/**
 * Runtime config loader tests.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRuntimeConfig } from "./runtime-config.ts";

describe("loadRuntimeConfig", () => {
  it("loads config from environment variables", () => {
    withEnv(
      {
        RECODE_PROVIDER: "openai",
        RECODE_API_KEY: "sk-test",
        RECODE_BASE_URL: "https://api.openai.com/v1",
        RECODE_MODEL: "gpt-4",
        RECODE_MAX_OUTPUT_TOKENS: "4096",
        RECODE_TEMPERATURE: "0.3",
        RECODE_TOOL_CHOICE: "required"
      },
      () => {
        const config = loadRuntimeConfig("/workspace");

        expect(config.provider).toBe("openai");
        expect(config.providerId).toBe("active");
        expect(config.providerName).toBe("OpenAI");
        expect(config.apiKey).toBe("sk-test");
        expect(config.baseUrl).toBe("https://api.openai.com/v1");
        expect(config.model).toBe("gpt-4");
        expect(config.maxOutputTokens).toBe(4096);
        expect(config.temperature).toBe(0.3);
        expect(config.toolChoice).toBe("required");
      }
    );
  });

  it("loads provider config from the local config file", () => {
    const workspaceRoot = createWorkspaceWithConfig({
      activeProviderId: "openrouter",
      providers: [
        {
          id: "openrouter",
          name: "OpenRouter",
          kind: "openai-chat",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "or-key",
          models: [{ id: "openai/gpt-4.1-mini", contextWindowTokens: 128000 }],
          defaultModelId: "openai/gpt-4.1-mini",
          maxOutputTokens: 1024,
          temperature: 0.1,
          toolChoice: "auto",
          headers: { "x-test": "from-config" },
          options: { provider: { sort: "throughput" } }
        }
      ]
    });

    withEnv({ RECODE_CONFIG_PATH: ".recode/config.json" }, () => {
      const config = loadRuntimeConfig(workspaceRoot);

      expect(config.provider).toBe("openai-chat");
      expect(config.providerId).toBe("openrouter");
      expect(config.providerName).toBe("OpenRouter");
      expect(config.baseUrl).toBe("https://openrouter.ai/api/v1");
      expect(config.apiKey).toBe("or-key");
      expect(config.model).toBe("openai/gpt-4.1-mini");
      expect(config.providers).toHaveLength(1);
      expect(config.maxOutputTokens).toBe(1024);
      expect(config.temperature).toBe(0.1);
      expect(config.toolChoice).toBe("auto");
      expect(config.contextWindowTokens).toBe(128000);
      expect(config.providerHeaders).toEqual({ "x-test": "from-config" });
      expect(config.providerOptions).toEqual({ provider: { sort: "throughput" } });
    });
  });

  it("lets environment variables override the active configured provider", () => {
    const workspaceRoot = createWorkspaceWithConfig({
      activeProviderId: "ollama",
      providers: [
        {
          id: "ollama",
          name: "Local Ollama",
          kind: "openai-chat",
          baseUrl: "http://127.0.0.1:11434/v1",
          models: [{ id: "qwen3:8b" }],
          defaultModelId: "qwen3:8b"
        }
      ]
    });

    withEnv(
      {
        RECODE_CONFIG_PATH: ".recode/config.json",
        RECODE_PROVIDER: "openai",
        RECODE_BASE_URL: "https://api.openai.com/v1",
        RECODE_MODEL: "gpt-4.1"
      },
      () => {
        const config = loadRuntimeConfig(workspaceRoot);

        expect(config.provider).toBe("openai");
        expect(config.baseUrl).toBe("https://api.openai.com/v1");
        expect(config.model).toBe("gpt-4.1");
        expect(config.providers[0]?.source).toBe("env");
      }
    );
  });

  it("falls back to the first enabled provider when the saved active provider is disabled", () => {
    const workspaceRoot = createWorkspaceWithConfig({
      activeProviderId: "disabled",
      providers: [
        {
          id: "disabled",
          name: "Disabled",
          kind: "openai-chat",
          baseUrl: "https://disabled.example/v1",
          disabled: true,
          models: [{ id: "disabled-model" }],
          defaultModelId: "disabled-model"
        },
        {
          id: "enabled",
          name: "Enabled",
          kind: "deepseek",
          baseUrl: "https://api.deepseek.com",
          models: [{ id: "deepseek-chat" }],
          defaultModelId: "deepseek-chat"
        }
      ]
    });

    withEnv({ RECODE_CONFIG_PATH: ".recode/config.json" }, () => {
      const config = loadRuntimeConfig(workspaceRoot);

      expect(config.providerId).toBe("enabled");
      expect(config.provider).toBe("deepseek");
      expect(config.model).toBe("deepseek-chat");
      expect(config.providers[0]?.disabled).toBe(true);
    });
  });

  it("applies environment-only tuning overrides to provider metadata", () => {
    const workspaceRoot = createWorkspaceWithConfig({
      activeProviderId: "openrouter",
      providers: [
        {
          id: "openrouter",
          name: "OpenRouter",
          kind: "openai-chat",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "or-key",
          models: [{ id: "openai/gpt-4.1-mini" }],
          defaultModelId: "openai/gpt-4.1-mini",
          maxOutputTokens: 1024,
          temperature: 0.1,
          toolChoice: "auto"
        }
      ]
    });

    withEnv(
      {
        RECODE_CONFIG_PATH: ".recode/config.json",
        RECODE_MAX_OUTPUT_TOKENS: "4096",
        RECODE_TEMPERATURE: "0.3",
        RECODE_TOOL_CHOICE: "required",
        RECODE_PROVIDER_HEADERS: "{\"x-env\":\"yes\"}",
        RECODE_PROVIDER_OPTIONS: "{\"timeoutMs\":1000,\"provider\":{\"order\":[\"fast\"]}}"
      },
      () => {
        const config = loadRuntimeConfig(workspaceRoot);
        const provider = config.providers[0];

        expect(config.maxOutputTokens).toBe(4096);
        expect(config.temperature).toBe(0.3);
        expect(config.toolChoice).toBe("required");
        expect(config.providerHeaders).toEqual({ "x-env": "yes" });
        expect(config.providerOptions).toEqual({
          timeoutMs: 1000,
          provider: { order: ["fast"] }
        });
        expect(provider?.source).toBe("env");
        expect(provider?.maxOutputTokens).toBe(4096);
        expect(provider?.temperature).toBe(0.3);
        expect(provider?.toolChoice).toBe("required");
        expect(provider?.apiKey).toBe("or-key");
        expect(provider?.headers).toEqual({ "x-env": "yes" });
        expect(provider?.options).toEqual({
          timeoutMs: 1000,
          provider: { order: ["fast"] }
        });
      }
    );
  });

  it("allows missing API keys for endpoints that do not require them", () => {
    withEnv(
      {
        RECODE_PROVIDER: "openai-chat",
        RECODE_BASE_URL: "http://127.0.0.1:11434/v1",
        RECODE_MODEL: "qwen3:8b"
      },
      () => {
        const config = loadRuntimeConfig("/workspace");
        expect(config.apiKey).toBeUndefined();
      }
    );
  });

  it("uses native provider default base URLs for env-only providers", () => {
    withEnv(
      {
        RECODE_PROVIDER: "google-ai-studio",
        RECODE_MODEL: "gemini-2.5-flash"
      },
      () => {
        const config = loadRuntimeConfig("/workspace");
        const provider = config.providers[0];

        expect(config.provider).toBe("gemini");
        expect(config.providerName).toBe("Google AI Studio");
        expect(config.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
        expect(provider?.kind).toBe("gemini");
        expect(provider?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
      }
    );
  });

  it("throws when no model can be resolved", () => {
    withEnv(
      { RECODE_PROVIDER: "openai", RECODE_BASE_URL: "https://api.openai.com/v1" },
      () => {
        expect(() => loadRuntimeConfig("/workspace")).toThrow("Missing model ID");
      }
    );
  });

  it("uses the native OpenAI base URL when no base URL is configured", () => {
    withEnv(
      { RECODE_PROVIDER: "openai", RECODE_MODEL: "gpt-4.1" },
      () => {
        const config = loadRuntimeConfig("/workspace");
        expect(config.baseUrl).toBe("https://api.openai.com/v1");
      }
    );
  });
});

interface EnvOverrides {
  readonly RECODE_CONFIG_PATH?: string;
  readonly RECODE_ACTIVE_PROVIDER?: string;
  readonly RECODE_PROVIDER?: string;
  readonly RECODE_API_KEY?: string;
  readonly RECODE_BASE_URL?: string;
  readonly RECODE_MODEL?: string;
  readonly RECODE_PROVIDER_HEADERS?: string;
  readonly RECODE_PROVIDER_OPTIONS?: string;
  readonly RECODE_MAX_OUTPUT_TOKENS?: string;
  readonly RECODE_TEMPERATURE?: string;
  readonly RECODE_TOOL_CHOICE?: string;
}

function withEnv(overrides: EnvOverrides, fn: () => void): void {
  const keys = [
    "RECODE_CONFIG_PATH",
    "RECODE_ACTIVE_PROVIDER",
    "RECODE_PROVIDER",
    "RECODE_API_KEY",
    "RECODE_BASE_URL",
    "RECODE_MODEL",
    "RECODE_PROVIDER_HEADERS",
    "RECODE_PROVIDER_OPTIONS",
    "RECODE_MAX_OUTPUT_TOKENS",
    "RECODE_TEMPERATURE",
    "RECODE_TOOL_CHOICE"
  ] as const;
  const originals = new Map<string, string | undefined>();

  for (const key of keys) {
    originals.set(key, Bun.env[key]);
  }

  try {
    for (const key of keys) {
      delete Bun.env[key];
    }

    if (overrides.RECODE_CONFIG_PATH === undefined) {
      Bun.env.RECODE_CONFIG_PATH = join(
        tmpdir(),
        `recode-runtime-config-${Math.random().toString(36).slice(2)}.json`
      );
    }

    for (const [key, value] of Object.entries(overrides)) {
      Bun.env[key] = value;
    }

    fn();
  } finally {
    for (const key of keys) {
      const original = originals.get(key);
      if (original === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = original;
      }
    }
  }
}

function createWorkspaceWithConfig(config: Record<string, unknown>): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-runtime-config-"));
  const configDir = join(workspaceRoot, ".recode");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`, "utf8");
  return workspaceRoot;
}
