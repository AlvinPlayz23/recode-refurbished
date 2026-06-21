/**
 * Session mode helpers for the Recode TUI.
 */

import type { ToolDefinition } from "../../tools/tool.ts";

/** Active conversation mode for one TUI session. */
export type SessionMode = "build" | "plan";

/** Return the display label for a session mode. */
export function getSessionModeLabel(mode: SessionMode): "BUILD" | "PLAN" {
  return mode === "plan" ? "PLAN" : "BUILD";
}

/**
 * Filter tools for the active session mode.
 */
export function filterToolsForSessionMode(
  tools: readonly ToolDefinition[],
  mode: SessionMode
): readonly ToolDefinition[] {
  if (mode === "build") {
    return tools;
  }

  const allowedToolNames = new Set(["AskUserQuestion", "TodoWrite", "Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
  return tools.filter((tool) => allowedToolNames.has(tool.name));
}
