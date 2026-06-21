/**
 * Plain-text paste fallback handling for terminals that do not emit bracketed paste.
 */

import type { PendingPaste } from "./prompt-submission-controller.ts";
import { normalizeDraftInput, toVisibleDraft } from "./prompt-draft.ts";
import { setRenderableText, type PromptRenderable } from "./prompt-renderable.ts";

/** Options used by the plain-text paste fallback controller. */
export interface PlainTextPasteFallbackOptions {
  readonly getInput: () => PromptRenderable | undefined;
  readonly getDraft: () => string;
  readonly isBusy: () => boolean;
  readonly isModalOpen: () => boolean;
  readonly isCommandDraft: () => boolean;
  readonly addPendingPaste: (paste: PendingPaste) => void;
  readonly createPasteToken: (lineCount: number) => string;
  readonly syncDraftValue: (value: string) => void;
  readonly resetCommandSelection: () => void;
}

/** Controller for summarizing raw multiline paste chunks into compact placeholders. */
export interface PlainTextPasteFallbackController {
  readonly noteChunk: () => void;
  readonly shouldTreatReturnAsNewline: () => boolean;
  readonly summarize: () => void;
  readonly dispose: () => void;
}

/** Create a paste fallback controller. */
export function createPlainTextPasteFallback(
  options: PlainTextPasteFallbackOptions
): PlainTextPasteFallbackController {
  let startDraft: string | undefined;
  let lastChunkAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const summarize = () => {
    timer = undefined;
    const initialDraft = startDraft;
    startDraft = undefined;
    const input = options.getInput();

    if (initialDraft === undefined || input === undefined || options.isBusy() || options.isModalOpen() || options.isCommandDraft()) {
      return;
    }

    const nextDraft = normalizeDraftInput(options.getDraft(), input.plainText);
    if (!nextDraft.startsWith(initialDraft)) {
      return;
    }

    const pastedText = nextDraft.slice(initialDraft.length);
    const normalizedPastedText = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lineCount = normalizedPastedText.trimEnd() === ""
      ? 0
      : normalizedPastedText.trimEnd().split("\n").length;

    if (lineCount <= 1) {
      return;
    }

    const token = options.createPasteToken(lineCount);
    options.addPendingPaste({ token, text: normalizedPastedText });
    const nextVisibleDraft = `${initialDraft}${token} `;
    setRenderableText(input, toVisibleDraft(nextVisibleDraft));
    options.syncDraftValue(nextVisibleDraft);
    options.resetCommandSelection();
    input.focus();
  };

  const scheduleSummary = () => {
    clearTimer();
    timer = setTimeout(summarize, 90);
  };

  const noteChunk = () => {
    if (startDraft === undefined) {
      startDraft = options.getDraft();
    }
    lastChunkAt = Date.now();
    scheduleSummary();
  };

  return {
    noteChunk,
    shouldTreatReturnAsNewline() {
      return startDraft !== undefined && Date.now() - lastChunkAt < 120;
    },
    summarize,
    dispose() {
      clearTimer();
    }
  };
}
