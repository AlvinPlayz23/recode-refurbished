/**
 * Context-window prompting and transcript compaction flow for TUI sessions.
 */

import {
  DEFAULT_FALLBACK_CONTEXT_WINDOW_TOKENS,
  assertConversationFitsContextWindow,
  compactConversation,
  createCompactionSessionSnapshot,
  estimateConversationContextTokens,
  evaluateAutoCompaction,
  microcompactToolResults,
  type ContextTokenEstimate
} from "../../agent/compact-conversation.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  setConfiguredModelContextWindow
} from "../../config/recode-config.ts";
import type { AiModel } from "../../ai/types.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { QuestionToolDecision, QuestionToolRequest } from "../../tools/tool.ts";
import {
  setRuntimeModelContextWindow,
  type RuntimeConfig
} from "../../runtime/runtime-config.ts";
import {
  buildContextWindowFallbackKey,
  buildContextWindowStatusSnapshot,
  type ContextWindowStatusSnapshot
} from "../builtin-command-content.ts";
import {
  appendEntry,
  createEntry,
  type SetUiEntries
} from "../transcript/transcript-entry-state.ts";
import { persistConversationSession } from "./conversation-session.ts";
import type { SessionMode } from "./session-mode.ts";

/** Interactive question requester used by context-window prompts. */
export interface ContextWindowQuestionRequester {
  (request: QuestionToolRequest): Promise<QuestionToolDecision>;
}

/** Dependencies for the context-window and compaction flow. */
export interface ContextWindowFlowOptions {
  readonly getRuntimeConfig: () => RuntimeConfig;
  readonly setRuntimeConfig: (value: RuntimeConfig) => void;
  readonly getContextWindowFallbacks: () => Readonly<Record<string, number>>;
  readonly getLastContextEstimate: () => ContextTokenEstimate | undefined;
  readonly setLastContextEstimate: (value: ContextTokenEstimate) => void;
  readonly getPreviousMessages: () => readonly ConversationMessage[];
  readonly setTranscriptMessages: (value: readonly ConversationMessage[]) => void;
  readonly getLanguageModel: () => AiModel;
  readonly getHistoryRoot: () => string;
  readonly getCurrentConversation: () => SavedConversationRecord | undefined;
  readonly setCurrentConversation: (value: SavedConversationRecord) => void;
  readonly getSessionMode: () => SessionMode;
  readonly getSubagentTasks: () => readonly SubagentTaskRecord[];
  readonly getSessionEvents: () => readonly SessionEvent[];
  readonly setSessionEvents: (value: readonly SessionEvent[]) => void;
  readonly setEntries: SetUiEntries;
  readonly requestQuestionAnswers: ContextWindowQuestionRequester;
}

/** Context-window flow API used by the TUI app shell. */
export interface ContextWindowFlow {
  readonly resolveCurrentContextWindowStatus: () => ContextWindowStatusSnapshot;
  readonly requestActiveModelContextWindow: (mode: "automatic" | "manual") => Promise<ContextWindowStatusSnapshot>;
  readonly ensureActiveModelContextWindow: () => Promise<ContextWindowStatusSnapshot>;
  readonly prepareTranscriptForPendingPrompt: (
    pendingPrompt: string,
    abortSignal: AbortSignal
  ) => Promise<readonly ConversationMessage[]>;
}

