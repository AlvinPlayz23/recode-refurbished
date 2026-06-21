/**
 * Tests for prompt submission/session helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  createEntry,
  type UiEntry
} from "../transcript/transcript-entry-state.ts";
import {
  appendToolCallEntryAndCreateAssistantPlaceholder,
  buildPromptTranscriptSnapshot,
  finalizeAssistantStreamEntry
} from "./submission-session.ts";

describe("submission session helpers", () => {
  it("replaces an empty assistant placeholder with a tool call entry", () => {
    let entries: readonly UiEntry[] = [createEntry("assistant", "Recode", "")];
    const currentId = entries[0]?.id;

    const nextEntry = appendToolCallEntryAndCreateAssistantPlaceholder({
      currentStreamingId: currentId,
      currentStreamingBody: "",
      toolCall: {
        id: "call_1",
        name: "Bash",
        argumentsJson: "{\"command\":\"ls -la\"}"
      },
      setEntries(setter) {
        entries = setter(entries);
      }
    });

    expect(nextEntry?.kind).toBe("assistant");
    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["tool-preview", "Bash · ls -la"],
      ["assistant", ""]
    ]);
  });

  it("renders active TodoWrite calls as preview rows", () => {
    let entries: readonly UiEntry[] = [createEntry("assistant", "Recode", "")];
    const currentId = entries[0]?.id;

    appendToolCallEntryAndCreateAssistantPlaceholder({
      currentStreamingId: currentId,
      currentStreamingBody: "",
      toolCall: {
        id: "call_1",
        name: "TodoWrite",
        argumentsJson: JSON.stringify({
          todos: [
            { content: "Inspect code", activeForm: "Inspecting code", status: "in_progress", priority: "high" },
            { content: "Run tests", activeForm: "Running tests", status: "pending", priority: "medium" }
          ]
        })
      },
      setEntries(setter) {
        entries = setter(entries);
      }
    });

    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["tool-preview", "Todo · 2 active, 0 completed"],
      ["assistant", ""]
    ]);
    expect(entries[0]?.metadata?.kind).toBe("todo-list");
  });

  it("suppresses completed-only TodoWrite calls without leaving an empty assistant row", () => {
    let entries: readonly UiEntry[] = [createEntry("assistant", "Recode", "")];
    const currentId = entries[0]?.id;

    appendToolCallEntryAndCreateAssistantPlaceholder({
      currentStreamingId: currentId,
      currentStreamingBody: "",
      toolCall: {
        id: "call_1",
        name: "TodoWrite",
        argumentsJson: JSON.stringify({
          todos: [
            { content: "Inspect code", activeForm: "Inspecting code", status: "completed", priority: "high" }
          ]
        })
      },
      setEntries(setter) {
        entries = setter(entries);
      }
    });

    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["assistant", ""]
    ]);
  });

  it("can defer the post-tool assistant placeholder", () => {
    let entries: readonly UiEntry[] = [createEntry("assistant", "Recode", "")];
    const currentId = entries[0]?.id;

    const nextEntry = appendToolCallEntryAndCreateAssistantPlaceholder({
      currentStreamingId: currentId,
      currentStreamingBody: "",
      toolCall: {
        id: "call_1",
        name: "Read",
        argumentsJson: "{\"path\":\"missing.txt\"}"
      },
      appendAssistantPlaceholder: false,
      setEntries(setter) {
        entries = setter(entries);
      }
    });

    expect(nextEntry?.kind).toBe("assistant");
    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["tool", "Read · missing.txt"]
    ]);
  });

  it("finalizes the last assistant placeholder with final text", () => {
    let entries: readonly UiEntry[] = [createEntry("assistant", "Recode", "")];
    const entryId = entries[0]?.id;

    finalizeAssistantStreamEntry((setter) => {
      entries = setter(entries);
    }, entryId, "done");

    expect(entries[0]?.body).toBe("done");
  });

  it("adds a partial assistant message to interrupted transcript snapshots", () => {
    const snapshot = buildPromptTranscriptSnapshot([
      { role: "user", content: "explain this project" }
    ], "partial answer");

    expect(snapshot).toEqual([
      { role: "user", content: "explain this project" },
      { role: "assistant", content: "partial answer", toolCalls: [] }
    ]);
  });

  it("replaces an empty assistant placeholder in interrupted transcript snapshots", () => {
    const snapshot = buildPromptTranscriptSnapshot([
      { role: "user", content: "hello" },
      { role: "assistant", content: "", toolCalls: [] }
    ], "hi there");

    expect(snapshot).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there", toolCalls: [] }
    ]);
  });
});
