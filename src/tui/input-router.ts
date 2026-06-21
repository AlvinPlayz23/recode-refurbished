/**
 * Paste and global keyboard routing for the main TUI.
 */

import type { ToolApprovalDecision } from "../tools/tool.ts";
import {
  handleCommandPanelKey,
  handleFileSuggestionPanelKey,
  handleLinearPickerKey,
  handlePlanReviewKey,
  handleProviderPickerKey,
  handleSessionModeToggleKey,
  handleToolApprovalKey,
  type CommandPanelState,
  type TuiKeyEvent
} from "./keyboard-router.ts";
import type { FileSuggestionPanelState } from "./file-suggestions.ts";
import { moveBuiltinCommandSelectionIndex } from "./message-format.ts";
import type { ActivePlanReviewRequest, PlanReviewDecision } from "./session/plan-review.ts";
import { normalizeDraftInput, toVisibleDraft } from "./composer/prompt-draft.ts";
import type { ActiveApprovalRequest } from "./tui-app-types.ts";

/** Minimal key event shape used by legacy pure routing helpers. */
export interface KeyEvent {
  readonly name: string;
  readonly sequence: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift?: boolean;
  readonly super?: boolean;
  readonly hyper?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function stripAnsiSequences(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

interface PromptInputForPaste {
  readonly plainText: string;
  insertText(text: string): void;
  focus(): void;
}

export interface PromptPasteEvent {
  preventDefault(): void;
  stopPropagation?(): void;
}

export interface PromptPasteHandlerOptions {
  readonly isBusy: () => boolean;
  readonly isModalOpen: () => boolean;
  readonly isCommandDraft: () => boolean;
  readonly getInput: () => PromptInputForPaste | undefined;
  readonly getDraft: () => string;
  readonly addPendingPaste: (paste: { readonly token: string; readonly text: string }) => void;
  readonly createPasteToken?: (lineCount: number) => string;
  readonly syncDraftValue: (value: string) => void;
  readonly resetCommandSelection: () => void;
}

export function createPromptPasteHandler(options: PromptPasteHandlerOptions) {
  let lastHandledPasteSignature = "";
  let lastHandledPasteAt = 0;
  let pasteCounter = 0;

  return (event: PromptPasteEvent, rawText: string): boolean => {
    const input = options.getInput();
    if (options.isBusy() || options.isModalOpen() || input === undefined || options.isCommandDraft()) {
      return false;
    }

    const normalizedText = normalizePastedText(stripAnsiSequences(rawText));
    const lineCount = countPastedLines(normalizedText.trimEnd());
    const shouldSummarize = lineCount > 1;

    if (!shouldSummarize) {
      return false;
    }

    const signature = `${normalizedText.length}:${lineCount}:${normalizedText.slice(0, 96)}`;
    const now = Date.now();
    if (lastHandledPasteSignature === signature && now - lastHandledPasteAt < 120) {
      event.preventDefault();
      event.stopPropagation?.();
      return true;
    }

    lastHandledPasteSignature = signature;
    lastHandledPasteAt = now;
    event.preventDefault();
    event.stopPropagation?.();

    pasteCounter += 1;
    const token = options.createPasteToken?.(lineCount) ?? `{Paste ${lineCount} lines #${pasteCounter}}`;
    options.addPendingPaste({ token, text: normalizedText });
    input.insertText(`${token} `);
    options.syncDraftValue(normalizeDraftInput(options.getDraft(), input.plainText));
    options.resetCommandSelection();
    input.focus();
    return true;
  };
}

export interface LinearPickerRoute {
  readonly open: () => boolean;
  readonly totalCount: () => number;
  readonly busy?: () => boolean;
  readonly close: () => void;
  readonly move: (direction: -1 | 1) => void;
  readonly submit: () => void;
}

export interface ProviderPickerRoute extends LinearPickerRoute {
  readonly toggle: () => void;
}

export interface InputRouterOptions {
  readonly handlePromptPaste: (event: PromptPasteEvent, rawText: string) => boolean;
  readonly handleCtrlC: (key: KeyEvent) => void;
  readonly handleToggleTodos: (key: KeyEvent) => void;
  readonly handleCycleChatView: (key: KeyEvent) => void;
  readonly handleGoToSubagentView: (key: KeyEvent) => void;
  readonly handleGoToParentView: (key: KeyEvent) => void;
  readonly handleToggleSessionMode: () => void;
  readonly handleCycleApprovalMode: (key: KeyEvent) => void;
  readonly handleQuestionKey: (key: KeyEvent) => boolean;
  readonly activePlanReviewRequest: () => ActivePlanReviewRequest | undefined;
  readonly resolvePlanReviewRequest: (decision: PlanReviewDecision) => void;
  readonly setActivePlanReviewRequest: (updater: (current: ActivePlanReviewRequest | undefined) => ActivePlanReviewRequest | undefined) => void;
  readonly planReviewOptionCount: number;
  readonly planReviewDecisionAt: (index: number) => PlanReviewDecision | undefined;
  readonly activeApprovalRequest: () => ActiveApprovalRequest | undefined;
  readonly resolveApprovalRequest: (decision: ToolApprovalDecision) => void;
  readonly setActiveApprovalRequest: (updater: (current: ActiveApprovalRequest | undefined) => ActiveApprovalRequest | undefined) => void;
  readonly approvalDecisionCount: number;
  readonly approvalDecisionAt: (index: number) => ToolApprovalDecision | undefined;
  readonly approvalModePicker: LinearPickerRoute;
  readonly layoutPicker: LinearPickerRoute;
  readonly customizePicker: {
    readonly handle: (key: KeyEvent) => boolean;
  };
  readonly themePicker: LinearPickerRoute;
  readonly historyPicker: LinearPickerRoute;
  readonly providerPicker: ProviderPickerRoute;
  readonly modelPicker: LinearPickerRoute;
  readonly todoDropupOpen: () => boolean;
  readonly closeTodoDropup: () => void;
  readonly handleToggleToolPreviews: (key: TuiKeyEvent) => void;
  readonly focusPrompt: () => void;
  readonly isBusy: () => boolean;
  readonly abortActiveRun: () => void;
  readonly fileSuggestionPanel: () => FileSuggestionPanelState | undefined;
  readonly commandPanel: () => CommandPanelState | undefined;
  readonly getDraft: () => string;
  readonly setDraft: (value: string) => void;
  readonly setFileSuggestionSelectionIndex: (value: number) => void;
  readonly setCommandSelectionIndex: (value: number) => void;
  readonly setRenderableDraft: (value: string) => void;
  readonly clearPromptDraft: () => void;
  readonly applyCommandDraft: (command: string) => void;
  readonly submitPrompt: (value: string) => void;
}

export function getPastedTextFromKeySequence(key: Pick<KeyEvent, "sequence">): string | undefined {
  const sequence = key.sequence;
  if (sequence === "") {
    return undefined;
  }

  const bracketedPasteText = extractBracketedPasteText(sequence);
  if (bracketedPasteText !== undefined) {
    return bracketedPasteText;
  }

  const normalizedSequence = normalizePastedText(sequence);
  return countPastedLines(normalizedSequence.trimEnd()) > 1 ? normalizedSequence : undefined;
}

export function isLikelyPlainTextPasteChunk(key: Pick<KeyEvent, "ctrl" | "meta" | "sequence"> & { readonly super?: boolean; readonly hyper?: boolean }): boolean {
  if (key.ctrl || key.meta || key.super === true || key.hyper === true) {
    return false;
  }

  const sequence = key.sequence;
  if (sequence.length < 8) {
    return false;
  }

  const firstCharCode = sequence.charCodeAt(0);
  return firstCharCode >= 32 && firstCharCode !== 127;
}

export function registerTuiInputHandlers(options: InputRouterOptions): void {
  void options;
  // pi-tui owns raw keyboard and bracketed-paste handling in the new runtime.
}

function handleLinearRoute(key: TuiKeyEvent, route: LinearPickerRoute): boolean {
  return handleLinearPickerKey({
    key,
    open: route.open(),
    totalCount: route.totalCount(),
    ...(route.busy === undefined ? {} : { busy: route.busy() }),
    close: route.close,
    move: route.move,
    submit: route.submit
  });
}

function handleProviderRoute(key: TuiKeyEvent, route: ProviderPickerRoute): boolean {
  return handleProviderPickerKey({
    key,
    open: route.open(),
    totalCount: route.totalCount(),
    close: route.close,
    move: route.move,
    submit: route.submit,
    toggle: route.toggle
  });
}

function handleFileSuggestionKey(
  key: TuiKeyEvent,
  panel: FileSuggestionPanelState | undefined,
  options: InputRouterOptions
): boolean {
  return handleFileSuggestionPanelKey({
    key,
    panel,
    currentDraft: options.getDraft(),
    setDraft: options.setDraft,
    setSelectionIndex: options.setFileSuggestionSelectionIndex,
    setRenderableDraft(value) {
      options.setRenderableDraft(toVisibleDraft(value));
    },
    focusPrompt: options.focusPrompt
  });
}

function handleCommandKey(
  key: TuiKeyEvent,
  panel: CommandPanelState | undefined,
  options: InputRouterOptions
): boolean {
  return handleCommandPanelKey({
    key,
    panel,
    clearDraft: options.clearPromptDraft,
    setSelectionIndex: options.setCommandSelectionIndex,
    applyCommand: options.applyCommandDraft,
    submitCommand(command) {
      options.submitPrompt(command);
    },
    focusPrompt: options.focusPrompt
  });
}

function countPastedLines(value: string): number {
  if (value === "") {
    return 0;
  }

  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length;
}

function normalizePastedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractBracketedPasteText(value: string): string | undefined {
  const start = value.indexOf("\x1b[200~");
  const end = value.indexOf("\x1b[201~", start + 1);
  if (start < 0 || end < 0 || end <= start) {
    return undefined;
  }

  return value.slice(start + "\x1b[200~".length, end);
}
