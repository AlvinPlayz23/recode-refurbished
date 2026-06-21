/**
 * Small composer helpers kept for non-JSX TUI logic.
 */

import type { SpinnerPhase } from "../appearance/spinner.ts";

/** Return a human-readable busy phase label. */
export function getSpinnerPhaseLabel(phase: SpinnerPhase): string {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "tool":
      return "running tool";
    case "retrying":
      return "retrying";
    case "idle":
      return "ready";
  }
}
