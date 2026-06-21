/**
 * Shared JSON readers for provider adapters.
 */

/**
 * Read a required object property.
 */
export function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected '${key}' to be an object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read an optional object property.
 */
export function readOptionalRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Read a required string property.
 */
export function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected '${key}' to be a string.`);
  }
  return value;
}

/**
 * Read an optional string property.
 */
export function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Read a required number property.
 */
export function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected '${key}' to be a number.`);
  }
  return value;
}

/**
 * Read an optional finite number, including dotted nested keys.
 */
export function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (key.includes(".")) {
    const [head, ...tail] = key.split(".");
    const next = head === undefined ? undefined : record[head];
    if (tail.length === 0 || next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      return undefined;
    }
    return readOptionalNumber(next as Record<string, unknown>, tail.join("."));
  }

  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Strip provider-specific suffixes from stored tool-call IDs.
 */
export function splitToolCallId(toolCallId: string): string {
  const separatorIndex = toolCallId.indexOf("|");
  return separatorIndex === -1 ? toolCallId : toolCallId.slice(0, separatorIndex);
}
