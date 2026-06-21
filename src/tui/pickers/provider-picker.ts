/**
 * Provider picker helpers for the TUI.
 */

import { setConfiguredProviderDisabled, loadRecodeConfigFile, saveRecodeConfigFile } from "../../config/recode-config.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import { selectRuntimeProviderModel, type RuntimeConfig, type RuntimeProviderConfig } from "../../runtime/runtime-config.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import { persistConversationSession, persistSelectedModelSelection } from "../session/conversation-session.ts";
import type { SessionMode } from "../session/session-mode.ts";
import { appendStatusEntry, appendErrorEntry, type UiEntrySink } from "../tui-helper-output.ts";

/**
 * One selectable provider row in the provider picker.
 */
export interface ProviderPickerItem {
  readonly providerId: string;
  readonly providerName: string;
  readonly providerKind: string;
  readonly baseUrl: string;
  readonly defaultModelId?: string;
  readonly active: boolean;
  readonly disabled: boolean;
}

/**
 * Build provider picker rows from runtime config.
 */
export function buildProviderPickerItems(runtimeConfig: RuntimeConfig): readonly ProviderPickerItem[] {
  return runtimeConfig.providers.map((provider) => toProviderPickerItem(provider, runtimeConfig));
}

/**
 * Return the index of the active provider row.
 */
export function findActiveProviderPickerItemIndex(items: readonly ProviderPickerItem[]): number {
  const activeIndex = items.findIndex((item) => item.active);
  return activeIndex === -1 ? 0 : activeIndex;
}

/**
 * Return the provider's configured default model, if any.
 */
export function getProviderDefaultModelId(provider: RuntimeProviderConfig): string | undefined {
  return provider.defaultModelId ?? provider.models[0]?.id;
}

/**
 * Open the provider picker with the active provider selected.
 */
export function openProviderPicker(
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void,
  items: readonly ProviderPickerItem[]
): void {
  setOpen(true);
  setSelectedIndex(findActiveProviderPickerItemIndex(items));
  setWindowStart(0);
}

/**
 * Close the provider picker and restore prompt focus.
 */
export function closeProviderPicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void
): void {
  setOpen(false);
  setSelectedIndex(0);
  setWindowStart(0);
  input?.focus();
}

export interface SubmitProviderPickerSelectionOptions extends UiEntrySink {
  readonly historyRoot: string;
  readonly runtimeConfig: RuntimeConfig;
  readonly selectedIndex: number;
  readonly items: readonly ProviderPickerItem[];
  readonly currentConversation: SavedConversationRecord | undefined;
  readonly currentMode: SessionMode;
  readonly transcript: readonly ConversationMessage[];
  readonly subagentTasks: readonly SubagentTaskRecord[];
  readonly setRuntimeConfig: (value: RuntimeConfig) => void;
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly close: () => void;
}

/**
 * Select one provider from the provider picker.
 */
export function submitSelectedProviderPickerItem(options: SubmitProviderPickerSelectionOptions): void {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  if (selectedItem.disabled) {
    appendErrorEntry(options, `Enable ${selectedItem.providerName} before selecting it.`);
    return;
  }

  const selectedProvider = options.runtimeConfig.providers.find((provider) => provider.id === selectedItem.providerId);
  const modelId = selectedProvider === undefined ? undefined : getProviderDefaultModelId(selectedProvider);
  if (modelId === undefined) {
    appendErrorEntry(
      options,
      `${selectedItem.providerName} has no saved model. Run /models after selecting an enabled provider with a model, or use recode setup to add one.`
    );
    return;
  }

  try {
    persistSelectedModelSelection(options.runtimeConfig, selectedItem.providerId, modelId);
    const nextRuntimeConfig = selectRuntimeProviderModel(options.runtimeConfig, selectedItem.providerId, modelId);
    options.setRuntimeConfig(nextRuntimeConfig);
    const nextConversation = persistConversationSession(
      options.historyRoot,
      nextRuntimeConfig,
      options.transcript,
      options.currentConversation,
      options.currentMode,
      options.subagentTasks
    );
    options.setConversation(nextConversation);
    appendStatusEntry(options, `Selected provider ${selectedItem.providerName} · ${modelId}`);
    options.close();
  } catch (error) {
    appendErrorEntry(options, error);
  }
}

export interface ToggleProviderPickerItemOptions extends UiEntrySink {
  readonly runtimeConfig: RuntimeConfig;
  readonly selectedIndex: number;
  readonly items: readonly ProviderPickerItem[];
  readonly setRuntimeConfig: (value: RuntimeConfig) => void;
}

/**
 * Toggle the selected provider's enabled state.
 */
export function toggleSelectedProviderPickerItem(options: ToggleProviderPickerItemOptions): void {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  if (selectedItem.active) {
    appendErrorEntry(options, "Select another provider before disabling the active one.");
    return;
  }

  const nextDisabled = !selectedItem.disabled;
  try {
    persistProviderDisabled(options.runtimeConfig.configPath, selectedItem.providerId, nextDisabled);
    options.setRuntimeConfig({
      ...options.runtimeConfig,
      providers: options.runtimeConfig.providers.map((provider) => {
        if (provider.id !== selectedItem.providerId) {
          return provider;
        }

        if (nextDisabled) {
          return {
            ...provider,
            disabled: true
          };
        }

        const { disabled: _disabled, ...enabledProvider } = provider;
        return enabledProvider;
      })
    });
    appendStatusEntry(options, `${nextDisabled ? "Disabled" : "Enabled"} provider ${selectedItem.providerName}`);
  } catch (error) {
    appendErrorEntry(options, error);
  }
}

function toProviderPickerItem(
  provider: RuntimeProviderConfig,
  runtimeConfig: RuntimeConfig
): ProviderPickerItem {
  const defaultModelId = getProviderDefaultModelId(provider);

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerKind: provider.kind,
    baseUrl: provider.baseUrl,
    active: provider.id === runtimeConfig.providerId,
    disabled: provider.disabled === true,
    ...(defaultModelId === undefined ? {} : { defaultModelId })
  };
}

function persistProviderDisabled(configPath: string, providerId: string, disabled: boolean): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = setConfiguredProviderDisabled(config, providerId, disabled);
  saveRecodeConfigFile(configPath, nextConfig);
}
