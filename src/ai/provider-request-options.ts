/**
 * Provider-specific request shaping for Recode's custom AI transport.
 */

import type { AiModel } from "./types.ts";
import {
  isJsonObject,
  mergeJsonObjects,
  type JsonObject,
  type JsonValue
} from "../shared/json-value.ts";

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 750;
const DEFAULT_RETRY_MAX_DELAY_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CHUNK_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

const TRANSPORT_OPTION_KEYS = new Set([
  "timeoutMs",
  "chunkTimeoutMs",
  "maxRetries",
  "maxRetryDelayMs",
  "retryInitialDelayMs",
  "retryMaxDelayMs"
]);

const RECODE_OPTION_KEYS = new Set([
  "compat",
  "cacheRetention",
  "reasoningEffort"
]);

/**
 * Transport-level settings extracted from provider options.
 */
export interface ProviderTransportSettings {
  readonly maxRetries: number;
  readonly retryInitialDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly timeoutMs: number;
  readonly chunkTimeoutMs: number;
}

/**
 * Build HTTP headers common to JSON provider requests.
 */
export function buildProviderHeaders(
  model: AiModel,
  baseHeaders: Readonly<Record<string, string>>,
  requestAffinityKey: string | undefined
): Readonly<Record<string, string>> {
  return {
    "user-agent": "recode/0.1.0",
    ...(requestAffinityKey === undefined ? {} : { "x-session-affinity": requestAffinityKey }),
    ...baseHeaders,
    ...(model.providerHeaders ?? {})
  };
}

/**
 * Build extra request-body options that are safe to send to the provider.
 */
export function buildProviderBodyOptions(
  model: AiModel,
  requestAffinityKey: string | undefined
): JsonObject {
  const configuredOptions = providerBodyOptions(model.providerOptions);
  const defaults = defaultProviderBodyOptions(model, configuredOptions, requestAffinityKey);
  return mergeJsonObjects(defaults, configuredOptions) ?? {};
}

/**
 * Extract retry and timeout settings from provider options.
 */
export function buildProviderTransportSettings(model: AiModel): ProviderTransportSettings {
  const options = model.providerOptions ?? {};
  return {
    maxRetries: readPositiveIntegerOption(options, "maxRetries") ?? DEFAULT_MAX_RETRIES,
    retryInitialDelayMs: readPositiveIntegerOption(options, "retryInitialDelayMs") ?? DEFAULT_RETRY_INITIAL_DELAY_MS,
    retryMaxDelayMs: readPositiveIntegerOption(options, "retryMaxDelayMs") ?? DEFAULT_RETRY_MAX_DELAY_MS,
    maxRetryDelayMs: readPositiveIntegerOption(options, "maxRetryDelayMs") ?? DEFAULT_MAX_RETRY_DELAY_MS,
    timeoutMs: readPositiveIntegerOption(options, "timeoutMs") ?? DEFAULT_TIMEOUT_MS,
    chunkTimeoutMs: readPositiveIntegerOption(options, "chunkTimeoutMs") ?? DEFAULT_CHUNK_TIMEOUT_MS
  };
}

/**
 * Merge provider body options into a request body.
 */
export function mergeRequestBodyOptions(
  body: Record<string, unknown>,
  options: JsonObject
): Record<string, unknown> {
  return {
    ...body,
    ...options
  };
}

function defaultProviderBodyOptions(
  model: AiModel,
  configuredOptions: JsonObject,
  requestAffinityKey: string | undefined
): JsonObject {
  const defaults: Record<string, JsonValue> = {};

  if (isOpenRouterModel(model)) {
    defaults["usage"] = { include: true };

    if (!hasConfiguredProviderRouting(configuredOptions)) {
      defaults["provider"] = { sort: "latency" };
    }

    if (requestAffinityKey !== undefined && configuredOptions["prompt_cache_key"] === undefined) {
      defaults["prompt_cache_key"] = requestAffinityKey;
    }
  }

  if (isNativeOpenAiModel(model) && configuredOptions["store"] === undefined) {
    defaults["store"] = false;
  }

  if (isNativeOpenAiModel(model) && supportsOpenAiReasoningOptions(model.modelId) && configuredOptions["reasoning"] === undefined) {
    defaults["reasoning"] = {
      summary: "auto"
    };
  }

  return defaults;
}

function providerBodyOptions(options: JsonObject | undefined): JsonObject {
  if (options === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !TRANSPORT_OPTION_KEYS.has(key) && !RECODE_OPTION_KEYS.has(key))
  );
}

function hasConfiguredProviderRouting(options: JsonObject): boolean {
  const provider = options["provider"];
  if (!isJsonObject(provider)) {
    return false;
  }

  return [
    "order",
    "allow_fallbacks",
    "require_parameters",
    "data_collection",
    "zdr",
    "only",
    "ignore",
    "quantizations",
    "sort",
    "max_price"
  ].some((key) => provider[key] !== undefined);
}

function isOpenRouterModel(model: AiModel): boolean {
  const baseUrl = (model.baseUrl ?? "").toLowerCase();
  return model.providerId.toLowerCase().includes("openrouter")
    || baseUrl.includes("openrouter.ai");
}

function isNativeOpenAiModel(model: AiModel): boolean {
  const baseUrl = (model.baseUrl ?? "").toLowerCase();
  return model.provider === "openai"
    && baseUrl.includes("api.openai.com");
}

function supportsOpenAiReasoningOptions(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.startsWith("gpt-5")
    || /^o[1-9](?:-|$)/.test(normalized)
    || normalized.startsWith("computer-use-preview");
}

function readPositiveIntegerOption(options: JsonObject, key: string): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
