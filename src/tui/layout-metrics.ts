/**
 * Pure layout measurement helpers for the TUI conversation shell.
 */

import { toVisibleDraft } from "./composer/prompt-draft.ts";
import type { UiEntry } from "./transcript/transcript-entry-state.ts";

const EDIT_PREVIEW_MAX_LINES = 24;

/**
 * Minimal selector panel shape needed for composer height estimates.
 */
export interface LayoutMetricsPanel {
  readonly items?: readonly unknown[];
  readonly commands?: readonly unknown[];
  readonly visibleCommands?: readonly unknown[];
  readonly hasMore: boolean;
}

/**
 * Estimate the full non-docked conversation flow height.
 */
export function estimateConversationFlowHeight(
  entries: readonly UiEntry[],
  width: number,
  commandPanel: LayoutMetricsPanel | undefined,
  fileSuggestionPanel: LayoutMetricsPanel | undefined,
  draft: string,
  todoPanelLineCount: number = 0
): number {
  const transcriptHeight = entries.reduce((total, entry) => total + estimateEntryHeight(entry, width), 0);
  return transcriptHeight + estimateComposerHeight(width, commandPanel, fileSuggestionPanel, draft, todoPanelLineCount);
}

/**
 * Estimate the header area used above the transcript/composer flow.
 */
export function estimateHeaderHeight(
  minimalMode: boolean,
  showSplashLogo: boolean,
  splashDetailsVisible: boolean
): number {
  if (minimalMode) {
    return 0;
  }

  if (showSplashLogo) {
    return splashDetailsVisible ? 18 : 10;
  }

  return 5;
}

/**
 * Estimate one transcript entry's rendered height.
 */
export function estimateEntryHeight(entry: UiEntry, width: number): number {
  const contentWidth = Math.max(12, width - 6);

  switch (entry.kind) {
    case "user":
      return estimateWrappedTextHeight(entry.body, contentWidth) + 2;
    case "assistant":
      return estimateWrappedTextHeight(entry.body, contentWidth) + 1;
    case "reasoning":
      return entry.reasoningStatus === "completed"
        ? 1
        : estimateWrappedTextHeight(entry.body, contentWidth) + 1;
    case "tool":
    case "tool-group":
    case "status":
      return estimateWrappedTextHeight(entry.body, contentWidth) + 1;
    case "tool-preview": {
      const headerHeight = estimateWrappedTextHeight(entry.body, contentWidth) + 1;
      if (entry.metadata?.kind === "bash-output") {
        const visibleOutputLines = Math.min(
          10,
          entry.metadata.output.trimEnd() === "" ? 0 : entry.metadata.output.trimEnd().split("\n").length
        );
        return headerHeight + visibleOutputLines + 4;
      }

      if (entry.metadata?.kind === "edit-preview") {
        const removedLines = countPreviewLines(entry.metadata.oldText);
        const addedLines = countPreviewLines(entry.metadata.newText);
        const visibleChangedLines = Math.min(EDIT_PREVIEW_MAX_LINES, removedLines + addedLines);
        const omittedLine = removedLines + addedLines > EDIT_PREVIEW_MAX_LINES ? 1 : 0;
        return headerHeight + visibleChangedLines + omittedLine + 5;
      }

      return headerHeight;
    }
    case "error":
      return estimateWrappedTextHeight(entry.body, contentWidth) + 2;
  }
}

/**
 * Estimate composer height including command/file panels, textarea, rails, and badges.
 */
export function estimateComposerHeight(
  width: number,
  commandPanel: LayoutMetricsPanel | undefined,
  fileSuggestionPanel: LayoutMetricsPanel | undefined,
  draft: string,
  todoPanelLineCount: number = 0
): number {
  const commandCount = commandPanel?.visibleCommands?.length ?? commandPanel?.commands?.length ?? 0;
  const commandPanelHeight = commandPanel === undefined
    ? 0
    : commandCount + (commandPanel.hasMore ? 2 : 1);
  const fileSuggestionCount = fileSuggestionPanel?.items?.length ?? 0;
  const fileSuggestionPanelHeight = fileSuggestionPanel === undefined
    ? 0
    : fileSuggestionCount + (fileSuggestionPanel.hasMore ? 2 : 1);
  const visibleDraft = toVisibleDraft(draft);
  const draftHeight = Math.min(4, estimateWrappedTextHeight(visibleDraft === "" ? " " : visibleDraft, Math.max(8, width - 8)));

  return Math.max(0, todoPanelLineCount) + commandPanelHeight + fileSuggestionPanelHeight + draftHeight + 3 + estimateBadgeLineHeight(width);
}

/**
 * Estimate the busy/status badge line height.
 */
export function estimateBadgeLineHeight(width: number): number {
  return width < 52 ? 2 : 1;
}

/**
 * Estimate wrapped plain-text height for a fixed-width terminal region.
 */
export function estimateWrappedTextHeight(value: string, width: number): number {
  const normalizedWidth = Math.max(1, width);
  const lines = value.split("\n");
  let total = 0;

  for (const line of lines) {
    const lineLength = Math.max(1, line.length);
    total += Math.max(1, Math.ceil(lineLength / normalizedWidth));
  }

  return Math.max(1, total);
}

function countPreviewLines(value: string): number {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length > 1 && lines.at(-1) === "") {
    return lines.length - 1;
  }

  return lines.length;
}
