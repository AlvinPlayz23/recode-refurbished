/**
 * Provider error formatting for model request failures.
 */

import { isRecord } from "../shared/is-record.ts";
import type { AiModel } from "./types.ts";

/**
 * Convert SDK and provider errors into concise user-facing messages.
 */
export function formatProviderError(error: unknown, model?: AiModel): string {
  const status = readNumberProperty(error, "status");
  const retryAfter = readRetryAfter(error);
  const providerPrefix = model === undefined
    ? "Provider request failed"
    : `${model.providerName} request failed for ${model.modelId}`;
  const details = readProviderDetails(error);

  switch (status) {
    case 400:
      return joinMessageParts([
        `${providerPrefix}: the provider rejected the request (HTTP 400).`,
        "This is usually a model/provider compatibility issue or an unsupported option.",
        details
      ]);
    case 401:
      return joinMessageParts([
        `${providerPrefix}: authentication failed (HTTP 401).`,
        "Check the API key configured for this provider.",
        details
      ]);
    case 403:
      return joinMessageParts([
        `${providerPrefix}: access was denied (HTTP 403).`,
        "Check account permissions, model access, or provider-region restrictions.",
        details
      ]);
    case 404:
      return joinMessageParts([
        `${providerPrefix}: model or endpoint was not found (HTTP 404).`,
        "Check the model ID and base URL.",
        details
      ]);
    case 408:
      return joinMessageParts([
        `${providerPrefix}: the provider request timed out (HTTP 408).`,
        "Try again, or increase providerOptions.timeoutMs for this provider.",
        details
      ]);
    case 413:
      return joinMessageParts([
        `${providerPrefix}: the request is too large for the provider (HTTP 413).`,
        "Compact the conversation or use a model with a larger context window.",
        details
      ]);
    case 429:
      return joinMessageParts([
        `${providerPrefix}: rate limited by the provider (HTTP 429).`,
        retryAfter === undefined ? undefined : `Retry after ${retryAfter}.`,
        "Retries were attempted when enabled; wait a moment, lower concurrency, or check quota/billing.",
        details
      ]);
    case 500:
    case 502:
    case 503:
    case 504:
      return joinMessageParts([
        `${providerPrefix}: provider service error (HTTP ${status}).`,
        "Retries were attempted when enabled; try again or switch providers if it keeps happening.",
        details
      ]);
    default:
      break;
  }

  if (isTimeoutError(error)) {
    return joinMessageParts([
      `${providerPrefix}: request timed out.`,
      "Try again, or increase providerOptions.timeoutMs for this provider.",
      details
    ]);
  }

  if (isConnectionError(error)) {
    return joinMessageParts([
      `${providerPrefix}: could not reach the provider.`,
      "Check your network connection, base URL, proxy, or provider status.",
      details
    ]);
  }

  if (status !== undefined) {
    return joinMessageParts([
      `${providerPrefix}: provider returned HTTP ${status}.`,
      details
    ]);
  }

  return joinMessageParts([
    providerPrefix,
    details ?? stringifyUnknownError(error)
  ]);
}

function readProviderDetails(error: unknown): string | undefined {
  const messages = [
    readNestedMessage(error, ["error", "message"]),
    readStringProperty(error, "message"),
    readStringProperty(error, "code"),
    readStringProperty(error, "type"),
    readNestedMessage(error, ["error", "code"]),
    readNestedMessage(error, ["error", "type"])
  ].filter((value): value is string => value !== undefined && value.trim() !== "");

  const unique = [...new Set(messages.map((message) => cleanProviderMessage(message)))];
  if (unique.length === 0) {
    return undefined;
  }

  return `Details: ${unique.join(" · ")}`;
}

function readNestedMessage(error: unknown, path: readonly string[]): string | undefined {
  let current: unknown = error;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }

  return typeof current === "string" ? current : undefined;
}

function readRetryAfter(error: unknown): string | undefined {
  const headers = isRecord(error) ? error["headers"] : undefined;
  const retryAfter = readHeader(headers, "retry-after") ?? readHeader(headers, "retry-after-ms");
  if (retryAfter === undefined || retryAfter.trim() === "") {
    return undefined;
  }

  return retryAfter.trim().endsWith("ms") || retryAfter.trim().endsWith("s")
    ? retryAfter.trim()
    : `${retryAfter.trim()}s`;
}

function readHeader(headers: unknown, key: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }

  if (!isRecord(headers)) {
    return undefined;
  }

  const direct = headers[key];
  if (typeof direct === "string") {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey && typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function readNumberProperty(value: unknown, property: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawValue = value[property];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : undefined;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawValue = value[property];
  return typeof rawValue === "string" ? rawValue : undefined;
}

function cleanProviderMessage(message: string): string {
  return message
    .replace(/^Error:\s*/i, "")
    .replace(/^Provider request failed:?\s*/i, "")
    .replace(/^\d{3}\s+/, "")
    .trim();
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedName = error.name.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();
  return normalizedName.includes("timeout") || normalizedMessage.includes("timed out");
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedName = error.name.toLowerCase();
  return normalizedName.includes("connection") || error instanceof TypeError;
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return cleanProviderMessage(error.message);
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function joinMessageParts(parts: readonly (string | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== undefined && part.trim() !== "")
    .join(" ");
}
