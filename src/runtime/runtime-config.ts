/**
 * Runtime configuration loader.
 *
 * @author dev
 */

import {
  loadRecodeConfigFile,
  resolveConfigPath,
  type ConfiguredAgent,
  type ConfiguredProvider
} from "../config/recode-config.ts";
import {
  getDefaultProviderBaseUrl,
  getDefaultProviderName,
  parseProviderKind,
  type ProviderKind
} from "../providers/provider-kind.ts";
import { isJsonObject, type JsonObject } from "../shared/json-value.ts";
import type { ApprovalMode, PermissionRule, ToolApprovalScope } from "../tools/tool.ts";
import {
  buildRuntimeProviders,
  type RuntimeProviderConfig
} from "./runtime-provider-config.ts";

export type { RuntimeProviderConfig } from "./runtime-provider-config.ts";

/**
 * Recode runtime config.
 */
export interface RuntimeConfig {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly provider: ProviderKind;
  readonly providerId: string;
  readonly providerName: string;
  readonly model: string;
  readonly providers: readonly RuntimeProviderConfig[];
  readonly approvalMode: ApprovalMode;
  readonly approvalAllowlist: readonly ToolApprovalScope[];
  readonly permissionRules: readonly PermissionRule[];
  readonly agents?: Readonly<Record<string, ConfiguredAgent>>;
  readonly apiKey?: string;
  readonly providerHeaders?: Readonly<Record<string, string>>;
  readonly providerOptions?: JsonObject;
  readonly baseUrl: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly toolChoice?: "auto" | "required";
  readonly contextWindowTokens?: number;
}

/**
 * Build a new runtime config that points at a selected provider and model.
 */
export function selectRuntimeProviderModel(
  runtimeConfig: RuntimeConfig,
  providerId: string,
  modelId: string
): RuntimeConfig {
  const selectedProvider = runtimeConfig.providers.find((provider) => provider.id === providerId);
  if (selectedProvider === undefined) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  if (selectedProvider.disabled === true) {
    throw new Error(`Provider is disabled: ${providerId}`);
  }

  const providers = runtimeConfig.providers.map((provider) => provider.id === providerId
    ? {
        ...provider,
        models: provider.models.some((model) => model.id === modelId)
          ? provider.models
          : [...provider.models, { id: modelId }],
        defaultModelId: modelId
      }
    : provider);
  const selectedModel = providers
    .find((provider) => provider.id === providerId)
    ?.models.find((model) => model.id === modelId);

  return {
    provider: selectedProvider.kind,
    providerId: selectedProvider.id,
    providerName: selectedProvider.name,
    model: modelId,
    providers,
    approvalMode: runtimeConfig.approvalMode,
    approvalAllowlist: runtimeConfig.approvalAllowlist,
    permissionRules: runtimeConfig.permissionRules,
    ...(runtimeConfig.agents === undefined ? {} : { agents: runtimeConfig.agents }),
    workspaceRoot: runtimeConfig.workspaceRoot,
    configPath: runtimeConfig.configPath,
    baseUrl: selectedProvider.baseUrl,
    ...(selectedProvider.maxOutputTokens === undefined ? {} : { maxOutputTokens: selectedProvider.maxOutputTokens }),
    ...(selectedProvider.temperature === undefined ? {} : { temperature: selectedProvider.temperature }),
    ...(selectedProvider.toolChoice === undefined ? {} : { toolChoice: selectedProvider.toolChoice }),
    ...(selectedModel?.contextWindowTokens === undefined ? {} : { contextWindowTokens: selectedModel.contextWindowTokens }),
    ...(selectedProvider.headers === undefined ? {} : { providerHeaders: selectedProvider.headers }),
    ...(selectedProvider.options === undefined ? {} : { providerOptions: selectedProvider.options }),
    ...(selectedProvider.apiKey === undefined ? {} : { apiKey: selectedProvider.apiKey })
  };
}

/**
 * Update one runtime model's context-window metadata.
 */
export function setRuntimeModelContextWindow(
  runtimeConfig: RuntimeConfig,
  providerId: string,
  modelId: string,
  contextWindowTokens: number
): RuntimeConfig {
  const providers = runtimeConfig.providers.map((provider) => {
    if (provider.id !== providerId) {
      return provider;
    }

    const existingModel = provider.models.find((model) => model.id === modelId);
    const nextModel = {
      ...(existingModel ?? { id: modelId }),
      contextWindowTokens
    };

    return {
      ...provider,
      models: existingModel === undefined
        ? [...provider.models, nextModel]
        : provider.models.map((model) => model.id === modelId ? nextModel : model)
    };
  });

  const isCurrentModel = runtimeConfig.providerId === providerId && runtimeConfig.model === modelId;
  return {
    ...runtimeConfig,
    providers,
    ...(isCurrentModel ? { contextWindowTokens } : (runtimeConfig.contextWindowTokens === undefined ? {} : { contextWindowTokens: runtimeConfig.contextWindowTokens }))
  };
}

/**
 * Load runtime config from config file and environment variables.
 */
