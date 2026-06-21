/**
 * Interactive CLI setup for providers and models.
 *
 * Interactive terminals get a themed TUI wizard (see `setup-tui.ts`).
 * Non-TTY environments fall back to the readline-based prompt loop below so
 * scripted setups still work.
 *
 * @author dev
 */

import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  loadRecodeConfigFile,
  resolveConfigPath,
  saveRecodeConfigFile,
  upsertConfiguredProvider,
  type RecodeConfigFile,
  type ConfiguredModel,
  type ConfiguredProvider
} from "../config/recode-config.ts";
import { fetchOpenAiCompatibleModels, fetchOpenAiOAuthModels, getOpenAiOAuthDefaultModels } from "../models/list-models.ts";
import { authenticateOpenAiOAuthFromInput, createOpenAiOAuthAuthorizationUrl } from "../providers/openai-oauth-auth.ts";
import {
  getDefaultProviderBaseUrl,
  getDefaultProviderName,
  providerSupportsModelListing,
  PROVIDER_PRESETS,
  type ProviderKind
} from "../providers/provider-kind.ts";
import { isJsonObject, type JsonObject } from "../shared/json-value.ts";

interface ProviderSetupResult {
  readonly provider: ConfiguredProvider;
  readonly makeActive: boolean;
}

interface ProviderChoice {
  readonly existingProvider?: ConfiguredProvider;
}

interface SelectOption<TValue> {
  readonly label: string;
  readonly value: TValue;
  readonly hint?: string;
}

/**
 * Run the interactive setup flow.
 *
 * On a TTY we hand off to the TUI wizard for a richer multi-step UI. In
 * non-interactive environments we keep the original readline-based prompt
 * loop so piped setup scripts still work.
 */
export async function runSetupWizard(workspaceRoot: string): Promise<void> {
  const configPath = resolveConfigPath(workspaceRoot, Bun.env.RECODE_CONFIG_PATH?.trim());
  const existingConfig = loadRecodeConfigFile(configPath);
  const rl = createInterface({ input: stdin, output: stdout });
  let nextConfig = existingConfig;

  console.log("Recode setup");
  console.log("");
  console.log(`Config path: ${configPath}`);
  console.log("");

  if (existingConfig.providers.length > 0) {
    console.log("Configured providers:");
    for (const provider of existingConfig.providers) {
      const activeMarker = existingConfig.activeProviderId === provider.id ? " (active)" : "";
      console.log(`- ${provider.id} -> ${provider.name}${activeMarker}`);
    }
    console.log("");
  }

  try {
    let shouldContinue = true;

    while (shouldContinue) {
      const result = await promptForProvider(rl, nextConfig);
      nextConfig = upsertConfiguredProvider(nextConfig, result.provider, result.makeActive);
      shouldContinue = await promptBooleanSelect(rl, "Add another provider?", false);
      console.log("");
    }
  } finally {
    rl.close();
  }

  saveRecodeConfigFile(configPath, nextConfig);
  console.log(`Saved provider config to ${configPath}`);
}

