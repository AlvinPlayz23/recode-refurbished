/**
 * Built-in slash-command dispatch for the TUI.
 */

import type { AiModel } from "../ai/types.ts";
import type { SubagentTaskHandler, SubagentTaskRecord } from "../agent/subagent.ts";
import {
  compactConversation,
  createCompactionSessionSnapshot,
  estimateConversationContextTokens,
  type ContextTokenEstimate
} from "../agent/compact-conversation.ts";
import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  selectConfiguredMinimalMode
} from "../config/recode-config.ts";
import { hasAgentsMd } from "../prompt/agents-md.ts";
import { exportConversationToHtml, exportConversationToMarkdown } from "../history/export-html.ts";
import type { SavedConversationRecord } from "../history/recode-history.ts";
import type { SessionEvent } from "../session/session-event.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import type { ConversationMessage } from "../transcript/message.ts";
import {
  INIT_COMMAND_PROMPT,
} from "../prompt/init-command-prompt.ts";
import {
  buildBuiltinConfigBody,
  buildBuiltinHelpBody,
  buildBuiltinMemoryBody,
  buildBuiltinStatusBody,
  type ContextWindowStatusSnapshot
} from "./builtin-command-content.ts";
import {
  createDraftConversation,
  forkConversationSession,
  persistConversationSession
} from "./session/conversation-session.ts";
import {
  parseBuiltinCommand,
  type BuiltinCommandName
} from "./message-format.ts";
import { getSessionModeLabel, type SessionMode } from "./session/session-mode.ts";
import type { SpinnerPhase } from "./appearance/spinner.ts";
import type {
  ThemeName,
  ToolMarkerName
} from "./appearance/theme.ts";
import {
  createEntry,
  type UiEntry
} from "./transcript/transcript-entry-state.ts";

/**
 * Result of slash-command dispatch.
 */
export type BuiltinCommandDispatchResult =
  | {
      readonly kind: "handled";
    }
  | {
      readonly kind: "not-command";
      readonly prompt: string;
    };

/**
 * Minimal state/actions needed to change the current session mode.
 */
export interface SessionModeCommandOptions {
  readonly sessionMode: SessionMode;
  readonly historyRoot: string;
  readonly runtimeConfig: RuntimeConfig;
  readonly transcript: readonly ConversationMessage[];
  readonly subagentTasks: readonly SubagentTaskRecord[];
  readonly currentConversation: SavedConversationRecord | undefined;
  readonly setSessionMode: (value: SessionMode) => void;
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly appendEntry: (entry: UiEntry) => void;
}

/**
 * Callbacks and state needed to execute built-in TUI commands.
 */
export interface BuiltinCommandDispatchOptions {
  readonly value: string;
  readonly busy: boolean;
  readonly runtimeConfig: RuntimeConfig;
  readonly languageModel: AiModel;
  readonly themeName: ThemeName;
  readonly toolMarkerName: ToolMarkerName;
  readonly sessionMode: SessionMode;
  readonly minimalMode: boolean;
  readonly retainBashToolOutput: boolean;
  readonly entriesCount: number;
  readonly entries: readonly UiEntry[];
  readonly sessionEvents: readonly SessionEvent[];
  readonly maxRetainedUiEntries: number;
  readonly maxRetainedSessionEvents: number;
  readonly toolCharacters: number;
  readonly transcript: readonly ConversationMessage[];
  readonly subagentTasks: readonly SubagentTaskRecord[];
  readonly contextWindowStatus: ContextWindowStatusSnapshot;
  readonly historyRoot: string;
  readonly currentConversation: SavedConversationRecord | undefined;
  readonly clearPromptDraft: () => void;
  readonly exitApp: () => void;
  readonly focusPrompt: () => void;
  readonly openModelPicker: () => Promise<void>;
  readonly openProviderPicker: () => void;
  readonly openHistoryPicker: () => Promise<void>;
  readonly openThemePicker: () => void;
  readonly openCustomizePicker: () => void;
  readonly toggleTodoPanel: () => void;
  readonly openContextWindowPrompt: () => Promise<void>;
  readonly openApprovalModePicker: () => void;
  readonly openLayoutPicker: () => void;
  readonly setMinimalMode: (value: boolean) => void;
  readonly setSessionMode: (value: SessionMode) => void;
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly setEntries: (value: readonly UiEntry[]) => void;
  readonly setPreviousMessages: (value: readonly ConversationMessage[]) => void;
  readonly setSessionEvents?: (value: readonly SessionEvent[]) => void;
  readonly setSubagentTasks: (value: readonly SubagentTaskRecord[]) => void;
  readonly setLastContextEstimate: (value: ContextTokenEstimate | undefined) => void;
  readonly setStreamingBody: (value: string) => void;
  readonly setStreamingEntryId: (value: string | undefined) => void;
  readonly setBusy: (value: boolean) => void;
  readonly setBusyPhase: (value: SpinnerPhase) => void;
  readonly runSubagentTask: SubagentTaskHandler;
  readonly appendEntry: (entry: UiEntry) => void;
}

