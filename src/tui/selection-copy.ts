/**
 * Selection-to-clipboard behavior for the TUI.
 */

/** Register OSC 52 copy-on-selection behavior. */
export function registerSelectionCopyHandler(showToast: (message: string) => void): void {
  void showToast;
  // pi-tui runs in normal terminal mode, so native terminal selection is left untouched.
}
