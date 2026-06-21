/**
 * Tests for initial TUI session setup helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextTokenEstimate } from "../../agent/compact-conversation.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import type { UiEntry } from "../transcript/transcript-entry-state.ts";
import { initializeTuiSession } from "./tui-startup.ts";

const tempRoots: string[] = [];

describe("tui startup", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot !== undefined) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds a startup status entry when AGENTS.md is present", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-tui-startup-"));
    tempRoots.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "AGENTS.md"), "Use bun.");

    const state = createStartupState();
    initializeTuiSession({
      runtimeConfig: createRuntimeConfig(workspaceRoot),
      setConversation(value) {
        state.conversation = value;
      },
      restoreSubagentTaskState(value) {
        state.subagentTasks = value;
      },
      setEntries(value) {
        state.entries = value(state.entries);
      },
      setTranscriptMessages(value) {
        state.transcript = value;
      },
      setSessionEvents(value) {
        state.sessionEvents = value;
      },
      setLastContextEstimate(value) {
        state.lastContextEstimate = value;
      },
      setSessionMode(value) {
        state.sessionMode = value;
      }
    });

    expect(state.entries.map((entry) => entry.body)).toEqual([
      "AGENTS.md loaded from the project root."
    ]);
    expect(state.sessionMode).toBe("build");
  });

  it("starts cleanly when AGENTS.md is absent", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-tui-startup-"));
    tempRoots.push(workspaceRoot);
    const state = createStartupState();

    initializeTuiSession({
      runtimeConfig: createRuntimeConfig(workspaceRoot),
      setConversation(value) {
        state.conversation = value;
      },
      restoreSubagentTaskState(value) {
        state.subagentTasks = value;
      },
      setEntries(value) {
        state.entries = value(state.entries);
      },
      setTranscriptMessages(value) {
        state.transcript = value;
      },
      setSessionEvents(value) {
        state.sessionEvents = value;
      },
      setLastContextEstimate(value) {
        state.lastContextEstimate = value;
      },
      setSessionMode(value) {
        state.sessionMode = value;
      }
    });

    expect(state.entries).toEqual([]);
    expect(state.sessionMode).toBe("build");
  });
});

interface StartupState {
  conversation: SavedConversationRecord | undefined;
  subagentTasks: readonly SubagentTaskRecord[];
  entries: readonly UiEntry[];
  transcript: readonly ConversationMessage[];
  sessionEvents: readonly SessionEvent[];
  lastContextEstimate: ContextTokenEstimate | undefined;
  sessionMode: "build" | "plan";
}

function createStartupState(): StartupState {
  return {
    conversation: undefined,
    subagentTasks: [{
      id: "old",
      subagentType: "general",
      description: "Old task",
      prompt: "test",
      transcript: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      providerId: "primary",
      providerName: "Primary",
      model: "gpt-4.1",
      status: "completed"
    }],
    entries: [],
    transcript: [{ role: "user", content: "old" }],
    sessionEvents: [{ type: "user.submitted", timestamp: 1, content: "old", modelContent: "old" }],
    lastContextEstimate: { estimatedTokens: 10, source: "rough" },
    sessionMode: "plan"
  };
}

function createRuntimeConfig(workspaceRoot: string): RuntimeConfig {
  return {
    workspaceRoot,
    configPath: join(workspaceRoot, "config.json"),
    provider: "openai",
    providerId: "primary",
    providerName: "Primary",
    model: "gpt-4.1",
    providers: [],
    approvalMode: "approval",
    approvalAllowlist: [],
    permissionRules: [],
    baseUrl: "https://api.openai.com/v1"
  };
}