/**
 * Rotating footer tips displayed in the TUI composer footer.
 *
 * @author dev
 */

export interface FooterTip {
  readonly text: string;
}

export const FOOTER_TIPS: readonly FooterTip[] = [
  { text: "Tip: /plan switches Recode into read-only planning mode." },
  { text: "Tip: use /history to reopen an older conversation quickly." },
  { text: "Tip: /theme and /customize let you tune the TUI without leaving the session." },
  { text: "Tip: type @ to mention a file from the current workspace." },
  { text: "Tip: Ctrl+Enter adds a newline before you send." },
  { text: "Tip: /approval-mode changes how much autonomy tools get." },
  { text: "Tip: /export writes the current conversation to HTML." },
  { text: "Tip: Ctrl+K collapses or expands all tool output in the transcript." },
  { text: "Tip: press ↑ in an empty prompt to cycle through previous messages." }
] as const;

/**
 * Resolve one footer tip by index.
 *
 * @param index Tip rotation index
 * @returns Tip entry
 */
export function getFooterTip(index: number): FooterTip {
  if (FOOTER_TIPS.length === 0) {
    return { text: "" };
  }

  const normalizedIndex = ((index % FOOTER_TIPS.length) + FOOTER_TIPS.length) % FOOTER_TIPS.length;
  return FOOTER_TIPS[normalizedIndex] ?? FOOTER_TIPS[0]!;
}
