/**
 * Live subagent chat view state for the TUI.
 */

import type { SubagentTaskRecord, SubagentType } from "../agent/subagent.ts";
import type { ConversationMessage, ToolCall, ToolResultMessage } from "../transcript/message.ts";
import {
  createEntry,
  createToolCallUiEntry,
  createToolResultUiEntry,
  pruneBashToolOutputMetadata,
  pruneBashToolOutputTranscript,
  rehydrateEntriesFromTranscript,
  replaceTaskToolCallEntryWithResult,
  type UiEntry
} from "./transcript/transcript-entry-state.ts";

/** Active transcript view in the TUI. */
export type ChatView =
  | { readonly kind: "parent" }
  | { readonly kind: "subagent"; readonly taskId: string };

/** Mutable-in-time child chat state used while a Task subagent is running. */
export interface LiveSubagentTask {
  readonly id: string;
  readonly subagentType: SubagentType;
  readonly description: string;
  readonly prompt: string;
  readonly transcript: readonly ConversationMessage[];
  readonly entries: readonly UiEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly model: string;
  readonly status: "running" | "completed" | "failed";
  readonly streamingEntryId?: string;
  readonly streamingBody: string;
  readonly error?: string;
}

/** Input for creating one live subagent task. */
export interface CreateLiveSubagentTaskInput {
  readonly id: string;
  readonly subagentType: SubagentType;
  readonly description: string;
  readonly prompt: string;
  readonly transcript?: readonly ConversationMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly model: string;
  readonly status: LiveSubagentTask["status"];
  readonly error?: string;
  readonly retainBashToolOutput?: boolean;
}

/** Create one live task from explicit metadata. */
export function createLiveSubagentTask(input: CreateLiveSubagentTaskInput): LiveSubagentTask {
  const transcript = input.retainBashToolOutput === false
    ? pruneBashToolOutputTranscript(input.transcript ?? [])
    : input.transcript ?? [];
  return {
    id: input.id,
    subagentType: input.subagentType,
    description: input.description,
    prompt: input.prompt,
    transcript,
    entries: rehydrateEntriesFromTranscript(transcript),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    providerId: input.providerId,
    providerName: input.providerName,
    model: input.model,
    status: input.status,
    streamingBody: "",
    ...(input.error === undefined ? {} : { error: input.error })
  };
}

/** Convert saved subagent records into live-view state. */
export function createLiveSubagentTasksFromRecords(
  records: readonly SubagentTaskRecord[],
  retainBashToolOutput = true
): readonly LiveSubagentTask[] {
  return records.map((record) => createLiveSubagentTask({
    ...record,
    status: "completed",
    retainBashToolOutput
  }));
}

/** Upsert a live task while preserving creation order for existing tasks. */
export function upsertLiveSubagentTask(
  tasks: readonly LiveSubagentTask[],
  task: LiveSubagentTask
): readonly LiveSubagentTask[] {
  const existingIndex = tasks.findIndex((item) => item.id === task.id);
  if (existingIndex === -1) {
    return [...tasks, task];
  }

  return tasks.map((item) => item.id === task.id ? task : item);
}

/** Complete a live task from its durable subagent record. */
export function completeLiveSubagentTask(
  tasks: readonly LiveSubagentTask[],
  record: SubagentTaskRecord,
  retainBashToolOutput = true
): readonly LiveSubagentTask[] {
  return upsertLiveSubagentTask(tasks, createLiveSubagentTask({
    ...record,
    status: "completed",
    retainBashToolOutput
  }));
}

/** Mark a live task failed while preserving its latest visible transcript. */
export function failLiveSubagentTask(
  tasks: readonly LiveSubagentTask[],
  taskId: string,
  message: string
): readonly LiveSubagentTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const { streamingEntryId: _streamingEntryId, ...taskWithoutStreamingEntry } = task;
    return {
      ...taskWithoutStreamingEntry,
      status: "failed",
      updatedAt: new Date().toISOString(),
      streamingBody: "",
      error: message,
      entries: [
        ...task.entries,
        createEntry("error", "error", message)
      ]
    };
  });
}

/** Apply a child transcript update to the live task view. */
export function applyLiveSubagentTranscriptUpdate(
  tasks: readonly LiveSubagentTask[],
  taskId: string,
  transcript: readonly ConversationMessage[]
): readonly LiveSubagentTask[] {
  return tasks.map((task) => task.id === taskId
    ? clearStreaming({
        ...task,
        transcript,
        entries: rehydrateEntriesFromTranscript(transcript),
        updatedAt: new Date().toISOString()
      })
    : task);
}

