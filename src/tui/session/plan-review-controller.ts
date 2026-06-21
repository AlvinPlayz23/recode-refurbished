/**
 * Plan-review request resolution helpers for the TUI.
 */

import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import {
  appendEntry,
  createEntry,
  type SetUiEntries
} from "../transcript/transcript-entry-state.ts";
import { persistConversationSession } from "./conversation-session.ts";
import {
  buildPlanImplementationPrompt,
  type ActivePlanReviewRequest,
  type PlanReviewDecision
} from "./plan-review.ts";
import type { SessionMode } from "./session-mode.ts";

/** Dependencies for plan-review request resolution. */
export interface PlanReviewControllerOptions {
  readonly getActivePlanReviewRequest: () => ActivePlanReviewRequest | undefined;
  readonly setActivePlanReviewRequest: (value: ActivePlanReviewRequest | undefined) => void;
  readonly setPendingPlanTagFormatReminder: (value: boolean) => void;
  readonly setPendingPlanRevisionReminder: (value: boolean) => void;
  readonly setSessionMode: (value: SessionMode) => void;
  readonly historyRoot: () => string;
  readonly getRuntimeConfig: () => RuntimeConfig;
  readonly getTranscript: () => readonly ConversationMessage[];
  readonly getCurrentConversation: () => SavedConversationRecord | undefined;
  readonly setCurrentConversation: (value: SavedConversationRecord) => void;
  readonly getSubagentTasks: () => readonly SubagentTaskRecord[];
  readonly setEntries: SetUiEntries;
  readonly focusPrompt: () => void;
  readonly submitPrompt: (value: string) => void;
}

/** Create a resolver for active plan-review requests. */
export function createPlanReviewController(options: PlanReviewControllerOptions): {
  readonly resolvePlanReviewRequest: (decision: PlanReviewDecision) => void;
} {
  return {
    resolvePlanReviewRequest(decision) {
      const request = options.getActivePlanReviewRequest();
      if (request === undefined) {
        return;
      }

      options.setActivePlanReviewRequest(undefined);

      if (decision === "revise") {
        options.setPendingPlanRevisionReminder(true);
        appendEntry(
          options.setEntries,
          createEntry("status", "status", "Still in PLAN mode \u2014 tell Recode what to adjust.")
        );
        options.focusPrompt();
        return;
      }

      options.setPendingPlanTagFormatReminder(false);
      options.setPendingPlanRevisionReminder(false);
      options.setSessionMode("build");
      const persistedConversation = persistConversationSession(
        options.historyRoot(),
        options.getRuntimeConfig(),
        options.getTranscript(),
        options.getCurrentConversation(),
        "build",
        options.getSubagentTasks()
      );
      options.setCurrentConversation(persistedConversation);
      appendEntry(
        options.setEntries,
        createEntry("status", "status", "Plan approved \u2014 switched to BUILD mode")
      );

      queueMicrotask(() => {
        options.submitPrompt(buildPlanImplementationPrompt());
      });
    }
  };
}
