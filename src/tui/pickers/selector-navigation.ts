/**
 * Shared selector-navigation helpers for TUI picker overlays.
 */

import type { HistoryPickerItem } from "./history-picker.ts";
import {
  moveBuiltinCommandSelectionIndex,
  normalizeBuiltinCommandSelectionIndex
} from "../message-format.ts";
import type { ModelPickerOption } from "../tui-app-types.ts";

const HISTORY_PICKER_ITEM_ROW_HEIGHT = 2;
const PROVIDER_PICKER_ITEM_ROW_HEIGHT = 3;

interface ScrollBoxLike {
  scrollChildIntoView(childId: string): void;
}

/**
 * One rendered line in the model picker.
 */
export interface ModelPickerRenderedLine {
  readonly kind: "group" | "option";
  readonly text: string;
  readonly selected: boolean;
}

/**
 * Render grouped model-picker lines from flat model options.
 */
export function renderModelPickerLines(
  options: readonly ModelPickerOption[],
  selectedIndex: number
): readonly ModelPickerRenderedLine[] {
  const lines: ModelPickerRenderedLine[] = [];
  let cursor = 0;
  let currentProviderId: string | undefined;

  for (const option of options) {
    if (option.providerId !== currentProviderId) {
      currentProviderId = option.providerId;
      lines.push({
        kind: "group",
        text: option.providerActive ? `${option.providerName} (active provider)` : option.providerName,
        selected: false
      });
    }

    const activeSuffix = option.active ? " (active)" : "";
    const prefix = cursor === selectedIndex ? "›" : " ";
    const body = option.custom
      ? `Custom ID: ${option.modelId}`
      : option.modelId;

    lines.push({
      kind: "option",
      text: `${prefix} ${body}${activeSuffix}`,
      selected: cursor === selectedIndex
    });
    cursor += 1;
  }

  return lines;
}

/**
 * Build a stable DOM id for a selector child.
 */
export function getIndexedPickerChildId(prefix: string, index: number, totalCount: number): string {
  const normalizedIndex = totalCount <= 0
    ? 0
    : normalizeBuiltinCommandSelectionIndex(index, totalCount);
  return `${prefix}-${normalizedIndex}`;
}

/**
 * Scroll the active selector child into view when a picker is open.
 */
export function syncScrollBoxSelection(
  open: boolean,
  scrollBox: ScrollBoxLike | undefined,
  childId: string
): void {
  if (!open || scrollBox === undefined) {
    return;
  }

  scrollBox.scrollChildIntoView(childId);
}

/**
 * Build a remount key for the history picker list.
 */
export function buildHistoryPickerRenderKey(
  items: readonly HistoryPickerItem[],
  query: string
): string {
  return `${query}\u0000${items.map((item) => item.id).join("\u0000")}`;
}

/**
 * Update a simple linear selector's selected row and visible window.
 */
export function updateLinearSelectorWindow(options: {
  readonly selectedIndex: number;
  readonly totalCount: number;
  readonly direction: -1 | 1;
  readonly visibleCount: number;
  readonly windowStart: number;
  readonly setSelectedIndex: (value: number) => void;
  readonly setWindowStart: (value: number) => void;
}): void {
  const nextSelectedIndex = moveBuiltinCommandSelectionIndex(
    options.selectedIndex,
    options.totalCount,
    options.direction
  );
  options.setSelectedIndex(nextSelectedIndex);
  options.setWindowStart(adjustWindowStart(
    options.windowStart,
    nextSelectedIndex,
    options.visibleCount,
    options.totalCount
  ));
}

/**
 * Update the model picker's selected row and visible window.
 */
export function updateModelPickerWindow(options: {
  readonly direction: -1 | 1;
  readonly options: readonly ModelPickerOption[];
  readonly selectedIndex: number;
  readonly totalCount: number;
  readonly visibleCount: number;
  readonly windowStart: number;
  readonly setSelectedIndex: (value: number) => void;
  readonly setWindowStart: (value: number) => void;
}): void {
  const nextSelectedIndex = moveBuiltinCommandSelectionIndex(
    options.selectedIndex,
    options.totalCount,
    options.direction
  );
  const renderedLines = renderModelPickerLines(options.options, nextSelectedIndex);
  const selectedLineIndex = findSelectedRenderedLineIndex(renderedLines);

  options.setSelectedIndex(nextSelectedIndex);
  options.setWindowStart(adjustWindowStart(
    options.windowStart,
    selectedLineIndex,
    options.visibleCount,
    renderedLines.length
  ));
}

