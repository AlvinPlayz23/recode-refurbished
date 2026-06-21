/**
 * Command-panel state helpers for slash-command drafts.
 */

import { normalizeBuiltinCommandSelectionIndex } from "../message-format.ts";
import type { CommandPanelState } from "../keyboard-router.ts";

const COMMAND_PANEL_VISIBLE_COUNT = 6;

/** Build the visible slash-command panel state for the composer. */
export function buildCommandPanelState(
  draft: string,
  commands: readonly { readonly command: string; readonly description: string }[],
  busy: boolean,
  selectedIndex: number
): CommandPanelState | undefined {
  const prompt = draft.trim();

  if (busy || !prompt.startsWith("/")) {
    return undefined;
  }

  const normalizedSelectedIndex = normalizeBuiltinCommandSelectionIndex(selectedIndex, commands.length);
  const visibleStartIndex = getCommandWindowStart(normalizedSelectedIndex, commands.length);
  const visibleCommands = commands.slice(visibleStartIndex, visibleStartIndex + COMMAND_PANEL_VISIBLE_COUNT);

  return {
    commands,
    visibleCommands,
    hasMore: commands.length > visibleCommands.length,
    visibleStartIndex,
    selectedIndex: normalizedSelectedIndex,
    visibleSelectedIndex: normalizedSelectedIndex - visibleStartIndex,
    selectedCommand: commands[normalizedSelectedIndex],
    totalCount: commands.length
  };
}

function getCommandWindowStart(selectedIndex: number, totalCount: number): number {
  if (totalCount <= COMMAND_PANEL_VISIBLE_COUNT) {
    return 0;
  }

  const maxStartIndex = totalCount - COMMAND_PANEL_VISIBLE_COUNT;
  return Math.min(maxStartIndex, Math.max(0, selectedIndex - COMMAND_PANEL_VISIBLE_COUNT + 1));
}