/** Build context-window and compaction operations around TUI session state. */
export function createContextWindowFlow(options: ContextWindowFlowOptions): ContextWindowFlow {
  const resolveCurrentContextWindowStatus = () => buildContextWindowStatusSnapshot(
    options.getRuntimeConfig(),
    options.getContextWindowFallbacks(),
    options.getLastContextEstimate()
  );

  const persistModelContextWindow = (
    providerId: string,
    modelId: string,
    contextWindowTokens: number
  ): RuntimeConfig => {
    const runtimeConfig = options.getRuntimeConfig();
    const config = loadRecodeConfigFile(runtimeConfig.configPath);
    const nextConfig = setConfiguredModelContextWindow(config, providerId, modelId, contextWindowTokens);
    saveRecodeConfigFile(runtimeConfig.configPath, nextConfig);
    const nextRuntimeConfig = setRuntimeModelContextWindow(runtimeConfig, providerId, modelId, contextWindowTokens);
    options.setRuntimeConfig(nextRuntimeConfig);
    return nextRuntimeConfig;
  };

  const requestActiveModelContextWindow = async (
    mode: "automatic" | "manual"
  ): Promise<ContextWindowStatusSnapshot> => {
    const configuredStatus = resolveCurrentContextWindowStatus();
    if (mode === "automatic" && configuredStatus.source === "configured") {
      return configuredStatus;
    }

    const runtimeConfig = options.getRuntimeConfig();
    const modelKey = buildContextWindowFallbackKey(runtimeConfig.providerId, runtimeConfig.model);
    const existingFallback = options.getContextWindowFallbacks()[modelKey];
    if (mode === "automatic" && existingFallback !== undefined) {
      return resolveCurrentContextWindowStatus();
    }

    const decision = await options.requestQuestionAnswers({
      questions: [
        {
          id: mode === "manual" ? "context-window-config" : "context-window",
          header: "Context Window",
          question: mode === "manual"
            ? `Set the context window for '${runtimeConfig.model}'. Current value: ${configuredStatus.contextWindowTokens.toLocaleString()} tokens (${configuredStatus.source}).`
            : `Recode does not know the context window for '${runtimeConfig.model}'. Enter it if you know it, or save the conservative 200k fallback.`,
          multiSelect: false,
          allowCustomText: true,
          options: [
            {
              label: "Save 200k fallback",
              description: "Auto-compaction stays conservative until you replace this with the real model limit."
            }
          ]
        }
      ]
    });

    const saveContextWindow = (contextWindowTokens: number, message: string): ContextWindowStatusSnapshot => {
      const nextRuntimeConfig = persistModelContextWindow(runtimeConfig.providerId, runtimeConfig.model, contextWindowTokens);
      appendEntry(options.setEntries, createEntry("status", "status", message));
      return buildContextWindowStatusSnapshot(
        nextRuntimeConfig,
        options.getContextWindowFallbacks(),
        options.getLastContextEstimate()
      );
    };

    if (decision.dismissed) {
      if (mode === "manual") {
        appendEntry(options.setEntries, createEntry("status", "status", `Context window unchanged for ${runtimeConfig.model}.`));
        return configuredStatus;
      }

      return saveContextWindow(
        DEFAULT_FALLBACK_CONTEXT_WINDOW_TOKENS,
        `Saved the conservative 200k context-window fallback for ${runtimeConfig.model}. Change it later with /context-window.`
      );
    }

    const answer = decision.answers[0];
    const customValue = answer?.customText.trim() ?? "";
    const parsedValue = Number.parseInt(customValue, 10);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return saveContextWindow(
        parsedValue,
        `Saved a ${parsedValue.toLocaleString()} token context window for ${runtimeConfig.model}`
      );
    }

    return saveContextWindow(
      DEFAULT_FALLBACK_CONTEXT_WINDOW_TOKENS,
      customValue === ""
        ? `Saved the conservative 200k context-window fallback for ${runtimeConfig.model}.`
        : `Could not parse '${customValue}' as a positive integer, so Recode saved the conservative 200k context-window fallback for ${runtimeConfig.model}.`
    );
  };

  const ensureActiveModelContextWindow = async (): Promise<ContextWindowStatusSnapshot> => {
    return requestActiveModelContextWindow("automatic");
  };

  const prepareTranscriptForPendingPrompt = async (
    pendingPrompt: string,
    abortSignal: AbortSignal
  ): Promise<readonly ConversationMessage[]> => {
    const contextWindowStatus = await ensureActiveModelContextWindow();
    const previousMessages = options.getPreviousMessages();
    const microcompacted = microcompactToolResults(previousMessages);
    const effectiveTranscript = microcompacted.kind === "compacted"
      ? microcompacted.transcript
      : previousMessages;

    if (microcompacted.kind === "compacted") {
      options.setTranscriptMessages(microcompacted.transcript);
      const persistedConversation = persistConversationSession(
        options.getHistoryRoot(),
        options.getRuntimeConfig(),
        microcompacted.transcript,
        options.getCurrentConversation(),
        options.getSessionMode(),
        options.getSubagentTasks(),
        undefined,
        options.getSessionEvents()
      );
      options.setCurrentConversation(persistedConversation);
      appendEntry(
        options.setEntries,
        createEntry(
          "status",
          "status",
          `Microcompacted ${microcompacted.compactedToolResultCount} old tool result${microcompacted.compactedToolResultCount === 1 ? "" : "s"}`
        )
      );
    }

    const estimateBefore = estimateConversationContextTokens(effectiveTranscript, pendingPrompt);
    options.setLastContextEstimate(estimateBefore);

    const compactionDecision = evaluateAutoCompaction(
      estimateBefore,
      contextWindowStatus.contextWindowTokens,
      options.getLanguageModel().maxOutputTokens
    );

    if (!compactionDecision.shouldCompact) {
      return effectiveTranscript;
    }

    const compacted = await compactConversation({
      transcript: effectiveTranscript,
      languageModel: options.getLanguageModel(),
      abortSignal
    });

    if (compacted.kind === "noop") {
      throw new Error(
        "This session is near the context limit, but there is not enough older history to compact yet. Try a shorter prompt, compact later, or configure a larger context window for this model."
      );
    }

    options.setTranscriptMessages(compacted.transcript);
    const snapshot = createCompactionSessionSnapshot(effectiveTranscript, compacted, "auto");
    const nextSnapshots = [...(options.getCurrentConversation()?.sessionSnapshots ?? []), snapshot];
    const compactedEvent: SessionEvent = {
      type: "session.compacted",
      timestamp: Date.now(),
      content: compacted.summaryMessage.content
    };
    const nextSessionEvents = [...options.getSessionEvents(), compactedEvent];
    options.setSessionEvents(nextSessionEvents);
    const persistedConversation = persistConversationSession(
      options.getHistoryRoot(),
      options.getRuntimeConfig(),
      compacted.transcript,
      options.getCurrentConversation(),
      options.getSessionMode(),
      options.getSubagentTasks(),
      nextSnapshots,
      nextSessionEvents
    );
    options.setCurrentConversation(persistedConversation);
    appendEntry(
      options.setEntries,
      createEntry(
        "status",
        "status",
        `Auto-compacted ${compacted.compactedMessageCount} older message${compacted.compactedMessageCount === 1 ? "" : "s"} into a continuation summary`
      )
    );

    const estimateAfter = assertConversationFitsContextWindow(
      compacted.transcript,
      pendingPrompt,
      contextWindowStatus.contextWindowTokens,
      options.getLanguageModel().maxOutputTokens
    );
    options.setLastContextEstimate(estimateAfter);
    return compacted.transcript;
  };

  return {
    resolveCurrentContextWindowStatus,
    requestActiveModelContextWindow,
    ensureActiveModelContextWindow,
    prepareTranscriptForPendingPrompt
  };
}
