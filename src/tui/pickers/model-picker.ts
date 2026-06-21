/**
 * Model picker helpers for the TUI.
 */

import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { ListedModelGroup } from "../../models/list-models.ts";
import { listModelsForProvider } from "../../models/list-models.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import { selectRuntimeProviderModel, type RuntimeConfig } from "../../runtime/runtime-config.ts";
import { persistConversationSession, persistSelectedModelSelection } from "../session/conversation-session.ts";
import type { SessionMode } from "../session/session-mode.ts";
import type { ModelPickerOption } from "../tui-app-types.ts";
import { appendErrorEntry, appendStatusEntry, type UiEntrySink } from "../tui-helper-output.ts";

export interface OpenModelPickerOptions extends UiEntrySink {
  readonly runtimeConfig: RuntimeConfig;
  readonly setBusy: (value: boolean) => void;
  readonly setGroups: (value: readonly ListedModelGroup[]) => void;
  readonly setOpen: (value: boolean) => void;
  readonly setQuery: (value: string) => void;
  readonly setSelectedIndex: (value: number) => void;
  readonly setWindowStart: (value: number) => void;
}

/**
 * Open the model picker and load model groups for enabled providers.
 */
export async function openModelPicker(options: OpenModelPickerOptions): Promise<void> {
  const enabledProviders = options.runtimeConfig.providers.filter((provider) => provider.disabled !== true);

  if (enabledProviders.length === 0) {
    appendErrorEntry(
      options,
      options.runtimeConfig.providers.length === 0
        ? "No providers are configured yet. Run `recode setup` first."
        : "All providers are disabled. Use /provider to enable one first."
    );
    return;
  }

  options.setOpen(true);
  options.setBusy(true);
  options.setQuery("");
  options.setSelectedIndex(0);
  options.setWindowStart(0);

  try {
    const groups = await Promise.all(
      enabledProviders.map((provider) => listModelsForProvider(provider, options.runtimeConfig.providerId, true))
    );
    options.setGroups(groups);
    options.setSelectedIndex(findActiveModelPickerOptionIndex(groups, options.runtimeConfig));
  } catch (error) {
    appendErrorEntry(options, error);
    options.setOpen(false);
  } finally {
    options.setBusy(false);
  }
}

/**
 * Close the model picker and restore prompt focus.
 */
export function closeModelPicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setQuery: (value: string) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void
): void {
  setOpen(false);
  setQuery("");
  setSelectedIndex(0);
  setWindowStart(0);
  input?.focus();
}

/**
 * Build flat model options for the picker.
 */
export function buildModelPickerOptions(
  groups: readonly ListedModelGroup[],
  query: string,
  runtimeConfig: RuntimeConfig
): readonly ModelPickerOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const options: ModelPickerOption[] = [];

  for (const group of groups) {
    const providerOptions: ModelPickerOption[] = [];

    for (const model of group.models) {
      const haystack = `${group.providerName} ${group.providerId} ${model.label ?? ""} ${model.id}`.toLowerCase();
      if (normalizedQuery !== "" && !haystack.includes(normalizedQuery)) {
        continue;
      }

      providerOptions.push({
        providerId: group.providerId,
        providerName: group.providerName,
        modelId: model.id,
        label: model.label ?? model.id,
        active: model.active,
        providerActive: group.active,
        custom: false
      });
    }

    options.push(...providerOptions);

    if (group.providerId !== runtimeConfig.providerId) {
      continue;
    }

    const customModelId = query.trim();
    const hasExactMatch = group.models.some((model) => model.id === customModelId);
    if (customModelId === "" || hasExactMatch) {
      continue;
    }

    options.push({
      providerId: group.providerId,
      providerName: group.providerName,
      modelId: customModelId,
      label: `Custom model ID for ${group.providerName}`,
      active: false,
      providerActive: group.active,
      custom: true
    });
  }

  return options;
}

/**
 * Return the active model option index.
 */
export function findActiveModelPickerOptionIndex(
  groups: readonly ListedModelGroup[],
  runtimeConfig: RuntimeConfig
): number {
  const options = buildModelPickerOptions(groups, "", runtimeConfig);
  const activeIndex = options.findIndex((option) => option.active);
  return activeIndex === -1 ? 0 : activeIndex;
}

export interface SubmitModelPickerSelectionOptions extends UiEntrySink {
  readonly historyRoot: string;
  readonly runtimeConfig: RuntimeConfig;
  readonly selectedIndex: number;
  readonly options: readonly ModelPickerOption[];
  readonly setBusy: (value: boolean) => void;
  readonly setRuntimeConfig: (value: RuntimeConfig) => void;
  readonly currentConversation: SavedConversationRecord | undefined;
  readonly currentMode: SessionMode;
  readonly transcript: readonly ConversationMessage[];
  readonly subagentTasks: readonly SubagentTaskRecord[];
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly close: () => void;
}

/**
 * Select the highlighted model option.
 */
export async function submitSelectedModelPickerOption(options: SubmitModelPickerSelectionOptions): Promise<void> {
  const selectedOption = options.options[options.selectedIndex];
  if (selectedOption === undefined) {
    return;
  }

  options.setBusy(true);

  try {
    persistSelectedModelSelection(options.runtimeConfig, selectedOption.providerId, selectedOption.modelId);
    const nextRuntimeConfig = selectRuntimeProviderModel(
      options.runtimeConfig,
      selectedOption.providerId,
      selectedOption.modelId
    );
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
    appendStatusEntry(options, `Selected ${selectedOption.providerName} · ${selectedOption.modelId}`);
    options.close();
  } catch (error) {
    appendErrorEntry(options, error);
  } finally {
    options.setBusy(false);
  }
}
