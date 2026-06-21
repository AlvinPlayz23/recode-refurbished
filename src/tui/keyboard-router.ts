/**
 * Keyboard routing helpers for the main TUI.
 */

import type { QuestionToolDecision, ToolApprovalDecision } from "../tools/tool.ts";
import { applyFileSuggestionDraftValue, type FileSuggestionItem, type FileSuggestionPanelState } from "./file-suggestions.ts";
import { moveBuiltinCommandSelectionIndex, normalizeBuiltinCommandSelectionIndex } from "./message-format.ts";
import type { ActivePlanReviewRequest, PlanReviewDecision } from "./session/plan-review.ts";
import type { ActiveApprovalRequest, ActiveQuestionRequest, CustomizeRow } from "./tui-app-types.ts";

/**
 * Minimal key event shape used by the TUI keyboard router.
 */
export interface TuiKeyEvent {
  readonly name: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Command suggestions shown above the composer.
 */
export interface CommandPanelState {
  readonly commands: readonly { readonly command: string; readonly description: string }[];
  readonly visibleCommands: readonly { readonly command: string; readonly description: string }[];
  readonly hasMore: boolean;
  readonly visibleStartIndex: number;
  readonly selectedIndex: number;
  readonly visibleSelectedIndex: number;
  readonly selectedCommand: { readonly command: string; readonly description: string } | undefined;
  readonly totalCount: number;
}

/**
 * Handle an active question prompt.
 */
export function handleQuestionRequestKey(options: {
  readonly key: TuiKeyEvent;
  readonly request: ActiveQuestionRequest | undefined;
  readonly contextWindowRequest: boolean;
  readonly dismiss: (decision: QuestionToolDecision) => void;
  readonly submit: () => void;
  readonly moveQuestion: (direction: -1 | 1) => void;
  readonly moveOption: (direction: -1 | 1) => void;
  readonly toggleOption: () => void;
}): boolean {
  if (options.request === undefined) {
    return false;
  }

  if (options.contextWindowRequest) {
    switch (options.key.name) {
      case "escape":
        options.key.preventDefault();
        options.key.stopPropagation();
        options.dismiss({ dismissed: true });
        return true;
      case "return":
      case "enter":
        options.key.preventDefault();
        options.key.stopPropagation();
        options.submit();
        return true;
      default:
        options.key.stopPropagation();
        return true;
    }
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.dismiss({ dismissed: true });
      return true;
    case "left":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveQuestion(-1);
      return true;
    case "right":
    case "tab":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveQuestion(1);
      return true;
    case "up":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveOption(-1);
      return true;
    case "down":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveOption(1);
      return true;
    case "space":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.toggleOption();
      return true;
    case "return":
    case "enter":
      options.key.preventDefault();
      options.key.stopPropagation();
      if (options.key.shift) {
        options.toggleOption();
        return true;
      }
      options.submit();
      return true;
    default:
      options.key.stopPropagation();
      return true;
  }
}

/**
 * Handle an active tool approval prompt.
 */
export function handleToolApprovalKey(options: {
  readonly key: TuiKeyEvent;
  readonly request: ActiveApprovalRequest | undefined;
  readonly optionCount: number;
  readonly resolve: (decision: ToolApprovalDecision) => void;
  readonly moveSelected: (direction: -1 | 1) => void;
  readonly decisionAt: (index: number) => ToolApprovalDecision | undefined;
}): boolean {
  if (options.request === undefined) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.resolve("deny");
      return true;
    case "up":
      options.key.preventDefault();
      options.moveSelected(-1);
      return true;
    case "down":
      options.key.preventDefault();
      options.moveSelected(1);
      return true;
    case "return":
    case "enter": {
      options.key.preventDefault();
      const selectedIndex = normalizeBuiltinCommandSelectionIndex(
        options.request.selectedIndex,
        options.optionCount
      );
      options.resolve(options.decisionAt(selectedIndex) ?? "deny");
      return true;
    }
    default:
      return true;
  }
}

/**
 * Handle the plan review prompt.
 */
export function handlePlanReviewKey(options: {
  readonly key: TuiKeyEvent;
  readonly request: ActivePlanReviewRequest | undefined;
  readonly optionCount: number;
  readonly resolve: (decision: PlanReviewDecision) => void;
  readonly moveSelected: (direction: -1 | 1) => void;
  readonly decisionAt: (index: number) => PlanReviewDecision | undefined;
}): boolean {
  if (options.request === undefined) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.resolve("revise");
      return true;
    case "up":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveSelected(-1);
      return true;
    case "down":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.moveSelected(1);
      return true;
    case "return":
    case "enter": {
      options.key.preventDefault();
      options.key.stopPropagation();
      const selectedIndex = normalizeBuiltinCommandSelectionIndex(
        options.request.selectedIndex,
        options.optionCount
      );
      options.resolve(options.decisionAt(selectedIndex) ?? "revise");
      return true;
    }
    default:
      options.key.stopPropagation();
      return true;
  }
}

/**
 * Handle the global Shift+Tab session-mode toggle shortcut.
 */
export function handleSessionModeToggleKey(options: {
  readonly key: TuiKeyEvent;
  readonly enabled: boolean;
  readonly toggle: () => void;
}): boolean {
  if (!options.enabled || !options.key.shift || options.key.name !== "tab") {
    return false;
  }

  options.key.preventDefault();
  options.key.stopPropagation();
  options.toggle();
  return true;
}

/**
 * Handle a simple up/down/enter picker.
 */
