/**
 * Tool-registry helpers for TUI session modes.
 */

import { ToolRegistry } from "../../tools/tool-registry.ts";
import { filterToolsForSessionMode, type SessionMode } from "./session-mode.ts";

/** Return the base registry in build mode, or a read-only registry in plan mode. */
export function createToolRegistryForMode(baseRegistry: ToolRegistry, mode: SessionMode): ToolRegistry {
  return mode === "build"
    ? baseRegistry
    : new ToolRegistry(filterToolsForSessionMode(baseRegistry.list(), mode));
}
