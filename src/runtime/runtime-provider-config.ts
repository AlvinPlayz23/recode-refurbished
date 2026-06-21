/**
 * Runtime provider metadata assembly.
 */

import type {
  ConfiguredModel,
  ConfiguredProvider
} from "../config/recode-config.ts";
import {
  getDefaultProviderBaseUrl,
  type ProviderKind
} from "../providers/provider-kind.ts";
import { mergeJsonObjects, type JsonObject } from "../shared/json-value.ts";

/**
 * Runtime provider metadata.
 */
export interface RuntimeProviderConfig extends ConfiguredProvider {
  readonly source: "config" | "env";
}

/**
 * Environment-level provider overrides.
 */
export interface RuntimeProviderOverrides {
  readonly kind?: ProviderKind;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly options?: JsonObject;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly toolChoice?: "auto" | "required";
}

/**
 * Build runtime provider metadata from persisted providers plus env overrides.
 */
export function buildRuntimeProviders(
  configuredProviders: readonly ConfiguredProvider[],
  overrides: RuntimeProviderOverrides,
  activeProviderId: string,
  activeProviderName: string
): readonly RuntimeProviderConfig[] {
  const providers = configuredProviders.map((provider): RuntimeProviderConfig => ({
    ...provider,
    source: "config"
  }));

  if (!hasProviderOverrides(overrides)) {
    return providers;
  }

  const existingProviderIndex = providers.findIndex((provider) => provider.id === activeProviderId);
  const existingProvider = existingProviderIndex === -1 ? undefined : providers[existingProviderIndex];
  const envProvider = buildEnvProvider(overrides, activeProviderId, activeProviderName, existingProvider);

  if (existingProviderIndex === -1) {
    return [...providers, envProvider];
  }

  return providers.map((provider, index) => index === existingProviderIndex ? envProvider : provider);
}

function hasProviderOverrides(overrides: RuntimeProviderOverrides): boolean {
  return overrides.kind !== undefined
    || overrides.baseUrl !== undefined
    || overrides.apiKey !== undefined
    || overrides.headers !== undefined
    || overrides.options !== undefined
    || overrides.model !== undefined
    || overrides.maxOutputTokens !== undefined
    || overrides.temperature !== undefined
    || overrides.toolChoice !== undefined;
}

function buildEnvProvider(
  overrides: RuntimeProviderOverrides,
  activeProviderId: string,
  activeProviderName: string,
  existingProvider: RuntimeProviderConfig | undefined
): RuntimeProviderConfig {
  const kind = overrides.kind ?? existingProvider?.kind ?? "openai";

  return {
    id: activeProviderId,
    name: activeProviderName,
    kind,
    baseUrl: overrides.baseUrl ?? existingProvider?.baseUrl ?? getDefaultProviderBaseUrl(kind),
    models: buildRuntimeModels(existingProvider, overrides.model),
    ...(overrides.model === undefined
      ? (existingProvider?.defaultModelId === undefined ? {} : { defaultModelId: existingProvider.defaultModelId })
      : { defaultModelId: overrides.model }),
    ...(overrides.maxOutputTokens === undefined
      ? (existingProvider?.maxOutputTokens === undefined ? {} : { maxOutputTokens: existingProvider.maxOutputTokens })
      : { maxOutputTokens: overrides.maxOutputTokens }),
    ...(overrides.temperature === undefined
      ? (existingProvider?.temperature === undefined ? {} : { temperature: existingProvider.temperature })
      : { temperature: overrides.temperature }),
    ...(overrides.toolChoice === undefined
      ? (existingProvider?.toolChoice === undefined ? {} : { toolChoice: existingProvider.toolChoice })
      : { toolChoice: overrides.toolChoice }),
    ...(overrides.apiKey === undefined
      ? (existingProvider?.apiKey === undefined ? {} : { apiKey: existingProvider.apiKey })
      : { apiKey: overrides.apiKey }),
    ...mergeOptionalStringRecords("headers", existingProvider?.headers, overrides.headers),
    ...mergeOptionalJsonObjects("options", existingProvider?.options, overrides.options),
    source: "env"
  };
}

function buildRuntimeModels(
  existingProvider: RuntimeProviderConfig | undefined,
  overrideModel: string | undefined
): readonly ConfiguredModel[] {
  if (overrideModel === undefined) {
    return existingProvider?.models ?? [];
  }

  return [
    existingProvider?.models.find((model) => model.id === overrideModel) ?? { id: overrideModel }
  ];
}

function mergeOptionalStringRecords<TKey extends string>(
  key: TKey,
  base: Readonly<Record<string, string>> | undefined,
  override: Readonly<Record<string, string>> | undefined
): { readonly [K in TKey]?: Readonly<Record<string, string>> } {
  if (base === undefined && override === undefined) {
    return {};
  }

  return {
    [key]: {
      ...(base ?? {}),
      ...(override ?? {})
    }
  } as { readonly [K in TKey]?: Readonly<Record<string, string>> };
}

function mergeOptionalJsonObjects<TKey extends string>(
  key: TKey,
  base: JsonObject | undefined,
  override: JsonObject | undefined
): { readonly [K in TKey]?: JsonObject } {
  const merged = mergeJsonObjects(base, override);
  return merged === undefined
    ? {}
    : { [key]: merged } as { readonly [K in TKey]?: JsonObject };
}