export function handleLinearPickerKey(options: {
  readonly key: TuiKeyEvent;
  readonly open: boolean;
  readonly totalCount: number;
  readonly busy?: boolean;
  readonly close: () => void;
  readonly move: (direction: -1 | 1) => void;
  readonly submit: () => void;
}): boolean {
  if (!options.open) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.close();
      return true;
    case "up":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.move(-1);
      return true;
    case "down":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.move(1);
      return true;
    case "return":
    case "enter":
      if (options.busy === true) {
        return true;
      }
      options.key.preventDefault();
      options.submit();
      return true;
    default:
      return true;
  }
}

/**
 * Handle the provider manager picker.
 */
export function handleProviderPickerKey(options: {
  readonly key: TuiKeyEvent;
  readonly open: boolean;
  readonly totalCount: number;
  readonly close: () => void;
  readonly move: (direction: -1 | 1) => void;
  readonly submit: () => void;
  readonly toggle: () => void;
}): boolean {
  if (!options.open) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.close();
      return true;
    case "up":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.move(-1);
      return true;
    case "down":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.move(1);
      return true;
    case "space":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.toggle();
      return true;
    case "return":
    case "enter":
      if (options.totalCount <= 0) {
        return true;
      }
      options.key.preventDefault();
      options.submit();
      return true;
    default:
      return true;
  }
}

/**
 * Handle the customize picker, which has row cycling as well as selection.
 */
export function handleCustomizePickerKey(options: {
  readonly key: TuiKeyEvent;
  readonly open: boolean;
  readonly rows: readonly CustomizeRow[];
  readonly close: () => void;
  readonly moveRow: (direction: -1 | 1) => void;
  readonly cycle: (direction: -1 | 1) => void;
}): boolean {
  if (!options.open) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.close();
      return true;
    case "up":
      options.key.preventDefault();
      options.moveRow(-1);
      return true;
    case "down":
      options.key.preventDefault();
      options.moveRow(1);
      return true;
    case "left":
      options.key.preventDefault();
      options.cycle(-1);
      return true;
    case "right":
    case "space":
      options.key.preventDefault();
      options.cycle(1);
      return true;
    case "return":
    case "enter":
      options.key.preventDefault();
      options.close();
      return true;
    default:
      return true;
  }
}

/**
 * Handle keyboard navigation inside the @file suggestion panel.
 */
export function handleFileSuggestionPanelKey(options: {
  readonly key: TuiKeyEvent;
  readonly panel: FileSuggestionPanelState | undefined;
  readonly currentDraft: string;
  readonly setDraft: (value: string) => void;
  readonly setSelectionIndex: (value: number) => void;
  readonly setRenderableDraft: (value: string) => void;
  readonly focusPrompt: () => void;
}): boolean {
  const panel = options.panel;
  if (panel === undefined) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.setSelectionIndex(0);
      options.focusPrompt();
      return true;
    case "up":
      if (panel.items.length === 0) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.setSelectionIndex(moveBuiltinCommandSelectionIndex(panel.selectedIndex, panel.items.length, -1));
      options.focusPrompt();
      return true;
    case "down":
      if (panel.items.length === 0) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.setSelectionIndex(moveBuiltinCommandSelectionIndex(panel.selectedIndex, panel.items.length, 1));
      options.focusPrompt();
      return true;
    case "tab":
    case "return":
    case "enter":
      if (panel.selectedItem === undefined) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      applyFileSuggestionDraft({
        item: panel.selectedItem,
        currentDraft: options.currentDraft,
        setDraft: options.setDraft,
        setSelectionIndex: options.setSelectionIndex,
        setRenderableDraft: options.setRenderableDraft,
        focusPrompt: options.focusPrompt
      });
      return true;
    default:
      return false;
  }
}

/**
 * Handle keyboard navigation inside the slash-command suggestion panel.
 */
export function handleCommandPanelKey(options: {
  readonly key: TuiKeyEvent;
  readonly panel: CommandPanelState | undefined;
  readonly clearDraft: () => void;
  readonly setSelectionIndex: (value: number) => void;
  readonly applyCommand: (command: string) => void;
  readonly submitCommand: (command: string) => void;
  readonly focusPrompt: () => void;
}): boolean {
  const panel = options.panel;
  if (panel === undefined) {
    return false;
  }

  switch (options.key.name) {
    case "escape":
      options.key.preventDefault();
      options.key.stopPropagation();
      options.clearDraft();
      options.setSelectionIndex(0);
      options.focusPrompt();
      return true;
    case "up":
      if (panel.commands.length === 0) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.setSelectionIndex(moveBuiltinCommandSelectionIndex(panel.selectedIndex, panel.commands.length, -1));
      options.focusPrompt();
      return true;
    case "down":
      if (panel.commands.length === 0) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.setSelectionIndex(moveBuiltinCommandSelectionIndex(panel.selectedIndex, panel.commands.length, 1));
      options.focusPrompt();
      return true;
    case "tab":
      if (panel.selectedCommand === undefined) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.applyCommand(panel.selectedCommand.command);
      return true;
    case "return":
    case "enter":
      if (panel.selectedCommand === undefined) {
        return true;
      }
      options.key.preventDefault();
      options.key.stopPropagation();
      options.submitCommand(panel.selectedCommand.command);
      return true;
    default:
      return false;
  }
}

function applyFileSuggestionDraft(options: {
  readonly item: FileSuggestionItem;
  readonly currentDraft: string;
  readonly setDraft: (value: string) => void;
  readonly setSelectionIndex: (value: number) => void;
  readonly setRenderableDraft: (value: string) => void;
  readonly focusPrompt: () => void;
}): void {
  const nextDraft = applyFileSuggestionDraftValue(options.currentDraft, options.item);
  options.setDraft(nextDraft);
  options.setSelectionIndex(0);
  options.setRenderableDraft(nextDraft);
  options.focusPrompt();
}
