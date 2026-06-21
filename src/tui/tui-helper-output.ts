/**
 * Small output helpers shared by TUI action helpers.
 */

import { createEntry, type UiEntry } from "./transcript/transcript-entry-state.ts";

/**
 * Object that can append a UI entry.
 */
export interface UiEntrySink {
  readonly appendEntry: (entry: UiEntry) => void;
}

/**
 * Append a status entry.
 */
export function appendStatusEntry(sink: UiEntrySink, message: string): void {
  sink.appendEntry(createEntry("status", "status", message));
}

/**
 * Append an error entry from an unknown error or message.
 */
export function appendErrorEntry(sink: UiEntrySink, error: unknown): void {
  sink.appendEntry(createEntry("error", "error", toErrorMessage(error)));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}
