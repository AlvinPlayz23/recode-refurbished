/**
 * Per-turn session projection helpers for prompt runs.
 */

import { estimateConversationContextTokens, type ContextTokenEstimate } from "../../agent/compact-conversation.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import {
  applySessionEvent,
  createEmptySessionState,
  type SessionState
} from "../../session/session-state.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { TodoItem } from "../../tools/tool.ts";
import {
  pruneBashToolOutputEntries,
  pruneBashToolOutputSessionEvent,
  pruneBashToolOutputTranscript,
  uiEntriesFromSessionState,
  type SetUiEntries,
  type UiEntry
} from "../transcript/transcript-entry-state.ts";
import { buildPromptTranscriptSnapshot } from "./submission-session.ts";
import type { SpinnerPhase } from "../appearance/spinner.ts";

/** Options for one prompt turn session projector. */
export interface PromptTurnSessionOptions {
  readonly baseEntries: readonly UiEntry[];
  readonly baseSessionEvents: readonly SessionEvent[];
  readonly workspaceRoot: string;
  readonly setEntries: SetUiEntries;
  readonly setSessionEvents: (value: readonly SessionEvent[]) => void;
  readonly setBusyPhase: (value: SpinnerPhase) => void;
  readonly getBusyPhase: () => SpinnerPhase;
  readonly setProviderStatusText: (value: string | undefined) => void;
  readonly invalidateWorkspaceFileSuggestions: (workspaceRoot: string) => void;
  readonly bumpFileSuggestionVersion: () => void;
  readonly setTodos: (value: readonly TodoItem[]) => void;
  readonly closeTodoDropup: () => void;
  readonly setTranscriptMessages: (value: readonly ConversationMessage[]) => void;
  readonly setLastContextEstimate: (value: ContextTokenEstimate) => void;
  readonly retainBashToolOutput?: () => boolean;
}

/** Mutable controller for the current prompt turn. */
export interface PromptTurnSession {
  readonly handleSessionEvent: (event: SessionEvent) => void;
  readonly handleTranscriptUpdate: (transcript: readonly ConversationMessage[]) => void;
  readonly buildTranscriptSnapshot: () => readonly ConversationMessage[];
  readonly getTurnSessionEvents: () => readonly SessionEvent[];
  readonly getAllSessionEvents: () => readonly SessionEvent[];
}

