/**
 * Prompt-run input shaping helpers.
 */

import { buildPlanModeModelPrompt } from "./plan-review.ts";
import { expandDraftPastes, type PendingPaste } from "../composer/prompt-submission-controller.ts";
import type { SessionMode } from "./session-mode.ts";

/** Inputs needed to prepare a submitted prompt for a model request. */
export interface BuildPromptRunInputOptions {
  readonly prompt: string;
  readonly pendingPastes: readonly PendingPaste[];
  readonly sessionMode: SessionMode;
  readonly remindAboutPlanTags: boolean;
  readonly remindAboutPlanRevision: boolean;
}

/** Prompt strings used by one prompt run. */
export interface PromptRunInput {
  readonly prompt: string;
  readonly expandedPrompt: string;
  readonly modelPrompt: string;
}

/** Build the user-visible prompt and the model prompt for one run. */
export function buildPromptRunInput(options: BuildPromptRunInputOptions): PromptRunInput {
  const expandedPrompt = expandDraftPastes(options.prompt, options.pendingPastes);
  const modelPrompt = options.sessionMode === "plan"
    ? buildPlanModeModelPrompt(expandedPrompt, {
        remindAboutPlanTags: options.remindAboutPlanTags,
        remindAboutPlanRevision: options.remindAboutPlanRevision
      })
    : expandedPrompt;

  return {
    prompt: options.prompt,
    expandedPrompt,
    modelPrompt
  };
}
