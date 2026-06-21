/**
 * Spinner phase helpers for the pi-tui app.
 */

import type { ThemeColors, ThemeName } from "./theme.ts";

/** Busy phase shown in status indicators. */
export type SpinnerPhase = "idle" | "thinking" | "tool" | "retrying";

/** Return the glyph for a busy phase. */
export function getSpinnerPhaseGlyph(phase: SpinnerPhase, theme: ThemeColors): { readonly text: string; readonly color: string } {
  switch (phase) {
    case "thinking":
      return { text: "*", color: theme.active };
    case "tool":
      return { text: "!", color: theme.tool };
    case "retrying":
      return { text: "~", color: theme.warning };
    case "idle":
      return { text: "-", color: theme.subtle };
  }
}

/** Build small decorative status segments. */
export function getSpinnerSegments(_themeName: ThemeName, tick: number, theme: ThemeColors): readonly { readonly text: string; readonly color: string }[] {
  const frames = ["recode", "recode.", "recode..", "recode..."];
  return [{ text: frames[tick % frames.length] ?? "recode", color: theme.statusText }];
}
