/**
 * Prompt draft normalization helpers.
 */

/**
 * Check whether a draft is in slash-command mode.
 */
export function isCommandDraft(value: string): boolean {
  return value.trimStart().startsWith("/");
}

/**
 * Convert an internal prompt draft into the visible textarea value.
 */
export function toVisibleDraft(value: string): string {
  return isCommandDraft(value) ? value.replace(/^\s*\/?/, "") : value;
}

/**
 * Normalize textarea content back into the internal prompt draft.
 */
export function normalizeDraftInput(previousDraft: string, nextValue: string): string {
  if (nextValue.startsWith("/")) {
    return nextValue;
  }

  if (previousDraft === "/" && nextValue === "") {
    return "/";
  }

  if (isCommandDraft(previousDraft)) {
    return nextValue === "" ? "" : `/${nextValue}`;
  }

  return nextValue;
}
