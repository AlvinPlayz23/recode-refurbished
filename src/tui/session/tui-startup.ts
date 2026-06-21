/**
 * Initial TUI session setup helpers.
 */

import type { ContextTokenEstimate } from "../../agent/compact-conversation.ts";
import { hasAgentsMd } from "../../prompt/agents-md.ts";
import type { SessionEvent } from "../../session/session-event.ts";
import type { ConversationMessage } from "../../transcript/message.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type { SubagentTaskRecord } from "../../agent/subagent.ts";
import { createDraftConversation } from "./conversation-session.ts";
import type { SessionMode } from "./session-mode.ts";
import { createEntry, type SetUiEntries } from "../transcript/transcript-entry-state.ts";

/** Dependencies for initial TUI session setup. */
export interface InitializeTuiSessionOptions {
  readonly runtimeConfig: RuntimeConfig;
  readonly setConversation: (value: SavedConversationRecord) => void;
  readonly restoreSubagentTaskState: (records: readonly SubagentTaskRecord[]) => void;
  readonly setEntries: SetUiEntries;
  readonly setTranscriptMessages: (value: readonly ConversationMessage[]) => void;
  readonly setSessionEvents: (value: readonly SessionEvent[]) => void;
  readonly setLastContextEstimate: (value: ContextTokenEstimate | undefined) => void;
  readonly setSessionMode: (value: SessionMode) => void;
}

/** Reset the in-memory TUI session to a new build-mode draft conversation. */
export function initializeTuiSession(options: InitializeTuiSessionOptions): void {
  options.setConversation(createDraftConversation(options.runtimeConfig, "build"));
  options.restoreSubagentTaskState([]);
  options.setEntries(() => hasAgentsMd(options.runtimeConfig.workspaceRoot)
    ? [createEntry("status", "status", "AGENTS.md loaded from the project root.")]
    : []);
  options.setTranscriptMessages([]);
  options.setSessionEvents([]);
  options.setLastContextEstimate(undefined);
  options.setSessionMode("build");
}
