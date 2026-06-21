/**
 * Shared HTTP helpers used by provider adapters.
 */

import { isRecord } from "../shared/is-record.ts";

/**
 * Join a base URL and path without producing duplicate slashes.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
}

/**
 * Read a failed response body and extract a readable error message.
 */
export async function readErrorMessage(response: Response): Promise<string> {
  const rawText = await response.text();

  if (rawText.trim() === "") {
    return `HTTP ${response.status} ${response.statusText}`;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawText);

    if (!isRecord(parsedValue)) {
      return rawText;
    }

    const errorValue = parsedValue["error"];

    if (typeof errorValue === "string") {
      return errorValue;
    }

    if (isRecord(errorValue)) {
      const message = errorValue["message"];
      if (typeof message === "string" && message.trim() !== "") {
        return message;
      }

      const type = errorValue["type"];
      if (typeof type === "string" && type.trim() !== "") {
        return `${type}: ${rawText}`;
      }
    }

    const message = parsedValue["message"];
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  } catch {
    return rawText;
  }

  return rawText;
}
