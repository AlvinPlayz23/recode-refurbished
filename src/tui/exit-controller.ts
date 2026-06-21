/**
 * Two-step Ctrl+C exit handling for the TUI.
 */

/** Minimal key event accepted by the exit controller. */
export interface KeyEvent {
  preventDefault(): void;
  stopPropagation(): void;
}

/** Controls Ctrl+C exit and active-run abort behavior. */
export interface ExitController {
  readonly handleCtrlC: (key: KeyEvent) => void;
  readonly dispose: () => void;
}

/** Create the two-step Ctrl+C handler used by the interactive TUI. */
export function createExitController(options: {
  readonly destroy: () => void;
  readonly isBusy: () => boolean;
  readonly abortActiveRun: () => void;
  readonly setExitHintVisible: (value: boolean) => void;
}): ExitController {
  let ctrlCArmed = false;
  let exitHintTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (exitHintTimer !== undefined) {
      clearTimeout(exitHintTimer);
      exitHintTimer = undefined;
    }
  };

  return {
    handleCtrlC(key) {
      key.preventDefault();
      key.stopPropagation();

      if (ctrlCArmed) {
        options.destroy();
        return;
      }

      ctrlCArmed = true;
      options.setExitHintVisible(true);
      if (options.isBusy()) {
        options.abortActiveRun();
      }

      clearTimer();
      exitHintTimer = setTimeout(() => {
        ctrlCArmed = false;
        options.setExitHintVisible(false);
        exitHintTimer = undefined;
      }, 1800);
    },
    dispose() {
      clearTimer();
    }
  };
}