async function promptForProvider(
  rl: Interface,
  config: RecodeConfigFile
): Promise<ProviderSetupResult> {
  const selectedProvider = await selectProviderChoice(rl, config);
  const existingProvider = selectedProvider?.existingProvider;
  const providerKind = await askProviderKind(rl, existingProvider?.kind);
  const providerId = normalizeProviderId(await askRequired(
    rl,
    "Provider ID",
    existingProvider?.id ?? (config.providers.length === 0 ? providerKind : suggestNewProviderId(config, providerKind))
  ));
  const providerName = await askRequired(rl, "Provider name", existingProvider?.name ?? getDefaultProviderName(providerKind));
  const baseUrl = await askRequired(rl, "Base URL", existingProvider?.baseUrl ?? getDefaultProviderBaseUrl(providerKind));
  const apiKey = await askOptional(rl, "API key (leave blank if not required)", existingProvider?.apiKey);
  const maxOutputTokens = await askOptionalPositiveInteger(
    rl,
    "Max output tokens (leave blank for provider default)",
    existingProvider?.maxOutputTokens
  );
  const temperature = await askOptionalNumber(
    rl,
    "Temperature (leave blank for provider default)",
    existingProvider?.temperature
  );
  const toolChoice = await askOptionalToolChoice(
    rl,
    existingProvider?.toolChoice
  );
  const headers = await askOptionalStringRecordJson(
    rl,
    "Extra HTTP headers as JSON (leave blank for none)",
    existingProvider?.headers
  );
  const options = await askOptionalJsonObject(
    rl,
    "Provider request options as JSON (leave blank for defaults)",
    existingProvider?.options
  );
  if (providerKind === "openai-oauth") {
    await promptOpenAiOAuthLogin(rl);
  }
  const shouldFetchModels = !providerSupportsModelListing(providerKind)
    ? false
    : await promptBooleanSelect(rl, "How should models be added?", true, "Fetch from /models", "Enter model IDs manually");

  let models = existingProvider?.models ?? [];
  let defaultModelId = existingProvider?.defaultModelId;

  if (shouldFetchModels) {
    try {
      const remoteModels = providerKind === "openai-oauth"
        ? await fetchOpenAiOAuthModels({ baseUrl })
        : await fetchOpenAiCompatibleModels({
            baseUrl,
            ...(apiKey === undefined || apiKey === "" ? {} : { apiKey })
          });

      if (remoteModels.length > 0) {
        models = mergeModelsPreservingMetadata(existingProvider?.models ?? [], remoteModels);
        defaultModelId = await promptFetchedModelSelection(
          rl,
          remoteModels,
          defaultModelId ?? remoteModels[0]?.id ?? ""
        );
      } else {
        console.log("");
        console.log("The provider returned no models. You can enter model IDs manually.");
      }
    } catch (error) {
      console.log("");
      console.log(`Unable to fetch models: ${error instanceof Error ? error.message : String(error)}`);
      console.log("You can still store model IDs manually.");
    }
  }

  if (models.length === 0 || defaultModelId === undefined || defaultModelId === "") {
    if (providerKind === "openai-oauth" && models.length === 0) {
      models = getOpenAiOAuthDefaultModels();
      defaultModelId = models[0]?.id;
    }
    const manualModelIds = await askOptional(
      rl,
      "Comma-separated model IDs to store",
      existingProvider?.models.map((model) => model.id).join(", ")
    );
    models = mergeModelsPreservingMetadata(existingProvider?.models ?? [], parseManualModels(manualModelIds));
    defaultModelId = await askRequired(
      rl,
      "Default model ID",
      existingProvider?.defaultModelId ?? models[0]?.id
    );
  }

  models = ensureDefaultModel(models, defaultModelId);
  const defaultModelContextWindow = await askOptionalPositiveInteger(
    rl,
    `Context window tokens for '${defaultModelId}' (leave blank if unknown)`,
    models.find((model) => model.id === defaultModelId)?.contextWindowTokens
  );
  if (defaultModelContextWindow !== undefined) {
    models = setModelContextWindow(models, defaultModelId, defaultModelContextWindow);
  }

  const makeActive = await askYesNo(
    rl,
    "Set this as the active provider?",
    config.providers.length === 0 || existingProvider?.id === config.activeProviderId
  );

  return {
    provider: {
      id: providerId,
      name: providerName,
      kind: providerKind,
      baseUrl,
      models,
      defaultModelId,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(toolChoice === undefined ? {} : { toolChoice }),
      ...(headers === undefined ? {} : { headers }),
      ...(options === undefined ? {} : { options }),
      ...(apiKey === undefined || apiKey === "" ? {} : { apiKey })
    },
    makeActive
  };
}

async function promptOpenAiOAuthLogin(rl: Interface): Promise<void> {
  const flow = await createOpenAiOAuthAuthorizationUrl();
  console.log("");
  console.log("OpenAI Codex OAuth login");
  console.log("Open this URL, complete login, then paste the full callback URL or code:");
  console.log(flow.url);
  const callbackInput = await askRequired(rl, "OAuth callback URL or code");
  await authenticateOpenAiOAuthFromInput(callbackInput, flow.verifier);
  console.log("OAuth token saved.");
}

async function selectProviderChoice(
  rl: Interface,
  config: RecodeConfigFile
): Promise<ProviderChoice | undefined> {
  if (config.providers.length === 0) {
    return undefined;
  }

  const createNewProviderValue = "__create_new__";
  const selection = await promptSelect(
    rl,
    "Choose a provider to configure",
    [
      {
        label: "Create a new provider",
        value: createNewProviderValue,
        hint: "Add another provider definition to your global .recode/config.json"
      },
      ...config.providers.map((provider) => ({
        label: provider.name,
        value: provider.id,
        hint: `${provider.id} - ${provider.kind}${provider.id === config.activeProviderId ? " - active" : ""}`
      }))
    ],
    config.activeProviderId ?? createNewProviderValue
  );

  if (selection === createNewProviderValue) {
    return undefined;
  }

  const existingProvider = config.providers.find((provider) => provider.id === selection);
  return existingProvider === undefined ? undefined : { existingProvider };
}

async function askProviderKind(
  rl: Interface,
  defaultKind: ProviderKind | undefined
): Promise<ProviderKind> {
  return await promptSelect(
    rl,
    "Select provider kind",
    PROVIDER_PRESETS.map((preset) => ({
      label: preset.label,
      value: preset.kind,
      hint: preset.setupHint
    })),
    defaultKind ?? "openai"
  );
}