/**
 * Parse and execute a built-in command. Non-command prompts are returned to the caller.
 */
export async function dispatchBuiltinCommand(
  options: BuiltinCommandDispatchOptions
): Promise<BuiltinCommandDispatchResult> {
  const prompt = options.value.trim();
  const builtinCommand = parseBuiltinCommand(prompt);

  if (prompt === "" || prompt === "/") {
    return { kind: "handled" };
  }

  if (builtinCommand?.name === "exit" || builtinCommand?.name === "quit") {
    options.clearPromptDraft();
    options.exitApp();
    return { kind: "handled" };
  }

  if (options.busy) {
    return { kind: "handled" };
  }

  if (builtinCommand === undefined) {
    return { kind: "not-command", prompt };
  }

  options.clearPromptDraft();
  await executeBuiltinCommand(builtinCommand.name, options);
  return { kind: "handled" };
}

async function executeBuiltinCommand(
  commandName: BuiltinCommandName,
  options: BuiltinCommandDispatchOptions
): Promise<void> {
  switch (commandName) {
    case "models":
      await options.openModelPicker();
      return;
    case "provider":
      options.openProviderPicker();
      return;
    case "history":
      await options.openHistoryPicker();
      return;
    case "theme":
      options.openThemePicker();
      return;
    case "customize":
    case "settings":
      options.openCustomizePicker();
      return;
    case "todos":
      options.toggleTodoPanel();
      return;
    case "context-window":
      await options.openContextWindowPrompt();
      return;
    case "approval-mode":
      options.openApprovalModePicker();
      return;
    case "layout":
      options.openLayoutPicker();
      return;
    case "minimal":
      toggleMinimalMode(options);
      return;
    case "export":
      exportCurrentConversation(options);
      return;
    case "export-md":
      exportCurrentConversationMarkdown(options);
      return;
    case "new":
    case "clear":
      startNewConversation(options);
      return;
    case "init":
      await initializeAgentsMd(options);
      return;
    case "fork":
      forkCurrentConversation(options);
      return;
    case "compact":
      await compactCurrentConversation(options);
      return;
    case "plan":
    case "build":
      switchSessionMode(commandName, options);
      return;
    case "help":
    case "status":
    case "memory":
    case "config":
      appendStaticBuiltinCommand(commandName, options);
      return;
    case "exit":
    case "quit":
      return;
  }
}

function appendStaticBuiltinCommand(
  commandName: "help" | "status" | "memory" | "config",
  options: BuiltinCommandDispatchOptions
): void {
  switch (commandName) {
    case "help":
      options.appendEntry(createEntry("assistant", "Recode", buildBuiltinHelpBody()));
      return;
    case "status":
      options.appendEntry(createEntry(
        "assistant",
        "Recode",
        buildBuiltinStatusBody(
          options.runtimeConfig,
          options.toolMarkerName,
          options.sessionMode,
          options.entriesCount,
          options.transcript.length,
          options.transcript,
          options.contextWindowStatus
        )
      ));
      return;
    case "memory":
      options.appendEntry(createEntry(
        "assistant",
        "Recode",
        buildBuiltinMemoryBody({
          entries: options.entries,
          sessionEvents: options.sessionEvents,
          transcript: options.transcript,
          subagentCount: options.subagentTasks.length,
          retainBashToolOutput: options.retainBashToolOutput,
          maxRetainedUiEntries: options.maxRetainedUiEntries,
          maxRetainedSessionEvents: options.maxRetainedSessionEvents,
          toolCharacters: options.toolCharacters
        })
      ));
      return;
    case "config":
      options.appendEntry(createEntry(
        "assistant",
        "Recode",
        buildBuiltinConfigBody(options.runtimeConfig, options.themeName, options.toolMarkerName)
      ));
      return;
  }
}