/**
 * Return the number of model-picker rows that fit in the current terminal.
 */
export function getModelPickerVisibleCount(terminalHeight: number): number {
  return Math.max(8, Math.min(terminalHeight - 18, 16));
}

/**
 * Return the history-picker popup height budget.
 */
export function getHistoryPickerPopupRowBudget(terminalHeight: number): number {
  return Math.max(8, Math.min(terminalHeight - 18, 16));
}

/**
 * Return the number of visible history-picker items that fit vertically.
 */
export function getHistoryPickerVisibleCount(terminalHeight: number): number {
  return Math.max(1, Math.floor(getHistoryPickerPopupRowBudget(terminalHeight) / HISTORY_PICKER_ITEM_ROW_HEIGHT));
}

/**
 * Convert a history-picker window start into the scrollbox line offset.
 */
export function getHistoryPickerScrollOffset(windowStart: number): number {
  return Math.max(0, windowStart) * HISTORY_PICKER_ITEM_ROW_HEIGHT;
}

/**
 * Return the theme-picker popup height budget.
 */
export function getThemePickerPopupRowBudget(terminalHeight: number): number {
  return Math.max(6, Math.min(terminalHeight - 18, 12));
}

/**
 * Return the number of visible theme-picker items that fit vertically.
 */
export function getThemePickerVisibleCount(terminalHeight: number): number {
  return Math.max(1, Math.floor(getThemePickerPopupRowBudget(terminalHeight) / 3));
}

/**
 * Return the approval-mode picker popup height budget.
 */
export function getApprovalModePickerPopupRowBudget(terminalHeight: number): number {
  return Math.max(5, Math.min(terminalHeight - 18, 10));
}

/**
 * Return the number of visible approval-mode items that fit vertically.
 */
export function getApprovalModePickerVisibleCount(terminalHeight: number): number {
  return Math.max(1, Math.floor(getApprovalModePickerPopupRowBudget(terminalHeight) / 3));
}

/**
 * Return the provider-picker popup height budget.
 */
export function getProviderPickerPopupRowBudget(terminalHeight: number): number {
  return Math.max(6, Math.min(terminalHeight - 18, 14));
}

/**
 * Return the number of visible provider rows that fit vertically.
 */
export function getProviderPickerVisibleCount(terminalHeight: number): number {
  return Math.max(1, Math.floor(getProviderPickerPopupRowBudget(terminalHeight) / PROVIDER_PICKER_ITEM_ROW_HEIGHT));
}

/**
 * Return the layout-picker popup height budget.
 */
export function getLayoutPickerPopupRowBudget(terminalHeight: number): number {
  return Math.max(5, Math.min(terminalHeight - 18, 12));
}

/**
 * Return the number of visible layout-picker items that fit vertically.
 */
export function getLayoutPickerVisibleCount(terminalHeight: number): number {
  return Math.max(1, Math.floor(getLayoutPickerPopupRowBudget(terminalHeight) / 3));
}

function findSelectedRenderedLineIndex(lines: readonly ModelPickerRenderedLine[]): number {
  const selectedIndex = lines.findIndex((line) => line.selected);
  return selectedIndex === -1 ? 0 : selectedIndex;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function adjustWindowStart(
  currentStart: number,
  selectedIndex: number,
  visibleCount: number,
  totalCount: number
): number {
  const normalizedVisibleCount = Math.max(1, visibleCount);
  const maxStartIndex = Math.max(0, totalCount - normalizedVisibleCount);

  if (selectedIndex < currentStart) {
    return clampNumber(selectedIndex, 0, maxStartIndex);
  }

  if (selectedIndex >= currentStart + normalizedVisibleCount) {
    return clampNumber(selectedIndex - normalizedVisibleCount + 1, 0, maxStartIndex);
  }

  return clampNumber(currentStart, 0, maxStartIndex);
}