async function askRequired(
  rl: Interface,
  label: string,
  defaultValue?: string
): Promise<string> {
  while (true) {
    const value = await askOptional(rl, label, defaultValue);
    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }

    console.log(`${label} is required.`);
  }
}

async function askOptional(
  rl: Interface,
  label: string,
  defaultValue?: string
): Promise<string | undefined> {
  const suffix = defaultValue === undefined || defaultValue === "" ? "" : ` [${defaultValue}]`;
  const value = await askQuestion(rl, `${label}${suffix}: `);
  const trimmed = value.trim();

  if (trimmed === "") {
    return defaultValue?.trim() === "" ? undefined : defaultValue?.trim();
  }

  return trimmed;
}

async function askYesNo(
  rl: Interface,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
  return await promptBooleanSelect(rl, label, defaultValue);
}

async function askOptionalPositiveInteger(
  rl: Interface,
  label: string,
  defaultValue?: number
): Promise<number | undefined> {
  while (true) {
    const answer = await askOptional(rl, label, defaultValue?.toString());
    if (answer === undefined || answer.trim() === "") {
      return undefined;
    }

    const parsed = Number.parseInt(answer, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    console.log(`${label} must be a positive integer.`);
  }
}

async function askOptionalNumber(
  rl: Interface,
  label: string,
  defaultValue?: number
): Promise<number | undefined> {
  while (true) {
    const answer = await askOptional(rl, label, defaultValue?.toString());
    if (answer === undefined || answer.trim() === "") {
      return undefined;
    }

    const parsed = Number.parseFloat(answer);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    console.log(`${label} must be a number.`);
  }
}

async function askOptionalStringRecordJson(
  rl: Interface,
  label: string,
  defaultValue?: Readonly<Record<string, string>>
): Promise<Readonly<Record<string, string>> | undefined> {
  while (true) {
    const answer = await askOptional(rl, label, formatJsonDefault(defaultValue));
    if (answer === undefined || answer.trim() === "") {
      return undefined;
    }

    try {
      const parsedValue: unknown = JSON.parse(answer);
      if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
        console.log(`${label} must be a JSON object with string values.`);
        continue;
      }

      const entries = Object.entries(parsedValue);
      if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
        console.log(`${label} must be a JSON object with string values.`);
        continue;
      }

      return Object.fromEntries(entries.filter(([, value]) => value.trim() !== ""));
    } catch {
      console.log(`${label} must be valid JSON.`);
    }
  }
}

async function askOptionalJsonObject(
  rl: Interface,
  label: string,
  defaultValue?: JsonObject
): Promise<JsonObject | undefined> {
  while (true) {
    const answer = await askOptional(rl, label, formatJsonDefault(defaultValue));
    if (answer === undefined || answer.trim() === "") {
      return undefined;
    }

    try {
      const parsedValue: unknown = JSON.parse(answer);
      if (isJsonObject(parsedValue)) {
        return parsedValue;
      }

      console.log(`${label} must be a JSON object.`);
    } catch {
      console.log(`${label} must be valid JSON.`);
    }
  }
}

async function askOptionalToolChoice(
  rl: Interface,
  defaultValue?: "auto" | "required"
): Promise<"auto" | "required" | undefined> {
  const defaultOptionValue = "__default__" as const;
  const promptDefault = defaultValue ?? defaultOptionValue;
  const selection = await promptSelect<"auto" | "required" | typeof defaultOptionValue>(
    rl,
    "Preferred tool choice mode",
    [
      { label: "Provider default", value: defaultOptionValue, hint: "Do not force a tool-choice mode" },
      { label: "Auto", value: "auto", hint: "Let the model decide when to call tools" },
      { label: "Required", value: "required", hint: "Prefer tool-calling when tools are available" }
    ],
    promptDefault
  );

  return selection === defaultOptionValue ? undefined : selection;
}

function formatJsonDefault(value: JsonObject | Readonly<Record<string, string>> | undefined): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function parseManualModels(value: string | undefined): readonly ConfiguredModel[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

  return ids.map((id) => ({ id }));
}

function ensureDefaultModel(models: readonly ConfiguredModel[], defaultModelId: string): readonly ConfiguredModel[] {
  if (models.some((model) => model.id === defaultModelId)) {
    return models;
  }

  return [...models, { id: defaultModelId }];
}

