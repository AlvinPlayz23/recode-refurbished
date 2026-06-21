/**
 * Tests for history picker helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeHistoryPicker,
  buildHistoryPickerItems,
  formatRelativeTimestamp,
  openHistoryPicker,
  submitSelectedHistoryPickerItem,
  type HistoryPickerItem
} from "./history-picker.ts";
import {
  createConversationRecord,
  saveConversation,
  type SavedConversationRecord
} from "../../history/recode-history.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { RuntimeConfig, RuntimeProviderConfig } from "../../runtime/runtime-config.ts";
import { saveRecodeConfigFile, type RecodeConfigFile } from "../../config/recode-config.ts";

const tempRoots: string[] = [];

describe("history picker helpers", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot !== undefined) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("loads workspace history items and marks the current conversation", async () => {
    const runtimeConfig = createRuntimeConfig();
    const historyRoot = join(runtimeConfig.workspaceRoot, "history");
    const currentConversation = saveTestConversation(historyRoot, runtimeConfig, "one", "First", true);
    saveTestConversation(historyRoot, runtimeConfig, "two", "Second", false);

    let busy = false;
    let open = false;
    let query = "seed";
    let selectedIndex = 99;
    let windowStart = 99;
    let items: readonly HistoryPickerItem[] = [];
    let errorMessage = "";

    await openHistoryPicker({
      historyRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      currentConversationId: currentConversation.id,
      setBusy(value) {
        busy = value;
      },
      setItems(value) {
        items = value;
      },
      setOpen(value) {
        open = value;
      },
      setQuery(value) {
        query = value;
      },
      setSelectedIndex(value) {
        selectedIndex = value;
      },
      setWindowStart(value) {
        windowStart = value;
      },
      onError(message) {
        errorMessage = message;
      }
    });

    expect(open).toBe(true);
    expect(busy).toBe(false);
    expect(query).toBe("");
    expect(selectedIndex).toBe(0);
    expect(windowStart).toBe(0);
    expect(errorMessage).toBe("");
    expect(items.some((item) => item.id === currentConversation.id && item.current)).toBe(true);
  });

  it("filters history items by title, preview, provider, and model", () => {
    const items = buildHistoryPickerItems(
      [
        {
          id: "one",
          title: "Fix parser",
          preview: "Updated tokenizer",
          workspaceRoot: "/workspace",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          providerId: "openai",
          providerName: "OpenAI",
          model: "gpt-4.1",
          mode: "build",
          messageCount: 2,
          current: false
        }
      ],
      "tokenizer"
    );

    expect(items).toHaveLength(1);
  });

  it("restores a selected conversation into session state", async () => {
    const runtimeConfig = createRuntimeConfig();
    const historyRoot = join(runtimeConfig.workspaceRoot, "history");
    const savedConversation = saveTestConversation(historyRoot, runtimeConfig, "one", "First", true);

    let busy = false;
    let nextRuntimeConfig = runtimeConfig;
    let nextConversation: SavedConversationRecord | undefined;
    let nextEntries: readonly string[] = [];
    let nextMessages: readonly ConversationMessage[] = [];
    let closed = false;

    await submitSelectedHistoryPickerItem<string>({
      historyRoot,
      runtimeConfig,
      selectedIndex: 0,
      items: [{
        ...savedConversation,
        current: true
      }],
      setBusy(value) {
        busy = value;
      },
      setRuntimeConfig(value) {
        nextRuntimeConfig = value;
      },
      setConversation(value) {
        nextConversation = value;
      },
      setEntries(value) {
        nextEntries = value;
      },
      setPreviousMessages(value) {
        nextMessages = value;
      },
      setLastContextEstimate() {
        return;
      },
      rehydrateEntries(conversation) {
        return conversation.transcript.map((message) => `${message.role}:${message.content}`);
      },
      close() {
        closed = true;
      }
    });

    expect(busy).toBe(false);
    expect(nextRuntimeConfig.providerId).toBe(runtimeConfig.providerId);
    expect(nextConversation?.id).toBe(savedConversation.id);
    expect(nextEntries).toEqual(["user:First"]);
    expect(nextMessages).toEqual(savedConversation.transcript);
    expect(closed).toBe(true);
  });

  it("resets picker state on close and formats timestamps safely", () => {
    let open = true;
    let query = "x";
    let selectedIndex = 5;
    let windowStart = 5;
    let focused = false;

    closeHistoryPicker(
      (value) => {
        open = value;
      },
      (value) => {
        query = value;
      },
      (value) => {
        selectedIndex = value;
      },
      (value) => {
        windowStart = value;
      },
      () => {
        focused = true;
      }
    );

    expect(open).toBe(false);
    expect(query).toBe("");
    expect(selectedIndex).toBe(0);
    expect(windowStart).toBe(0);
    expect(focused).toBe(true);
    expect(formatRelativeTimestamp("not-a-date")).toBe("not-a-date");
  });
});

function createRuntimeConfig(
  overrides: Partial<RuntimeConfig> = {}
): RuntimeConfig {
  const tempRoot = mkdtempSync(join(tmpdir(), "recode-history-picker-"));
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

function saveTestConversation(
  historyRoot: string,
  runtimeConfig: RuntimeConfig,
  id: string,
  content: string,
  makeCurrent: boolean
): SavedConversationRecord {
  const conversation = createConversationRecord(
    runtimeConfig,
    [{ role: "user", content }],
    "build",
    {
      id,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  );
  saveConversation(historyRoot, conversation, makeCurrent);
  return conversation;
}
