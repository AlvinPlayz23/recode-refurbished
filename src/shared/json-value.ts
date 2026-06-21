/**
 * JSON value helpers for user-configurable provider options.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

/**
 * Return true when a value can be safely persisted as JSON config data.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isJsonObjectLike(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

/**
 * Return true when a value is a JSON object.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonObjectLike(value) && Object.values(value).every(isJsonValue);
}

/**
 * Deep-merge two JSON option objects.
 */
export function mergeJsonObjects(
  base: JsonObject | undefined,
  override: JsonObject | undefined
): JsonObject | undefined {
  if (base === undefined) {
    return override;
  }

  if (override === undefined) {
    return base;
  }

  const result: Record<string, JsonValue> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isJsonObject(current) && isJsonObject(value)
      ? mergeJsonObjects(current, value) ?? value
      : value;
  }

  return result;
}

function isJsonObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}
