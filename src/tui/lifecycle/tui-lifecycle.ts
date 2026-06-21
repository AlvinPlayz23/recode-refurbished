/**
 * Lifecycle timers and refresh effects for the main TUI screen.
 */

type Accessor<T> = () => T;
type Setter<T> = (value: T | ((previous: T) => T)) => void;

/** Options for status/footer timers. */
export interface StatusTimersOptions {
  readonly setStatusTick: Setter<number>;
  readonly setFooterTipIndex: Setter<number>;
}

/** Start status and footer-tip timers and clean them up with the component. */
export function registerStatusTimers(options: StatusTimersOptions): void {
  const statusInterval = setInterval(() => {
    options.setStatusTick((value) => value + 1);
  }, 120);
  const footerTipInterval = setInterval(() => {
    options.setFooterTipIndex((value) => value + 1);
  }, 30_000);

  void statusInterval;
  void footerTipInterval;
}

/** Options for splash detail auto-hide. */
export interface SplashDetailsTimerOptions {
  readonly showSplashLogo: Accessor<boolean>;
  readonly setSplashDetailsVisible: Setter<boolean>;
}

/** Hide splash details after the initial idle period, and reset when splash closes. */
export function registerSplashDetailsTimer(options: SplashDetailsTimerOptions): void {
  let splashDetailsTimer: ReturnType<typeof setTimeout> | undefined;

  {
    if (!options.showSplashLogo()) {
      options.setSplashDetailsVisible(true);
      if (splashDetailsTimer !== undefined) {
        clearTimeout(splashDetailsTimer);
        splashDetailsTimer = undefined;
      }
      return;
    }

    options.setSplashDetailsVisible(true);
    if (splashDetailsTimer !== undefined) {
      clearTimeout(splashDetailsTimer);
    }
    splashDetailsTimer = setTimeout(() => {
      options.setSplashDetailsVisible(false);
      splashDetailsTimer = undefined;
    }, 15_000);
  }
}

/** Options for forcing header remounts when display-critical state changes. */
export interface HeaderRefreshOptions {
  readonly themeName: Accessor<unknown>;
  readonly showSplashLogo: Accessor<unknown>;
  readonly effectiveSplashDetailsVisible: Accessor<unknown>;
  readonly footerTipIndex: Accessor<unknown>;
  readonly setHeaderVisible: Setter<boolean>;
}

/** Trigger a one-microtask header remount when its rendered shape changes. */
export function registerHeaderRefresh(options: HeaderRefreshOptions): void {
  let headerRefreshScheduled = false;

  {
    options.themeName();
    options.showSplashLogo();
    options.effectiveSplashDetailsVisible();
    options.footerTipIndex();

    if (headerRefreshScheduled) {
      return;
    }

    headerRefreshScheduled = true;
    options.setHeaderVisible(false);
    queueMicrotask(() => {
      headerRefreshScheduled = false;
      options.setHeaderVisible(true);
    });
  }
}
