/**
 * Shared helpers for parsing tool input arguments.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import { isRecord } from "../shared/is-record.ts";

/**
 * Ensure an unknown value is an object record.
 */
export function readToolInputRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ToolExecutionError(message);
  }

  return value;
}

/**
 * Read a required non-empty string field.
 */
export function readRequiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  message: string
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError(message);
  }

  return value;
}

/**
 * Read a required string field, allowing the empty string.
 */
export function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  message: string
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ToolExecutionError(message);
  }

  return value;
}

/**
 * Read an optional non-empty string field.
 */
export function readOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  message: string
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolExecutionError(message);
  }

  return value;
}

/**
 * Read a required boolean field.
 */
export function readRequiredBoolean(
  record: Record<string, unknown>,
  key: string,
  message: string
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new ToolExecutionError(message);
  }

  return value;
}

/**
 * Read a required array field.
 */
export function readRequiredArray(
  record: Record<string, unknown>,
  key: string,
  message: string
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ToolExecutionError(message);
  }

  return value;
}
