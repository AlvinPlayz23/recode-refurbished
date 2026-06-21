/**
 * Shared SDK client and request option helpers.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AiApiKind, AiModel, ProviderStatusEvent } from "./types.ts";
import { buildProviderHeaders, buildProviderTransportSettings } from "./provider-request-options.ts";
import { ensureOpenAiOAuthSession } from "../providers/openai-oauth-auth.ts";

const EMPTY_API_KEY_PLACEHOLDER = "recode-empty-api-key";
const OPENAI_OAUTH_BETA_HEADER = "responses=experimental";
const OPENAI_OAUTH_ORIGINATOR = "codex_cli_rs";

/**
 * Build an OpenAI SDK client for native and OpenAI-compatible APIs.
 */
export function createOpenAiSdkClient(
  model: AiModel,
  requestAffinityKey: string | undefined,
  operation: AiApiKind,
  onProviderStatus: ((event: ProviderStatusEvent) => void) | undefined
): OpenAI {
  const settings = buildProviderTransportSettings(model);
  const observedFetch = createObservedFetch(operation, settings.maxRetries, onProviderStatus);
  return new OpenAI({
    apiKey: model.apiKey === "" ? EMPTY_API_KEY_PLACEHOLDER : model.apiKey,
    baseURL: model.baseUrl ?? "https://api.openai.com/v1",
    defaultHeaders: buildProviderHeaders(model, {}, requestAffinityKey),
    maxRetries: settings.maxRetries,
    timeout: settings.timeoutMs,
    fetch: model.provider === "openai-oauth"
      ? createOpenAiOAuthFetch(observedFetch, requestAffinityKey)
      : observedFetch
  });
}

/**
 * Build an Anthropic SDK client.
 */
export function createAnthropicSdkClient(
  model: AiModel,
  requestAffinityKey: string | undefined,
  operation: AiApiKind,
  onProviderStatus: ((event: ProviderStatusEvent) => void) | undefined,
  betaFeatures: readonly string[] = []
): Anthropic {
  const settings = buildProviderTransportSettings(model);
  const headers = buildProviderHeaders(model, {
    ...(betaFeatures.length === 0 ? {} : { "anthropic-beta": betaFeatures.join(",") })
  }, requestAffinityKey);

  return new Anthropic({
    apiKey: model.apiKey === "" ? EMPTY_API_KEY_PLACEHOLDER : model.apiKey,
    baseURL: model.baseUrl ?? "https://api.anthropic.com/v1",
    defaultHeaders: headers,
    maxRetries: settings.maxRetries,
    timeout: settings.timeoutMs,
    fetch: createObservedFetch(operation, settings.maxRetries, onProviderStatus)
  });
}

/**
 * Build per-request SDK options with abort support.
 */
export function buildSdkRequestOptions(
  model: AiModel,
  abortSignal: AbortSignal | undefined
): {
  readonly maxRetries: number;
  readonly timeout: number;
  readonly signal?: AbortSignal;
} {
  const settings = buildProviderTransportSettings(model);
  return {
    maxRetries: settings.maxRetries,
    timeout: settings.timeoutMs,
    ...(abortSignal === undefined ? {} : { signal: abortSignal })
  };
}

function createObservedFetch(
  operation: AiApiKind,
  maxRetries: number,
  onProviderStatus: ((event: ProviderStatusEvent) => void) | undefined
): typeof fetch {
  let attempt = 0;
  const observedFetch = (async (input, init) => {
    attempt += 1;
    onProviderStatus?.({
      type: attempt === 1 ? "request-start" : "retry",
      operation,
      attempt,
      maxAttempts: maxRetries + 1
    });
    return await fetch(input, init);
  }) as typeof fetch;

  observedFetch.preconnect = fetch.preconnect;
  return observedFetch;
}

function createOpenAiOAuthFetch(
  baseFetch: typeof fetch,
  requestAffinityKey: string | undefined
): typeof fetch {
  const oauthFetch = (async (input, init) => {
    const session = await ensureOpenAiOAuthSession();
    const url = rewriteOpenAiOAuthUrl(input);
    const requestInit = transformOpenAiOAuthRequestInit(init, session.accountId, session.token.access, requestAffinityKey);
    return await baseFetch(url, requestInit);
  }) as typeof fetch;

  oauthFetch.preconnect = fetch.preconnect;
  return oauthFetch;
}

function rewriteOpenAiOAuthUrl(input: Request | string | URL): string | Request | URL {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  return url.replace("/responses", "/codex/responses");
}

function transformOpenAiOAuthRequestInit(
  init: RequestInit | undefined,
  accountId: string,
  accessToken: string,
  requestAffinityKey: string | undefined
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.delete("x-api-key");
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("OpenAI-Beta", OPENAI_OAUTH_BETA_HEADER);
  headers.set("originator", OPENAI_OAUTH_ORIGINATOR);
  headers.set("accept", "text/event-stream");

  if (requestAffinityKey !== undefined) {
    headers.set("conversation_id", requestAffinityKey);
    headers.set("session_id", requestAffinityKey);
  }

  return {
    ...init,
    headers,
    ...(init?.body === undefined || init.body === null ? {} : { body: transformOpenAiOAuthBody(init.body) })
  };
}

function transformOpenAiOAuthBody(
  body: NonNullable<RequestInit["body"]>
): NonNullable<RequestInit["body"]> {
  if (typeof body !== "string") {
    return body;
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed["store"] = false;
    parsed["stream"] = true;
    parsed["include"] = mergeStringList(parsed["include"], "reasoning.encrypted_content");
    if (!isRecordLike(parsed["reasoning"])) {
      parsed["reasoning"] = { summary: "auto" };
    }
    delete parsed["max_output_tokens"];
    delete parsed["max_completion_tokens"];
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

function mergeStringList(value: unknown, requiredValue: string): readonly string[] {
  const list = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  return list.includes(requiredValue) ? list : [...list, requiredValue];
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
