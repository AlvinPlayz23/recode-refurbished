/**
 * History picker helpers for the TUI.
 */

import {
  estimateConversationContextTokens,
  type ContextTokenEstimate
} from "../../agent/compact-conversation.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import {
  listHistoryForWorkspace,
  loadConversation,
  loadHistoryIndex,
  markConversationAsCurrent,
  type SavedConversationMeta,
  type SavedConversationRecord
} from "../../history/recode-history.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import { restoreSavedConversationRuntime } from "../session/conversation-session.ts";

export interface HistoryPickerItem extends SavedConversationMeta {
  readonly current: boolean;
}

export interface OpenHistoryPickerOptions {
  readonly historyRoot: string;
  readonly workspaceRoot: string;
  readonly currentConversationId: string | undefined;
  readonly setBusy: (value: boolean) => void;
  readonly setItems: (value: readonly HistoryPickerItem[]) => void;
  readonly setOpen: (value: boolean) => void;
  readonly setQuery: (value: string) => void;
  readonly setSelectedIndex: (value: number) => void;
  readonly setWindowStart: (value: number) => void;
  readonly onError: (message: string) => void;
}

/**
 * Open the history picker and load workspace-specific items.
 */
export async function openHistoryPicker(options: OpenHistoryPickerOptions): Promise<void> {
  options.setOpen(true);
  options.setBusy(true);
  options.setQuery("");
  options.setSelectedIndex(0);
  options.setWindowStart(0);

  try {
    const items = listHistoryForWorkspace(loadHistoryIndex(options.historyRoot), options.workspaceRoot);
    options.setItems(items.map((item) => ({
      ...item,
      current: item.id === options.currentConversationId
    })));
  } catch (error) {
    options.onError(toErrorMessage(error));
    options.setOpen(false);
  } finally {
    options.setBusy(false);
  }
}

/**
 * Close the history picker and reset transient state.
 */
export function closeHistoryPicker(
  setOpen: (value: boolean) => void,
  setQuery: (value: string) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void,
  onClosed?: () => void
): void {
  setOpen(false);
  setQuery("");
  setSelectedIndex(0);
  setWindowStart(0);
  onClosed?.();
}

/**
 * Filter history picker items by a free-text query.
 */
export function buildHistoryPickerItems(
  items: readonly HistoryPickerItem[],
  query: string
): readonly HistoryPickerItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery === "") {
    return items;
  }

  return items.filter((item) => {
    const haystack = `${item.title} ${item.preview} ${item.providerName} ${item.providerId} ${item.model}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export interface SubmitHistoryPickerSelectionOptions<TEntry> {
  readonly historyRoot: string;
  readonly runtimeConfig: RuntimeConfig;
  readonly selectedIndex: number;
  readonly items: readonly HistoryPickerItem[];
  readonly setBusy: (value: boolean) => void;
  readonly setRuntimeConfig: (value: RuntimeConfig) => void;
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly setEntries: (value: readonly TEntry[]) => void;
  readonly setPreviousMessages: (value: readonly ConversationMessage[]) => void;
  readonly setSessionEvents?: (value: readonly SessionEvent[]) => void;
  readonly setSubagentTasks?: (value: readonly SubagentTaskRecord[]) => void;
  readonly setLastContextEstimate: (value: ContextTokenEstimate | undefined) => void;
  readonly rehydrateEntries: (conversation: SavedConversationRecord) => readonly TEntry[];
  readonly close: () => void;
}

/**
 * Restore the selected history item into the active TUI session.
 */
export async function submitSelectedHistoryPickerItem<TEntry>(
  options: SubmitHistoryPickerSelectionOptions<TEntry>
): Promise<void> {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  options.setBusy(true);

  try {
    const conversation = loadConversation(options.historyRoot, selectedItem.id);
    if (conversation === undefined) {
      throw new Error("The selected conversation could not be loaded.");
    }

    markConversationAsCurrent(options.historyRoot, conversation.id);
    options.setRuntimeConfig(restoreSavedConversationRuntime(options.runtimeConfig, conversation));
    options.setConversation(conversation);
    options.setEntries(options.rehydrateEntries(conversation));
    options.setPreviousMessages(conversation.transcript);
    options.setSessionEvents?.(conversation.sessionEvents ?? []);
    options.setSubagentTasks?.(conversation.subagentTasks ?? []);
    options.setLastContextEstimate(estimateConversationContextTokens(conversation.transcript));
    options.close();
  } finally {
    options.setBusy(false);
  }
}

/**
 * Format a saved timestamp for display in the history picker.
 */
export function formatRelativeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
