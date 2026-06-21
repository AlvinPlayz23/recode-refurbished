/**
 * Tests for ACP session runtime state.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRecodeConfigFile } from "../config/recode-config.ts";
import { AcpSessionManager } from "./acp-session-manager.ts";
import type { AcpSessionNotification } from "./acp-types.ts";
import type { JsonRpcObject, JsonRpcRequest } from "./json-rpc.ts";

const previousConfigPath = Bun.env.RECODE_CONFIG_PATH;

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete Bun.env.RECODE_CONFIG_PATH;
  } else {
    Bun.env.RECODE_CONFIG_PATH = previousConfigPath;
  }
});

describe("AcpSessionManager", () => {
  test("creates sessions with model and mode config options", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-acp-session-"));
    const configPath = join(workspaceRoot, ".recode", "config.json");
    Bun.env.RECODE_CONFIG_PATH = configPath;
    saveRecodeConfigFile(configPath, {
      version: 1,
      activeProviderId: "openai-main",
      providers: [
        {
          id: "openai-main",
          name: "OpenAI Main",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          models: [{ id: "gpt-a" }, { id: "gpt-b" }],
          defaultModelId: "gpt-a"
        }
      ]
    });
    const updates: AcpSessionNotification[] = [];
    const manager = new AcpSessionManager({
      overrides: {},
      transport: {
        sendSessionUpdate(notification) {
          updates.push(notification);
        },
        async requestClient(_request: JsonRpcRequest): Promise<unknown> {
          return {};
        }
      }
    });

    const response = manager.newSession({ cwd: workspaceRoot });
    const sessionId = readString(response, "sessionId");

    expect(readConfigValue(response, "mode")).toBe("build");
    expect(readConfigValue(response, "model")).toBe("openai-main/gpt-a");

    const modeResponse = manager.setConfigOption({
      sessionId,
      configId: "mode",
      value: "plan"
    });
    expect(readConfigValue(modeResponse, "mode")).toBe("plan");

    const modelResponse = manager.setConfigOption({
      sessionId,
      configId: "model",
      value: "openai-main/gpt-b"
    });
    expect(readConfigValue(modelResponse, "model")).toBe("openai-main/gpt-b");
    expect(updates.map((item) => item.update.sessionUpdate)).toEqual([
      "config_option_update",
      "config_option_update"
    ]);
  });
});

function readConfigValue(response: JsonRpcObject, id: string): string {
  const options = response["configOptions"];
  if (!Array.isArray(options)) {
    throw new Error("Missing config options.");
  }

  const option = options.find((item): item is { readonly id: string; readonly currentValue: string } =>
    typeof item === "object"
    && item !== null
    && "id" in item
    && item.id === id
    && "currentValue" in item
    && typeof item.currentValue === "string"
  );
  if (option === undefined) {
    throw new Error(`Missing config option: ${id}`);
  }

  return option.currentValue;
}

function readString(response: JsonRpcObject, key: string): string {
  const value = response[key];
  if (typeof value !== "string") {
    throw new Error(`Missing string field: ${key}`);
  }

  return value;
}