export function loadRuntimeConfig(workspaceRoot: string): RuntimeConfig {
  const configPath = resolveConfigPath(workspaceRoot, readOptionalEnv("RECODE_CONFIG_PATH"));
  const config = loadRecodeConfigFile(configPath);
  const envProviderKind = parseProviderKind(readOptionalEnv("RECODE_PROVIDER"));
  const envActiveProviderId = readOptionalEnv("RECODE_ACTIVE_PROVIDER");
  const envApiKey = readOptionalEnv("RECODE_API_KEY");
  const envBaseUrl = readOptionalEnv("RECODE_BASE_URL");
  const envModel = readOptionalEnv("RECODE_MODEL");
  const envHeaders = readOptionalStringRecordJsonEnv("RECODE_PROVIDER_HEADERS");
  const envProviderOptions = readOptionalJsonObjectEnv("RECODE_PROVIDER_OPTIONS");
  const envMaxOutputTokens = readOptionalPositiveIntegerEnv("RECODE_MAX_OUTPUT_TOKENS");
  const envTemperature = readOptionalFiniteNumberEnv("RECODE_TEMPERATURE");
  const envToolChoice = parseToolChoice(readOptionalEnv("RECODE_TOOL_CHOICE"));

  const selectedConfiguredProvider = resolveSelectedConfiguredProvider(config.providers, envActiveProviderId ?? config.activeProviderId);
  const fallbackProviderKind = selectedConfiguredProvider?.kind ?? "openai";
  const providerKind = envProviderKind ?? fallbackProviderKind;
  const providerId = selectedConfiguredProvider?.id
    ?? envActiveProviderId
    ?? "active";
  const providerName = selectedConfiguredProvider?.name
    ?? getDefaultProviderName(providerKind);
  const baseUrl = envBaseUrl
    ?? selectedConfiguredProvider?.baseUrl
    ?? getDefaultProviderBaseUrl(providerKind);
  const model = envModel
    ?? selectedConfiguredProvider?.defaultModelId
    ?? selectedConfiguredProvider?.models[0]?.id;
  const apiKey = envApiKey
    ?? selectedConfiguredProvider?.apiKey;
  const providerHeaders = envHeaders
    ?? selectedConfiguredProvider?.headers;
  const providerOptions = envProviderOptions
    ?? selectedConfiguredProvider?.options;
  const maxOutputTokens = envMaxOutputTokens
    ?? selectedConfiguredProvider?.maxOutputTokens;
  const temperature = envTemperature
    ?? selectedConfiguredProvider?.temperature;
  const toolChoice = envToolChoice
    ?? selectedConfiguredProvider?.toolChoice;
  const selectedModel = selectedConfiguredProvider?.models.find((item) => item.id === model);
  const contextWindowTokens = selectedModel?.contextWindowTokens;

  if (baseUrl === undefined || baseUrl === "") {
    throw new Error("Missing provider base URL. Run `recode setup` or set RECODE_BASE_URL.");
  }

  if (model === undefined || model === "") {
    throw new Error("Missing model ID. Run `recode setup` or set RECODE_MODEL.");
  }

  const providers = buildRuntimeProviders(
    config.providers,
    {
      ...(envProviderKind === undefined ? {} : { kind: envProviderKind }),
      ...(envBaseUrl === undefined ? {} : { baseUrl: envBaseUrl }),
      ...(envApiKey === undefined ? {} : { apiKey: envApiKey }),
      ...(envHeaders === undefined ? {} : { headers: envHeaders }),
      ...(envProviderOptions === undefined ? {} : { options: envProviderOptions }),
      ...(envModel === undefined ? {} : { model: envModel }),
      ...(envMaxOutputTokens === undefined ? {} : { maxOutputTokens: envMaxOutputTokens }),
      ...(envTemperature === undefined ? {} : { temperature: envTemperature }),
      ...(envToolChoice === undefined ? {} : { toolChoice: envToolChoice })
    },
    providerId,
    providerName
  );
  const activeRuntimeProvider = providers.find((provider) => provider.id === providerId);
  const effectiveProviderHeaders = activeRuntimeProvider?.headers ?? providerHeaders;
  const effectiveProviderOptions = activeRuntimeProvider?.options ?? providerOptions;

  return {
    workspaceRoot,
    configPath,
    provider: providerKind,
    providerId,
    providerName,
    model,
    baseUrl,
    providers,
    approvalMode: config.approvalMode ?? "approval",
    approvalAllowlist: config.approvalAllowlist ?? [],
    permissionRules: config.permissionRules ?? [],
    ...(config.agents === undefined ? {} : { agents: config.agents }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
    ...(effectiveProviderHeaders === undefined ? {} : { providerHeaders: effectiveProviderHeaders }),
    ...(effectiveProviderOptions === undefined ? {} : { providerOptions: effectiveProviderOptions }),
    ...(apiKey === undefined ? {} : { apiKey })
  };
}

function readOptionalEnv(key: string): string | undefined {
  const value = Bun.env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readOptionalStringRecordJsonEnv(key: string): Readonly<Record<string, string>> | undefined {
  const value = readOptionalEnv(key);
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);
    if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
      return undefined;
    }

    const entries = Object.entries(parsedValue)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim() !== ""
      )
      .map(([entryKey, entryValue]) => [entryKey, entryValue.trim()] as const);

    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

function readOptionalJsonObjectEnv(key: string): JsonObject | undefined {
  const value = readOptionalEnv(key);
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);
    return isJsonObject(parsedValue) ? parsedValue : undefined;
  } catch {
    return undefined;
  }
}

function readOptionalPositiveIntegerEnv(key: string): number | undefined {
  const value = readOptionalEnv(key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalFiniteNumberEnv(key: string): number | undefined {
  const value = readOptionalEnv(key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseToolChoice(value: string | undefined): "auto" | "required" | undefined {
  return value === "auto" || value === "required" ? value : undefined;
}

function resolveSelectedConfiguredProvider(
  providers: readonly ConfiguredProvider[],
  activeProviderId: string | undefined
): ConfiguredProvider | undefined {
  if (activeProviderId !== undefined) {
    const activeProvider = providers.find((provider) => provider.id === activeProviderId && provider.disabled !== true);
    if (activeProvider !== undefined) {
      return activeProvider;
    }
  }

  return providers.find((provider) => provider.disabled !== true);
}
