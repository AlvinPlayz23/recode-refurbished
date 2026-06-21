/**
 * Project normalized session events into durable session state.
 */

import type { StepStats } from "../agent/step-stats.ts";
import type { ToolMetadataUpdate, ToolResultMetadata } from "../tools/tool.ts";
import type { ToolCall } from "../transcript/message.ts";
import type { SessionEvent } from "./session-event.ts";

/** Projected session state derived from normalized lifecycle events. */
export interface SessionState {
  readonly entries: readonly SessionEntry[];
}

/** One durable projected session entry. */
export type SessionEntry = UserSessionEntry | AssistantSessionEntry | ToolSessionEntry | StatusSessionEntry;

export interface UserSessionEntry {
  readonly id: string;
  readonly kind: "user";
  readonly timestamp: number;
  readonly content: string;
  readonly modelContent: string;
}

export interface AssistantSessionEntry {
  readonly id: string;
  readonly kind: "assistant";
  readonly timestamp: number;
  readonly stepId: string;
  readonly content: string;
  readonly reasoningContent: string;
  readonly completed: boolean;
  readonly stepStats?: StepStats;
}

export interface ToolSessionEntry {
  readonly id: string;
  readonly kind: "tool";
  readonly timestamp: number;
  readonly stepId: string;
  readonly toolCall: ToolCall;
  readonly status: "running" | "completed" | "error";
  readonly title?: string;
  readonly content?: string;
  readonly metadata?: ToolResultMetadata;
  readonly completedAt?: number;
}

export interface StatusSessionEntry {
  readonly id: string;
  readonly kind: "status";
  readonly timestamp: number;
  readonly content: string;
}

/** Create an empty projected session state. */
export function createEmptySessionState(): SessionState {
  return {
    entries: []
  };
}

/** Replay normalized lifecycle events into projected session state. */
export function sessionStateFromEvents(events: readonly SessionEvent[]): SessionState {
  return events.reduce((state, event) => applySessionEvent(state, event), createEmptySessionState());
}

/** Apply one normalized lifecycle event to a projected session state. */
export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "user.submitted":
      return appendSessionEntry(state, {
        id: `user:${event.timestamp}`,
        kind: "user",
        timestamp: event.timestamp,
        content: event.content,
        modelContent: event.modelContent
      });
    case "assistant.step.started":
      return appendSessionEntry(state, {
        id: `assistant:${event.stepId}`,
        kind: "assistant",
        timestamp: event.timestamp,
        stepId: event.stepId,
        content: "",
        reasoningContent: "",
        completed: false
      });
    case "assistant.reasoning.delta":
      return updateSessionEntries(state, (entry) =>
        entry.kind === "assistant" && entry.stepId === event.stepId
          ? { ...entry, reasoningContent: entry.reasoningContent + event.delta }
          : entry
      );
    case "assistant.text.delta":
      return updateSessionEntries(state, (entry) =>
        entry.kind === "assistant" && entry.stepId === event.stepId
          ? { ...entry, content: entry.content + event.delta }
          : entry
      );
    case "assistant.step.finished":
      return updateSessionEntries(state, (entry) =>
        entry.kind === "assistant" && entry.stepId === event.stepId
          ? {
              ...entry,
              content: event.finalText,
              completed: true,
              stepStats: event.stepStats
            }
          : entry
      );
    case "tool.started":
      return appendSessionEntry(state, {
        id: `tool:${event.toolCall.id}`,
        kind: "tool",
        timestamp: event.timestamp,
        stepId: event.stepId,
        toolCall: event.toolCall,
        status: "running"
      });
    case "tool.metadata.updated":
      return updateToolEntry(state, event.toolCallId, event.update);
    case "tool.completed":
    case "tool.errored":
      return updateSessionEntries(state, (entry) =>
        entry.kind === "tool" && entry.toolCall.id === event.toolResult.toolCallId
          ? finishToolEntry(entry, event.toolResult.isError ? "error" : "completed", event.toolResult.content, event.toolResult.metadata, event.timestamp)
          : entry
      );
    case "provider.retry":
      return appendSessionEntry(state, {
        id: `status:${event.timestamp}`,
        kind: "status",
        timestamp: event.timestamp,
        content: `Retrying provider request (${event.status.attempt}/${event.status.maxAttempts})`
      });
    case "session.compacted":
      return appendSessionEntry(state, {
        id: `status:${event.timestamp}`,
        kind: "status",
        timestamp: event.timestamp,
        content: "Earlier conversation history was compacted into a continuation summary."
      });
  }
}

function finishToolEntry(
  entry: ToolSessionEntry,
  status: "completed" | "error",
  content: string,
  metadata: ToolResultMetadata | undefined,
  timestamp: number
): ToolSessionEntry {
  const nextMetadata = metadata ?? entry.metadata;
  return {
    ...entry,
    status,
    content,
    ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
    completedAt: timestamp
  };
}

function appendSessionEntry(state: SessionState, entry: SessionEntry): SessionState {
  return {
    entries: [...state.entries, entry]
  };
}

function updateSessionEntries(
  state: SessionState,
  update: (entry: SessionEntry) => SessionEntry
): SessionState {
  return {
    entries: state.entries.map(update)
  };
}

function updateToolEntry(
  state: SessionState,
  toolCallId: string,
  update: ToolMetadataUpdate
): SessionState {
  return updateSessionEntries(state, (entry) => {
    if (entry.kind !== "tool" || entry.toolCall.id !== toolCallId) {
      return entry;
    }

    return {
      ...entry,
      ...(update.title === undefined ? {} : { title: update.title }),
      ...(update.content === undefined ? {} : { content: update.content }),
      ...(update.metadata === undefined ? {} : { metadata: update.metadata })
    };
  });
}
