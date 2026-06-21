/**
 * Shared TUI error formatting helpers.
 */

/** Convert an unknown thrown value into a short display message. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
