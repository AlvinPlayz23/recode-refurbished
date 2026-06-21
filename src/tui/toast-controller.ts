/**
 * Toast timing controller for transient TUI notifications.
 */

import type { ActiveToast } from "./tui-app-types.ts";

/** Controls transient toast display. */
export interface ToastController {
  readonly showToast: (message: string) => void;
  readonly dispose: () => void;
}

/** Create a controller that shows one toast at a time. */
export function createToastController(
  setActiveToast: (value: ActiveToast | undefined) => void
): ToastController {
  let activeToastTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (activeToastTimer !== undefined) {
      clearTimeout(activeToastTimer);
      activeToastTimer = undefined;
    }
  };

  return {
    showToast(message) {
      setActiveToast({ message });
      clearTimer();
      activeToastTimer = setTimeout(() => {
        activeToastTimer = undefined;
        setActiveToast(undefined);
      }, 1500);
    },
    dispose() {
      clearTimer();
    }
  };
}
