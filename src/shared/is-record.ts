/**
 * Generic object type guard.
 *
 * @author dev
 */

/**
 * Check whether a value is a plain record object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