function mergeModelsPreservingMetadata(
  existingModels: readonly ConfiguredModel[],
  nextModels: readonly ConfiguredModel[]
): readonly ConfiguredModel[] {
  const merged = new Map<string, ConfiguredModel>();

  for (const model of existingModels) {
    merged.set(model.id, model);
  }

  for (const model of nextModels) {
    const existingModel = merged.get(model.id);
    merged.set(model.id, {
      ...(existingModel ?? {}),
      ...model,
      ...(existingModel?.contextWindowTokens === undefined ? {} : { contextWindowTokens: existingModel.contextWindowTokens })
    });
  }

  return [...merged.values()];
}

function setModelContextWindow(
  models: readonly ConfiguredModel[],
  modelId: string,
  contextWindowTokens: number
): readonly ConfiguredModel[] {
  const existingModel = models.find((model) => model.id === modelId);
  const nextModel: ConfiguredModel = {
    ...(existingModel ?? { id: modelId }),
    contextWindowTokens
  };

  return existingModel === undefined
    ? [...models, nextModel]
    : models.map((model) => model.id === modelId ? nextModel : model);
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function suggestNewProviderId(config: RecodeConfigFile, providerKind: ProviderKind): string {
  const baseId = providerKind;
  if (!config.providers.some((provider) => provider.id === baseId)) {
    return baseId;
  }

  let index = 2;
  while (config.providers.some((provider) => provider.id === `${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

function askQuestion(rl: Interface, prompt: string): Promise<string> {
  prepareLineInput(rl);
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function promptFetchedModelSelection(
  rl: Interface,
  models: readonly ConfiguredModel[],
  defaultModelId: string
): Promise<string> {
  const modelOptions = models.slice(0, 40).map((model) => ({
    label: model.id,
    value: model.id,
    ...(model.label === undefined ? {} : { hint: model.label })
  }));
  const customOptionValue = "__custom__";
  const selection = await promptSelect(
    rl,
    "Select the default model",
    [
      ...modelOptions,
      { label: "Enter a custom model ID", value: customOptionValue, hint: "Use a model ID not shown in the fetched list" }
    ],
    defaultModelId === "" ? modelOptions[0]?.value ?? customOptionValue : defaultModelId
  );

  if (selection !== customOptionValue) {
    return selection;
  }

  return await askRequired(rl, "Custom model ID", defaultModelId === "" ? undefined : defaultModelId);
}

async function promptBooleanSelect(
  rl: Interface,
  label: string,
  defaultValue: boolean,
  trueLabel: string = "Yes",
  falseLabel: string = "No"
): Promise<boolean> {
  return await promptSelect(
    rl,
    label,
    [
      { label: trueLabel, value: true },
      { label: falseLabel, value: false }
    ],
    defaultValue
  );
}

async function promptSelect<TValue>(
  rl: Interface,
  title: string,
  options: readonly SelectOption<TValue>[],
  defaultValue: TValue
): Promise<TValue> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    console.log(title);
    options.forEach((option, index) => {
      const suffix = option.hint === undefined ? "" : ` - ${option.hint}`;
      console.log(`${index + 1}. ${option.label}${suffix}`);
    });

    while (true) {
      const answer = await askRequired(rl, "Enter a number");
      const index = Number.parseInt(answer, 10);
      if (Number.isFinite(index) && index >= 1 && index <= options.length) {
        return options[index - 1]!.value;
      }

      console.log("Please enter a valid number.");
    }
  }

  const originalRawMode = stdin.isRaw;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === defaultValue));

  return await new Promise<TValue>((resolve, reject) => {
    let currentIndex = selectedIndex;

    const render = () => {
      process.stdout.write("\u001Bc");
      console.log(title);
      console.log("");
      options.forEach((option, index) => {
        const prefix = index === currentIndex ? "›" : " ";
        const suffix = option.hint === undefined ? "" : `  ${option.hint}`;
        console.log(`${prefix} ${option.label}${suffix}`);
      });
      console.log("");
      console.log("Use arrows and Enter. Press Ctrl+C to cancel.");
    };

    const cleanup = () => {
      stdin.off("keypress", handleKeypress);
      stdin.setRawMode(originalRawMode ?? false);
      stdin.resume();
      rl.resume();
      console.log("");
    };

    const handleKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Setup aborted."));
        return;
      }

      switch (key.name) {
        case "up":
          currentIndex = (currentIndex - 1 + options.length) % options.length;
          render();
          return;
        case "down":
          currentIndex = (currentIndex + 1) % options.length;
          render();
          return;
        case "return":
        case "enter": {
          const value = options[currentIndex]!.value;
          cleanup();
          resolve(value);
          return;
        }
        default:
          return;
      }
    };

    emitKeypressEvents(stdin);
    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", handleKeypress);
    render();
  });
}

function prepareLineInput(rl: Interface): void {
  if (stdin.isTTY && typeof stdin.setRawMode === "function" && stdin.isRaw) {
    stdin.setRawMode(false);
  }

  stdin.resume();
  rl.resume();
}
