/**
 * Persistent conversation history for Recode.
 *
 * @author dev
 */

import { join, resolve } from "node:path";
import type { SubagentTaskRecord } from "../agent/subagent.ts";
import type { SessionEvent } from "../session/session-event.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import type {
  AssistantMessage,
  ContinuationSummaryMessage,
  ConversationMessage,
  UserMessage
} from "../transcript/message.ts";
import type { SessionMode } from "../tui/session/session-mode.ts";
import {
  conversationToMeta,
  createEmptyHistoryIndex as createEmptyHistoryIndexFromSchema,
  HISTORY_VERSION,
  parseConversationRecord,
  parseHistoryIndex
} from "./recode-history-schema.ts";
import {
  getConversationFilePath,
  HISTORY_INDEX_FILENAME,
  readHistoryJson,
  resolveHistoryRoot,
  writeHistoryJson
} from "./recode-history-storage.ts";
import type {
  RecodeHistoryIndex,
  SavedConversationMeta,
  SavedConversationRecord,
  SessionSnapshot
} from "./recode-history-types.ts";

export { resolveHistoryRoot } from "./recode-history-storage.ts";
export { createEmptyHistoryIndex } from "./recode-history-schema.ts";
export type {
  RecodeHistoryIndex,
  SavedConversationMeta,
  SavedConversationRecord
} from "./recode-history-types.ts";

/**
 * Load the persistent history index. Missing files return an empty index.
 */
export function loadHistoryIndex(historyRoot: string): RecodeHistoryIndex {
  const indexPath = join(historyRoot, HISTORY_INDEX_FILENAME);
  const value = readHistoryJson(indexPath);
  return value === undefined ? createEmptyHistoryIndexFromSchema() : parseHistoryIndex(value);
}

/**
 * Load a saved conversation by ID.
 */
export function loadConversation(historyRoot: string, conversationId: string): SavedConversationRecord | undefined {
  const filePath = getConversationFilePath(historyRoot, conversationId);
  const value = readHistoryJson(filePath);
  return value === undefined ? undefined : parseConversationRecord(value);
}

/**
 * Create a new conversation record for the current runtime session.
 */
export function createConversationRecord(
  runtimeConfig: Pick<RuntimeConfig, "workspaceRoot" | "providerId" | "providerName" | "model">,
  transcript: readonly ConversationMessage[],
  mode: SessionMode,
  seed?: Partial<Pick<SavedConversationRecord, "id" | "createdAt">>,
  subagentTasks?: readonly SubagentTaskRecord[],
  sessionSnapshots?: readonly SessionSnapshot[],
  sessionEvents?: readonly SessionEvent[]
): SavedConversationRecord {
  const now = new Date().toISOString();
  const createdAt = seed?.createdAt ?? now;
  const id = seed?.id ?? crypto.randomUUID();

  return {
    ...buildConversationMeta(runtimeConfig, transcript, mode, createdAt, now, id),
    transcript,
    ...(sessionEvents === undefined || sessionEvents.length === 0 ? {} : { sessionEvents }),
    ...(subagentTasks === undefined || subagentTasks.length === 0 ? {} : { subagentTasks }),
    ...(sessionSnapshots === undefined || sessionSnapshots.length === 0 ? {} : { sessionSnapshots })
  };
}

/**
 * Persist a conversation and update the history index.
 */
export function saveConversation(
  historyRoot: string,
  conversation: SavedConversationRecord,
  makeCurrent: boolean
): RecodeHistoryIndex {
  const filePath = getConversationFilePath(historyRoot, conversation.id);
  writeHistoryJson(filePath, conversation);

  const currentIndex = loadHistoryIndex(historyRoot);
  const nextMeta = conversationToMeta(conversation);
  const conversations = [
    nextMeta,
    ...currentIndex.conversations.filter((item) => item.id !== conversation.id)
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const nextIndex: RecodeHistoryIndex = {
    version: HISTORY_VERSION,
    conversations,
    ...((makeCurrent ? conversation.id : currentIndex.lastConversationId) === undefined
      ? {}
      : { lastConversationId: makeCurrent ? conversation.id : currentIndex.lastConversationId })
  };

  writeHistoryIndex(historyRoot, nextIndex);
  return nextIndex;
}

/**
 * Mark one conversation as the last active session.
 */
export function markConversationAsCurrent(historyRoot: string, conversationId: string): RecodeHistoryIndex {
  const currentIndex = loadHistoryIndex(historyRoot);
  const nextIndex: RecodeHistoryIndex = {
    version: HISTORY_VERSION,
    conversations: currentIndex.conversations,
    lastConversationId: conversationId
  };

  writeHistoryIndex(historyRoot, nextIndex);
  return nextIndex;
}

/**
 * Build a conversation preview and title from transcript content.
 */
export function buildConversationMeta(
  runtimeConfig: Pick<RuntimeConfig, "workspaceRoot" | "providerId" | "providerName" | "model">,
  transcript: readonly ConversationMessage[],
  mode: SessionMode,
  createdAt: string,
  updatedAt: string,
  conversationId: string
): SavedConversationMeta {
  const userMessages = transcript.filter((message): message is UserMessage => message.role === "user");
  const assistantMessages = transcript.filter((message): message is AssistantMessage => message.role === "assistant");
  const summaryMessages = transcript.filter((message): message is ContinuationSummaryMessage => message.role === "summary");
  const titleSource = userMessages[0]?.content ?? assistantMessages[0]?.content ?? "New Conversation";
  const previewSource = assistantMessages.at(-1)?.content
    ?? userMessages.at(-1)?.content
    ?? summaryMessages.at(-1)?.content
    ?? "No messages yet";

  return {
    id: conversationId,
    title: summarizeText(titleSource, 64),
    preview: summarizeText(previewSource, 120),
    workspaceRoot: runtimeConfig.workspaceRoot,
    createdAt,
    updatedAt,
    providerId: runtimeConfig.providerId,
    providerName: runtimeConfig.providerName,
    model: runtimeConfig.model,
    mode,
    messageCount: userMessages.length + assistantMessages.length
  };
}

/**
 * Return only conversations that belong to the current workspace.
 */
export function listHistoryForWorkspace(
  index: RecodeHistoryIndex,
  workspaceRoot: string
): readonly SavedConversationMeta[] {
  const workspaceKey = toWorkspaceKey(workspaceRoot);
  return index.conversations.filter((conversation) => toWorkspaceKey(conversation.workspaceRoot) === workspaceKey);
}

function writeHistoryIndex(historyRoot: string, index: RecodeHistoryIndex): void {
  const indexPath = join(historyRoot, HISTORY_INDEX_FILENAME);
  writeHistoryJson(indexPath, index);
}

function summarizeText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    return "New Conversation";
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

function toWorkspaceKey(workspaceRoot: string): string {
  const normalized = workspaceRoot.trim() === ""
    ? ""
    : resolve(workspaceRoot).replace(/[\\/]+$/u, "");

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}