/** Create one prompt-turn session projector. */
export function createPromptTurnSession(options: PromptTurnSessionOptions): PromptTurnSession {
  let latestTranscript: readonly ConversationMessage[] | undefined;
  let turnSessionEvents: SessionEvent[] = [];
  let turnSessionState: SessionState = createEmptySessionState();
  const retainBashToolOutput = options.retainBashToolOutput ?? (() => true);

  const syncTurnSessionEntries = () => {
    const projectedEntries = [
      ...options.baseEntries,
      ...uiEntriesFromSessionState(turnSessionState)
    ];
    options.setEntries(() => [
      ...(retainBashToolOutput() ? projectedEntries : pruneBashToolOutputEntries(projectedEntries))
    ]);
  };

  const latestProjectedAssistantText = () => {
    for (let index = turnSessionState.entries.length - 1; index >= 0; index -= 1) {
      const entry = turnSessionState.entries[index];
      if (entry?.kind === "assistant" && entry.content !== "") {
        return entry.content;
      }
    }
    return "";
  };

  const handleSessionEvent = (event: SessionEvent) => {
    const memoryEvent = retainBashToolOutput()
      ? event
      : pruneBashToolOutputSessionEvent(event);
    turnSessionEvents = appendCompactSessionEvent(turnSessionEvents, memoryEvent);
    options.setSessionEvents([...options.baseSessionEvents, ...turnSessionEvents]);
    turnSessionState = applySessionEvent(turnSessionState, memoryEvent);
    syncTurnSessionEntries();

    switch (memoryEvent.type) {
      case "assistant.text.delta":
        if (options.getBusyPhase() === "retrying") {
          options.setBusyPhase("thinking");
        }
        options.setProviderStatusText(undefined);
        break;
      case "tool.started":
        options.setBusyPhase("tool");
        options.setProviderStatusText(formatActiveToolLabel(memoryEvent.toolCall.name, memoryEvent.toolCall.argumentsJson));
        break;
      case "tool.completed":
      case "tool.errored": {
        const toolResult = memoryEvent.toolResult;
        options.setBusyPhase("thinking");
        options.setProviderStatusText(undefined);
        options.invalidateWorkspaceFileSuggestions(options.workspaceRoot);
        options.bumpFileSuggestionVersion();
        if (!toolResult.isError && toolResult.metadata?.kind === "todo-list") {
          options.setTodos(toolResult.metadata.todos);
          if (toolResult.metadata.todos.length === 0) {
            options.closeTodoDropup();
          }
        }
        break;
      }
      case "provider.retry":
        options.setBusyPhase("retrying");
        options.setProviderStatusText(`retry ${memoryEvent.status.attempt}/${memoryEvent.status.maxAttempts}`);
        break;
      default:
        break;
    }
  };

  return {
    handleSessionEvent,

    handleTranscriptUpdate(transcript) {
      latestTranscript = retainBashToolOutput()
        ? transcript
        : pruneBashToolOutputTranscript(transcript);
      options.setTranscriptMessages(latestTranscript);
      options.setLastContextEstimate(estimateConversationContextTokens(latestTranscript));
    },
    buildTranscriptSnapshot() {
      return buildPromptTranscriptSnapshot(latestTranscript, latestProjectedAssistantText());
    },
    getTurnSessionEvents() {
      return turnSessionEvents;
    },
    getAllSessionEvents() {
      return [...options.baseSessionEvents, ...turnSessionEvents];
    }
  };
}

function appendCompactSessionEvent(events: readonly SessionEvent[], event: SessionEvent): SessionEvent[] {
  const previous = events.at(-1);

  if (
    previous?.type === "assistant.text.delta"
    && event.type === "assistant.text.delta"
    && previous.stepId === event.stepId
  ) {
    return [
      ...events.slice(0, -1),
      {
        ...event,
        timestamp: previous.timestamp,
        delta: previous.delta + event.delta
      }
    ];
  }

  if (
    previous?.type === "assistant.reasoning.delta"
    && event.type === "assistant.reasoning.delta"
    && previous.stepId === event.stepId
  ) {
    return [
      ...events.slice(0, -1),
      {
        ...event,
        timestamp: previous.timestamp,
        delta: previous.delta + event.delta
      }
    ];
  }

  if (event.type === "tool.metadata.updated") {
    const previousMetadataIndex = findLastIndex(events, (item) =>
      item.type === "tool.metadata.updated"
      && item.toolCallId === event.toolCallId
      && item.toolName === event.toolName
    );

    if (previousMetadataIndex !== -1) {
      return events.map((item, index) =>
        index === previousMetadataIndex
          ? { ...event, timestamp: item.timestamp }
          : item
      );
    }
  }

  return [...events, event];
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) {
      return index;
    }
  }

  return -1;
}

const TOOL_ARG_KEYS = ["command", "path", "file_path", "pattern", "query", "description"] as const;
const MAX_ARG_DISPLAY_LENGTH = 36;

/**
 * Build a short human-readable label for the active tool call shown in the busy indicator.
 * Format: "ToolName · first-meaningful-arg (truncated)"
 */
function formatActiveToolLabel(toolName: string, argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const args = parsed as Record<string, unknown>;
      for (const key of TOOL_ARG_KEYS) {
        const value = args[key];
        if (typeof value === "string" && value.trim() !== "") {
          const trimmed = value.trim().replace(/\s+/g, " ");
          const display = trimmed.length > MAX_ARG_DISPLAY_LENGTH
            ? `${trimmed.slice(0, MAX_ARG_DISPLAY_LENGTH)}…`
            : trimmed;
          return `${toolName} · ${display}`;
        }
      }
    }
  } catch {
    // Fall back to tool name only
  }
  return toolName;
}