/** Append streamed assistant text to a live task view. */
export function appendLiveSubagentTextDelta(
  tasks: readonly LiveSubagentTask[],
  taskId: string,
  delta: string
): readonly LiveSubagentTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    if (task.streamingEntryId !== undefined) {
      return {
        ...task,
        streamingBody: task.streamingBody + delta,
        updatedAt: new Date().toISOString()
      };
    }

    const entry = createEntry("assistant", "Recode", "");
    return {
      ...task,
      entries: [...task.entries, entry],
      streamingEntryId: entry.id,
      streamingBody: delta,
      updatedAt: new Date().toISOString()
    };
  });
}

/** Append a live child tool call preview. */
export function appendLiveSubagentToolCall(
  tasks: readonly LiveSubagentTask[],
  taskId: string,
  toolCall: ToolCall
): readonly LiveSubagentTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const toolEntry = createToolCallUiEntry(toolCall);
    if (toolEntry === undefined) {
      return task;
    }

    const entries = task.streamingEntryId === undefined
      ? task.entries
      : updateEntriesBody(task.entries, task.streamingEntryId, task.streamingBody);
    const placeholder = createEntry("assistant", "Recode", "");

    return {
      ...task,
      entries: [...entries, toolEntry, placeholder],
      streamingEntryId: placeholder.id,
      streamingBody: "",
      updatedAt: new Date().toISOString()
    };
  });
}

/** Append a child tool result or replace its live Task row. */
export function appendLiveSubagentToolResult(
  tasks: readonly LiveSubagentTask[],
  taskId: string,
  toolResult: ToolResultMessage
): readonly LiveSubagentTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    let entries = task.streamingEntryId === undefined
      ? task.entries
      : updateEntriesBody(task.entries, task.streamingEntryId, task.streamingBody);

    if (toolResult.toolName === "Task") {
      const replacement = replaceTaskToolCallEntryWithResult(entries, toolResult);
      if (replacement.replaced) {
        return clearStreaming({
          ...task,
          entries: replacement.entries,
          updatedAt: new Date().toISOString()
        });
      }
    }

    const metadata = pruneBashToolOutputMetadata(toolResult.metadata);
    const toolResultEntry = createToolResultUiEntry(
      toolResult.toolName,
      toolResult.content,
      toolResult.isError,
      metadata,
      toolResult.toolCallId
    );
    if (toolResultEntry !== undefined) {
      entries = [...entries, toolResultEntry];
    }

    return clearStreaming({
      ...task,
      entries,
      updatedAt: new Date().toISOString()
    });
  });
}

/** Cycle the visible chat in parent-first, task creation order. */
export function cycleChatView(current: ChatView, tasks: readonly LiveSubagentTask[]): ChatView {
  if (tasks.length === 0) {
    return { kind: "parent" };
  }

  if (current.kind === "parent") {
    return { kind: "subagent", taskId: tasks[0]!.id };
  }

  const currentIndex = tasks.findIndex((task) => task.id === current.taskId);
  const nextTask = currentIndex === -1 ? undefined : tasks[currentIndex + 1];
  return nextTask === undefined
    ? { kind: "parent" }
    : { kind: "subagent", taskId: nextTask.id };
}

/**
 * Return the chat view for the first running subagent, or the first
 * subagent if none is running. Returns undefined when there are no tasks.
 */
export function goToFirstSubagentView(tasks: readonly LiveSubagentTask[]): ChatView | undefined {
  if (tasks.length === 0) {
    return undefined;
  }
  const running = tasks.find((task) => task.status === "running");
  const target = running ?? tasks[0]!;
  return { kind: "subagent", taskId: target.id };
}

function updateEntriesBody(entries: readonly UiEntry[], entryId: string, body: string): readonly UiEntry[] {
  return entries.map((entry) => entry.id === entryId
    ? { ...entry, body }
    : entry);
}

function clearStreaming(task: LiveSubagentTask): LiveSubagentTask {
  const { streamingEntryId: _streamingEntryId, ...taskWithoutStreamingEntry } = task;
  return {
    ...taskWithoutStreamingEntry,
    streamingBody: ""
  };
}