function toggleMinimalMode(options: BuiltinCommandDispatchOptions): void {
  const next = !options.minimalMode;
  options.setMinimalMode(next);
  try {
    persistMinimalMode(options.runtimeConfig.configPath, next);
  } catch {
    // Non-critical: the toggle still takes effect for the current session.
  }
  options.appendEntry(
    createEntry("status", "status", next ? "Minimal mode enabled — header hidden" : "Minimal mode disabled — header visible")
  );
}

function exportCurrentConversation(options: BuiltinCommandDispatchOptions): void {
  if (options.currentConversation === undefined) {
    options.appendEntry(createEntry("error", "error", "There is no active conversation to export."));
    return;
  }

  try {
    const outputPath = exportConversationToHtml({
      workspaceRoot: options.runtimeConfig.workspaceRoot,
      conversation: options.currentConversation,
      themeName: options.themeName
    });
    options.appendEntry(createEntry("status", "status", `Exported conversation to ${outputPath}`));
  } catch (error) {
    options.appendEntry(createEntry("error", "error", toErrorMessage(error)));
  }
}

function exportCurrentConversationMarkdown(options: BuiltinCommandDispatchOptions): void {
  if (options.currentConversation === undefined) {
    options.appendEntry(createEntry("error", "error", "There is no active conversation to export."));
    return;
  }

  try {
    const outputPath = exportConversationToMarkdown({
      workspaceRoot: options.runtimeConfig.workspaceRoot,
      conversation: options.currentConversation
    });
    options.appendEntry(createEntry("status", "status", `Exported conversation to ${outputPath}`));
  } catch (error) {
    options.appendEntry(createEntry("error", "error", toErrorMessage(error)));
  }
}

function startNewConversation(options: BuiltinCommandDispatchOptions): void {
  const conversation = createDraftConversation(options.runtimeConfig, options.sessionMode);
  options.setConversation(conversation);
  options.setEntries([
    createEntry(
      "status",
      "status",
      hasAgentsMd(options.runtimeConfig.workspaceRoot)
        ? "Started a new conversation · AGENTS.md loaded"
        : "Started a new conversation"
    )
  ]);
  options.setPreviousMessages([]);
  options.setSessionEvents?.([]);
  options.setSubagentTasks([]);
  options.setLastContextEstimate(undefined);
  options.setStreamingBody("");
  options.setStreamingEntryId(undefined);
}

async function initializeAgentsMd(options: BuiltinCommandDispatchOptions): Promise<void> {
  if (hasAgentsMd(options.runtimeConfig.workspaceRoot)) {
    options.appendEntry(
      createEntry("status", "status", "AGENTS.md already exists in the project root — /init will not overwrite it.")
    );
    return;
  }

  options.appendEntry(createEntry("status", "status", "Creating AGENTS.md with the init subagent…"));
  options.setBusyPhase("tool");
  options.setBusy(true);

  try {
    await options.runSubagentTask({
      description: "Create an AGENTS.md file with instructions for Recode",
      prompt: INIT_COMMAND_PROMPT,
      subagentType: "general"
    });

    if (hasAgentsMd(options.runtimeConfig.workspaceRoot)) {
      options.appendEntry(
        createEntry("status", "status", "AGENTS.md created. Restart Recode to load it into the system prompt.")
      );
      return;
    }

    options.appendEntry(createEntry("error", "error", "The init subagent finished, but AGENTS.md was not created."));
  } catch (error) {
    options.appendEntry(createEntry("error", "error", toErrorMessage(error)));
  } finally {
    options.setBusyPhase("thinking");
    options.setBusy(false);
    options.focusPrompt();
  }
}

