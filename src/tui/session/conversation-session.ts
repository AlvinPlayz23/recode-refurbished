/**
 * Conversation-session helpers for the TUI.
 */

import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  selectConfiguredProviderModel
} from "../../config/recode-config.ts";
import {
  createConversationRecord,
  saveConversation,
  type SavedConversationRecord
} from "../../history/recode-history.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import type { SessionSnapshot } from "../../history/recode-history-types.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import {
  selectRuntimeProviderModel,
  type RuntimeConfig
} from "../../runtime/runtime-config.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import type { SessionMode } from "./session-mode.ts";

/**
 * Create a new in-memory draft conversation without persisting it yet.
 */
export function createDraftConversation(
  runtimeConfig: RuntimeConfig,
  mode: SessionMode
): SavedConversationRecord {
  return createConversationRecord(runtimeConfig, [], mode);
}

/**
 * Persist the current conversation when there is transcript content to save.
 */
export function persistConversationSession(
  historyRoot: string,
  runtimeConfig: RuntimeConfig,
  transcript: readonly ConversationMessage[],
  currentConversation: SavedConversationRecord | undefined,
  mode: SessionMode,
  subagentTasks?: readonly SubagentTaskRecord[],
  sessionSnapshots?: readonly SessionSnapshot[],
  sessionEvents?: readonly SessionEvent[]
): SavedConversationRecord {
  const embeddedTasks = subagentTasks ?? currentConversation?.subagentTasks ?? [];
  const embeddedSnapshots = sessionSnapshots ?? currentConversation?.sessionSnapshots ?? [];
  const embeddedEvents = sessionEvents ?? currentConversation?.sessionEvents ?? [];
  const conversation = createConversationRecord(
    runtimeConfig,
    transcript,
    mode,
    currentConversation === undefined
      ? undefined
      : { id: currentConversation.id, createdAt: currentConversation.createdAt },
    embeddedTasks,
    embeddedSnapshots,
    embeddedEvents
  );

  if (transcript.length > 0) {
    saveConversation(historyRoot, conversation, true);
  }

  return conversation;
}

/**
 * Clone the current transcript into a new persisted conversation ID.
 */
export function forkConversationSession(
  historyRoot: string,
  runtimeConfig: RuntimeConfig,
  transcript: readonly ConversationMessage[],
  mode: SessionMode,
  subagentTasks?: readonly SubagentTaskRecord[],
  sessionSnapshots?: readonly SessionSnapshot[],
  sessionEvents?: readonly SessionEvent[]
): SavedConversationRecord {
  const conversation = createConversationRecord(runtimeConfig, transcript, mode, undefined, subagentTasks, sessionSnapshots, sessionEvents);

  if (transcript.length > 0) {
    saveConversation(historyRoot, conversation, true);
  }

  return conversation;
}

/**
 * Restore runtime provider/model state from a saved conversation.
 */
export function restoreSavedConversationRuntime(
  runtimeConfig: RuntimeConfig,
  conversation: Pick<SavedConversationRecord, "providerId" | "model">
): RuntimeConfig {
  const providerExists = runtimeConfig.providers.some((provider) => provider.id === conversation.providerId);
  if (!providerExists) {
    return runtimeConfig;
  }

  if (runtimeConfig.providerId === conversation.providerId && runtimeConfig.model === conversation.model) {
    return runtimeConfig;
  }

  persistSelectedModelSelection(runtimeConfig, conversation.providerId, conversation.model);
  return selectRuntimeProviderModel(runtimeConfig, conversation.providerId, conversation.model);
}

/**
 * Persist the active provider/model selection to config storage.
 */
export function persistSelectedModelSelection(
  runtimeConfig: RuntimeConfig,
  providerId: string,
  modelId: string
): void {
  const config = loadRecodeConfigFile(runtimeConfig.configPath);
  const nextConfig = selectConfiguredProviderModel(config, providerId, modelId);
  saveRecodeConfigFile(runtimeConfig.configPath, nextConfig);
}
