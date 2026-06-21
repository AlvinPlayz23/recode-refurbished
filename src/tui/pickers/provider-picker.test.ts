/**
 * Tests for provider picker helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import {
  buildProviderPickerItems,
  findActiveProviderPickerItemIndex,
  getProviderDefaultModelId
} from "./provider-picker.ts";

describe("provider picker helpers", () => {
  it("builds provider rows with active and disabled state", () => {
    const runtimeConfig = createRuntimeConfig();

    const items = buildProviderPickerItems(runtimeConfig);

    expect(items).toEqual([
      {
        providerId: "primary",
        providerName: "Primary",
        providerKind: "openai-chat",
        baseUrl: "https://primary.example/v1",
        defaultModelId: "primary-model",
        active: true,
        disabled: false
      },
      {
        providerId: "secondary",
        providerName: "Secondary",
        providerKind: "deepseek",
        baseUrl: "https://api.deepseek.com",
        defaultModelId: "deepseek-chat",
        active: false,
        disabled: true
      }
    ]);
    expect(findActiveProviderPickerItemIndex(items)).toBe(0);
  });

  it("falls back to the first model as provider default", () => {
    expect(getProviderDefaultModelId({
      id: "no-default",
      name: "No Default",
      kind: "openai-chat",
      baseUrl: "https://example.com/v1",
      models: [{ id: "first" }],
      source: "config"
    })).toBe("first");
  });
});

function createRuntimeConfig(): RuntimeConfig {
  return {
    workspaceRoot: "/workspace",
    configPath: "/workspace/.recode/config.json",
    provider: "openai-chat",
    providerId: "primary",
    providerName: "Primary",
    model: "primary-model",
    providers: [
      {
        id: "primary",
        name: "Primary",
        kind: "openai-chat",
        baseUrl: "https://primary.example/v1",
        models: [{ id: "primary-model" }],
        defaultModelId: "primary-model",
        source: "config"
      },
      {
        id: "secondary",
        name: "Secondary",
        kind: "deepseek",
        baseUrl: "https://api.deepseek.com",
        disabled: true,
        models: [{ id: "deepseek-chat" }],
        defaultModelId: "deepseek-chat",
        source: "config"
      }
    ],
    approvalMode: "approval",
    approvalAllowlist: [],
    permissionRules: [],
    baseUrl: "https://primary.example/v1"
  };
}
