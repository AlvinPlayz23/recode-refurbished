/**
 * Model listing helpers for configured providers.
 *
 * @author dev
 */

import type { ConfiguredModel, ConfiguredProvider } from "../config/recode-config.ts";
import { readErrorMessage } from "../ai/http.ts";
import { providerSupportsModelListing } from "../providers/provider-kind.ts";
import { ensureOpenAiOAuthSession } from "../providers/openai-oauth-auth.ts";
import { isRecord } from "../shared/is-record.ts";

const OPENAI_OAUTH_DEFAULT_MODELS: readonly ConfiguredModel[] = [
  { id: "gpt-5.2-codex" },
  { id: "gpt-5.2-codex-high" },
  { id: "gpt-5.2-codex-xhigh" },
  { id: "gpt-5.1-codex" },
  { id: "gpt-5.1-codex-high" },
  { id: "gpt-5.1-codex-mini" },
  { id: "gpt-5.1-codex-mini-high" }
];

/**
 * One listed model for display and selection.
 */
export interface ListedModel extends ConfiguredModel {
  readonly providerId: string;
  readonly providerName: string;
  readonly active: boolean;
  readonly source: "remote" | "config";
}

/**
 * Grouped model listing for one provider.
 */
export interface ListedModelGroup {
  readonly providerId: string;
  readonly providerName: string;
  readonly providerKind: ConfiguredProvider["kind"];
  readonly baseUrl: string;
  readonly active: boolean;
  readonly models: readonly ListedModel[];
  readonly error?: string;
}

/**
 * List models for one configured provider.
 */
export async function listModelsForProvider(
  provider: ConfiguredProvider,
  activeProviderId: string,
  refresh: boolean
): Promise<ListedModelGroup> {
  const active = provider.id === activeProviderId;

  if (!refresh || !providerSupportsModelListing(provider.kind)) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      baseUrl: provider.baseUrl,
      active,
      models: toListedModels(provider, provider.models, active)
    };
  }

  try {
    const remoteModels = provider.kind === "openai-oauth"
      ? await fetchOpenAiOAuthModels(provider)
      : await fetchOpenAiCompatibleModels(provider);
    const mergedModels = mergeConfiguredAndRemoteModels(provider.models, remoteModels);

    return {
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      baseUrl: provider.baseUrl,
      active,
      models: toListedModels(provider, mergedModels, active)
    };
  } catch (error) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      baseUrl: provider.baseUrl,
      active,
      models: toListedModels(
        provider,
        provider.kind === "openai-oauth"
          ? mergeConfiguredAndRemoteModels(provider.models, OPENAI_OAUTH_DEFAULT_MODELS)
          : provider.models,
        active
      ),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Fetch models from an OpenAI-compatible `/models` endpoint.
 */
export async function fetchOpenAiCompatibleModels(provider: Pick<ConfiguredProvider, "baseUrl" | "apiKey">): Promise<readonly ConfiguredModel[]> {
  const headers: Record<string, string> = {
    accept: "application/json"
  };

  if (provider.apiKey !== undefined && provider.apiKey !== "") {
    headers.authorization = `Bearer ${provider.apiKey}`;
  }

  const response = await fetch(joinUrl(provider.baseUrl, "/models"), { headers });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return parseModelListPayload(await response.json());
}

/**
 * Fetch models from the ChatGPT/Codex backend.
 */
export async function fetchOpenAiOAuthModels(provider: Pick<ConfiguredProvider, "baseUrl">): Promise<readonly ConfiguredModel[]> {
  const session = await ensureOpenAiOAuthSession();
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${session.token.access}`,
    "chatgpt-account-id": session.accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs"
  };
  const paths = ["/models", "/codex/models"];
  let lastError: Error | undefined;

  for (const path of paths) {
    try {
      const response = await fetch(joinUrl(provider.baseUrl, path), { headers });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const remoteModels = parseModelListPayload(await response.json());
      if (remoteModels.length > 0) {
        return mergeConfiguredAndRemoteModels(OPENAI_OAUTH_DEFAULT_MODELS, remoteModels);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }

  return OPENAI_OAUTH_DEFAULT_MODELS;
}

/**
 * Return seeded Codex model IDs for setup fallback.
 */
export function getOpenAiOAuthDefaultModels(): readonly ConfiguredModel[] {
  return OPENAI_OAUTH_DEFAULT_MODELS;
}

function parseModelListPayload(payload: unknown): readonly ConfiguredModel[] {
  if (!isRecord(payload)) {
    throw new Error("Model list response must be a JSON object.");
  }

  const data = payload["data"];
  if (!Array.isArray(data)) {
    throw new Error("Model list response is missing a 'data' array.");
  }

  const models = data
    .map(parseOpenAiCompatibleModel)
    .filter((model) => model !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));

  return models;
}

function parseOpenAiCompatibleModel(value: unknown): ConfiguredModel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = typeof value["id"] === "string" ? value["id"].trim() : "";
  if (id === "") {
    return undefined;
  }

  const label = typeof value["name"] === "string" && value["name"].trim() !== ""
    ? value["name"].trim()
    : undefined;

  return {
    id,
    ...(label === undefined ? {} : { label })
  };
}

function toListedModels(
  provider: ConfiguredProvider,
  models: readonly ConfiguredModel[],
  providerActive: boolean
): readonly ListedModel[] {
  const activeModelId = provider.defaultModelId;

  return models.map((model) => ({
    ...model,
    providerId: provider.id,
    providerName: provider.name,
    active: providerActive && activeModelId === model.id,
    source: "config" as const
  }));
}

function mergeConfiguredAndRemoteModels(
  configuredModels: readonly ConfiguredModel[],
  remoteModels: readonly ConfiguredModel[]
): readonly ConfiguredModel[] {
  const merged = new Map<string, ConfiguredModel>();

  for (const model of configuredModels) {
    merged.set(model.id, model);
  }

  for (const model of remoteModels) {
    const existingModel = merged.get(model.id);
    merged.set(model.id, {
      ...(existingModel ?? {}),
      ...model,
      ...(existingModel?.contextWindowTokens === undefined ? {} : { contextWindowTokens: existingModel.contextWindowTokens })
    });
  }

  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
}