function forkCurrentConversation(options: BuiltinCommandDispatchOptions): void {
  if (options.transcript.length === 0) {
    options.appendEntry(createEntry("status", "status", "Nothing to fork yet."));
    return;
  }

  const forkedConversation = forkConversationSession(
    options.historyRoot,
    options.runtimeConfig,
    options.transcript,
    options.sessionMode,
    options.subagentTasks,
    options.currentConversation?.sessionSnapshots,
    options.currentConversation?.sessionEvents
  );

  options.setConversation(forkedConversation);
  options.setPreviousMessages(forkedConversation.transcript);
  options.setSubagentTasks(forkedConversation.subagentTasks ?? []);
  options.setLastContextEstimate(estimateConversationContextTokens(forkedConversation.transcript));
  options.setStreamingBody("");
  options.setStreamingEntryId(undefined);
  options.appendEntry(
    createEntry(
      "status",
      "status",
      `Forked conversation into a new session (${forkedConversation.id.slice(0, 8)})`
    )
  );
}

async function compactCurrentConversation(options: BuiltinCommandDispatchOptions): Promise<void> {
  options.setBusyPhase("thinking");
  options.setBusy(true);

  try {
    const compacted = await compactConversation({
      transcript: options.transcript,
      languageModel: options.languageModel
    });

    if (compacted.kind === "noop") {
      options.appendEntry(createEntry("status", "status", "Nothing to compact yet."));
      return;
    }

    options.setPreviousMessages(compacted.transcript);
    options.setLastContextEstimate(estimateConversationContextTokens(compacted.transcript));
    const snapshot = createCompactionSessionSnapshot(options.transcript, compacted, "manual");
    const nextSnapshots = [...(options.currentConversation?.sessionSnapshots ?? []), snapshot];
    const nextSessionEvents = [
      ...(options.currentConversation?.sessionEvents ?? []),
      {
        type: "session.compacted" as const,
        timestamp: Date.now(),
        content: compacted.summaryMessage.content
      }
    ];
    options.setSessionEvents?.(nextSessionEvents);
    const persistedConversation = persistConversationSession(
      options.historyRoot,
      options.runtimeConfig,
      compacted.transcript,
      options.currentConversation,
      options.sessionMode,
      options.subagentTasks,
      nextSnapshots,
      nextSessionEvents
    );
    options.setConversation(persistedConversation);
    options.appendEntry(
      createEntry(
        "status",
        "status",
        `Compacted ${compacted.compactedMessageCount} older message${compacted.compactedMessageCount === 1 ? "" : "s"} into a continuation summary`
      )
    );
  } catch (error) {
    options.appendEntry(createEntry("error", "error", toErrorMessage(error)));
  } finally {
    options.setBusyPhase("thinking");
    options.setBusy(false);
    options.focusPrompt();
  }
}

export function toggleSessionMode(options: SessionModeCommandOptions): void {
  switchSessionMode(options.sessionMode === "plan" ? "build" : "plan", options);
}

function switchSessionMode(
  nextMode: SessionMode,
  options: SessionModeCommandOptions
): void {
  if (options.sessionMode === nextMode) {
    options.appendEntry(createEntry("status", "status", `Already in ${getSessionModeLabel(nextMode)} mode`));
    return;
  }

  options.setSessionMode(nextMode);
  const persistedConversation = persistConversationSession(
    options.historyRoot,
    options.runtimeConfig,
    options.transcript,
    options.currentConversation,
    nextMode,
    options.subagentTasks
  );
  options.setConversation(persistedConversation);
  options.appendEntry(
    createEntry(
      "status",
      "status",
      nextMode === "plan"
        ? "Switched to PLAN mode — Recode will clarify and plan without editing files"
        : "Switched to BUILD mode — Recode can implement changes again"
    )
  );
}

function persistMinimalMode(configPath: string, enabled: boolean): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredMinimalMode(config, enabled);
  saveRecodeConfigFile(configPath, nextConfig);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
