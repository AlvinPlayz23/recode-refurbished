/**
 * Cursor and picker scroll synchronization effects.
 */

import { applyInputCursorStyle, type PromptRenderable } from "../composer/prompt-renderable.ts";
import {
  getHistoryPickerScrollOffset,
  getIndexedPickerChildId,
  syncScrollBoxSelection,
  type ModelPickerRenderedLine
} from "../pickers/selector-navigation.ts";

type Accessor<T> = () => T;

interface ScrollBoxLike {
  scrollChildIntoView(childId: string): void;
  scrollTo(offset: number): void;
}

/** Register cursor style syncing for prompt and picker inputs. */
export function registerCursorStyleSync(
  color: Accessor<string>,
  getInputs: () => readonly (PromptRenderable | undefined)[]
): void {
  {
    const cursorColor = color();
    for (const input of getInputs()) {
      applyInputCursorStyle(input, cursorColor);
    }
  }
}

/** Register model picker scroll position syncing. */
export function registerModelPickerScrollSync(options: {
  readonly open: Accessor<boolean>;
  readonly scrollBox: Accessor<ScrollBoxLike | undefined>;
  readonly renderedLines: Accessor<readonly ModelPickerRenderedLine[]>;
  readonly windowStart: Accessor<number>;
}): void {
  {
    const scrollBox = options.scrollBox();
    const renderedLines = options.renderedLines();
    const windowStart = options.windowStart();

    if (!options.open() || scrollBox === undefined || renderedLines.length <= 0) {
      return;
    }

    scrollBox.scrollTo(windowStart);
  }
}

/** Register history picker scroll position syncing. */
export function registerHistoryPickerScrollSync(options: {
  readonly open: Accessor<boolean>;
  readonly query: Accessor<string>;
  readonly scrollBox: Accessor<ScrollBoxLike | undefined>;
  readonly windowStart: Accessor<number>;
}): void {
  {
    const scrollBox = options.scrollBox();
    const windowStart = options.windowStart();

    options.query();

    if (!options.open() || scrollBox === undefined) {
      return;
    }

    scrollBox.scrollTo(getHistoryPickerScrollOffset(windowStart));
  }
}

/** Register child selection syncing for simple indexed picker overlays. */
export function registerIndexedPickerSelectionSync<TItem>(options: {
  readonly open: Accessor<boolean>;
  readonly scrollBox: Accessor<ScrollBoxLike | undefined>;
  readonly items: Accessor<readonly TItem[]>;
  readonly selectedIndex: Accessor<number>;
  readonly childIdPrefix: string;
}): void {
  {
    const items = options.items();
    if (items.length <= 0) {
      return;
    }

    syncScrollBoxSelection(
      options.open(),
      options.scrollBox(),
      getIndexedPickerChildId(options.childIdPrefix, options.selectedIndex(), items.length)
    );
  }
}
