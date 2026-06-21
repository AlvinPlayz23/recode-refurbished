/**
 * JSON helpers used by provider adapters.
 */

import { isRecord } from "../shared/is-record.ts";
import { parse as parsePartialJson } from "partial-json";

const VALID_JSON_ESCAPES = new Set(["\"", "\\", "/", "b", "f", "n", "r", "t", "u"]);

/**
 * Parse a JSON object string into a plain record.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  if (text.trim() === "") {
    return {};
  }

  const parsedValue: unknown = JSON.parse(text);

  if (!isRecord(parsedValue)) {
    throw new Error("Tool arguments must decode to a JSON object.");
  }

  return parsedValue;
}

/**
 * Parse a JSON string into a plain record and attach provider-specific context on failure.
 */
export function parseProviderToolArguments(text: string, provider: string, toolName: string): Record<string, unknown> {
  try {
    return parseJsonObject(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid tool arguments from ${provider} for ${toolName}: ${message}`);
  }
}

/**
 * Parse possibly incomplete streamed JSON into an object.
 */
export function parseStreamingJsonObject(text: string): Record<string, unknown> {
  if (text.trim() === "") {
    return {};
  }

  try {
    return parseJsonObject(text);
  } catch {
    try {
      const parsedValue: unknown = parsePartialJson(repairJson(text));
      return isRecord(parsedValue) ? parsedValue : {};
    } catch {
      return {};
    }
  }
}

/**
 * Repair common malformed JSON string literal escapes before parsing.
 */
export function repairJson(text: string): string {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) {
      continue;
    }

    if (!inString) {
      repaired += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (char === "\"") {
      repaired += char;
      inString = false;
      continue;
    }

    if (char === "\\") {
      const nextChar = text[index + 1];
      if (nextChar === undefined) {
        repaired += "\\\\";
        continue;
      }

      if (nextChar === "u") {
        const unicodeDigits = text.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`;
          index += 5;
          continue;
        }
      }

      if (VALID_JSON_ESCAPES.has(nextChar)) {
        repaired += `\\${nextChar}`;
        index += 1;
        continue;
      }

      repaired += "\\\\";
      continue;
    }

    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
  }

  return repaired;
}

function isControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

function escapeControlCharacter(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
  }
}
