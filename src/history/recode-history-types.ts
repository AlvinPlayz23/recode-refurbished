/**
 * Persistent conversation history types.
 */

import type { ConversationMessage } from "../transcript/message.ts";
import type { SubagentTaskRecord } from "../agent/subagent.ts";
import type { SessionMode } from "../tui/session/session-mode.ts";
import type { SessionEvent } from "../session/session-event.ts";

/**
 * Durable snapshot captured when a session is compacted.
 */
export interface CompactionSessionSnapshot {
  readonly kind: "compaction";
  readonly id: string;
  readonly createdAt: string;
  readonly reason: "manual" | "auto";
  readonly compactedMessageCount: number;
  readonly summary: string;
  readonly beforeTranscript: readonly ConversationMessage[];
  readonly afterTranscript: readonly ConversationMessage[];
}

/**
 * Durable session snapshot persisted with a conversation.
 */
export type SessionSnapshot = CompactionSessionSnapshot;

/**
 * One saved conversation summary entry.
 */
export interface SavedConversationMeta {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly model: string;
  readonly mode: SessionMode;
  readonly messageCount: number;
}

/**
 * One saved conversation record.
 */
export interface SavedConversationRecord extends SavedConversationMeta {
  readonly transcript: readonly ConversationMessage[];
  readonly sessionEvents?: readonly SessionEvent[];
  readonly subagentTasks?: readonly SubagentTaskRecord[];
  readonly sessionSnapshots?: readonly SessionSnapshot[];
}

/**
 * Global conversation history index.
 */
export interface RecodeHistoryIndex {
  readonly version: 1;
  readonly lastConversationId?: string;
  readonly conversations: readonly SavedConversationMeta[];
}
