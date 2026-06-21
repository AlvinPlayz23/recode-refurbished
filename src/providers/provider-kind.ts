/**
 * Shared provider kind definitions.
 *
 * @author dev
 */

/**
 * Supported provider kinds.
 *
 * openai: OpenAI Responses API (default).
 * openai-chat: OpenAI Chat Completions API for third-party services that do not support Responses.
 * openai-oauth: ChatGPT/Codex backend through OpenAI OAuth.
 * anthropic: Anthropic Messages API.
 * gemini: Google AI Studio / Gemini through the OpenAI-compatible API.
 * groq: Groq through the OpenAI-compatible API.
 * aihubmix: AIHubMix through the OpenAI-compatible API.
 * deepseek: DeepSeek through the OpenAI-compatible API.
 * z-ai: Z.AI / GLM through the OpenAI-compatible API.
 * z-ai-coding: Z.AI / GLM Coding Plan through its coding endpoint.
 * huggingface: Hugging Face Inference Providers through the OpenAI-compatible router.
 */
export type ProviderKind =
  | "openai"
  | "openai-chat"
  | "openai-oauth"
  | "anthropic"
  | "gemini"
  | "groq"
  | "aihubmix"
  | "deepseek"
  | "z-ai"
  | "z-ai-coding"
  | "huggingface";

/**
 * Static metadata for one native provider kind.
 */
export interface ProviderPreset {
  readonly kind: ProviderKind;
  readonly label: string;
  readonly defaultName: string;
  readonly defaultBaseUrl: string;
  readonly setupHint: string;
  readonly supportsModelListing: boolean;
}

/**
 * Provider presets shown in setup and used by env/config fallback paths.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    kind: "openai",
    label: "OpenAI Responses",
    defaultName: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    setupHint: "OpenAI's native Responses API",
    supportsModelListing: true
  },
  {
    kind: "openai-chat",
    label: "OpenAI Chat",
    defaultName: "OpenAI-Compatible Chat",
    defaultBaseUrl: "https://api.openai.com/v1",
    setupHint: "Generic OpenAI-compatible chat endpoint",
    supportsModelListing: true
  },
  {
    kind: "openai-oauth",
    label: "OpenAI Codex OAuth",
    defaultName: "OpenAI Codex OAuth",
    defaultBaseUrl: "https://chatgpt.com/backend-api",
    setupHint: "ChatGPT/Codex backend authenticated with OpenAI OAuth",
    supportsModelListing: true
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    defaultName: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    setupHint: "Anthropic Messages API",
    supportsModelListing: false
  },
  {
    kind: "gemini",
    label: "Gemini / Google AI Studio",
    defaultName: "Google AI Studio",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    setupHint: "Gemini OpenAI-compatible chat endpoint",
    supportsModelListing: true
  },
  {
    kind: "groq",
    label: "Groq",
    defaultName: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    setupHint: "Groq OpenAI-compatible chat endpoint",
    supportsModelListing: true
  },
  {
    kind: "aihubmix",
    label: "AIHubMix",
    defaultName: "AIHubMix",
    defaultBaseUrl: "https://aihubmix.com/v1",
    setupHint: "AIHubMix OpenAI-compatible gateway",
    supportsModelListing: true
  },
  {
    kind: "deepseek",
    label: "DeepSeek",
    defaultName: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    setupHint: "DeepSeek OpenAI-compatible chat endpoint",
    supportsModelListing: true
  },
  {
    kind: "z-ai",
    label: "Z.AI / GLM",
    defaultName: "Z.AI",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    setupHint: "Z.AI general OpenAI-compatible endpoint",
    supportsModelListing: true
  },
  {
    kind: "z-ai-coding",
    label: "Z.AI / GLM Coding Plan",
    defaultName: "Z.AI Coding Plan",
    defaultBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    setupHint: "Dedicated GLM Coding Plan endpoint",
    supportsModelListing: true
  },
  {
    kind: "huggingface",
    label: "Hugging Face",
    defaultName: "Hugging Face",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    setupHint: "Hugging Face Inference Providers router",
    supportsModelListing: true
  }
];

/**
 * Parse a provider kind or common user-facing alias into the canonical kind.
 */
export function parseProviderKind(value: string | undefined): ProviderKind | undefined {
  const normalized = normalizeProviderKindInput(value);
  if (normalized === undefined) {
    return undefined;
  }

  switch (normalized) {
    case "openai":
    case "openai-chat":
    case "openai-oauth":
    case "anthropic":
    case "gemini":
    case "groq":
    case "aihubmix":
    case "deepseek":
    case "z-ai":
    case "z-ai-coding":
    case "huggingface":
      return normalized;
    case "openai-compatible":
    case "openai-completions":
    case "chat-completions":
      return "openai-chat";
    case "codex":
    case "openai-codex":
    case "chatgpt-oauth":
    case "openai-chatgpt-oauth":
      return "openai-oauth";
    case "google":
    case "google-ai":
    case "google-ai-studio":
    case "google-gemini":
      return "gemini";
    case "ai-hub-mix":
      return "aihubmix";
    case "glm":
    case "glm-z-ai":
    case "zai":
    case "z.ai":
    case "zhipu":
    case "bigmodel":
      return "z-ai";
    case "glm-coding":
    case "glm-coding-plan":
    case "zai-coding":
    case "z.ai-coding":
    case "z-ai-coding-plan":
      return "z-ai-coding";
    case "hf":
    case "hugging-face":
      return "huggingface";
    default:
      return undefined;
  }
}

/**
 * Return the preset for a provider kind.
 */
export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((item) => item.kind === kind);
  if (preset === undefined) {
    throw new Error(`Unsupported provider kind: ${kind}`);
  }

  return preset;
}

/**
 * Return the default display name for a provider kind.
 */
export function getDefaultProviderName(kind: ProviderKind): string {
  return getProviderPreset(kind).defaultName;
}

/**
 * Return the default base URL for a provider kind.
 */
export function getDefaultProviderBaseUrl(kind: ProviderKind): string {
  return getProviderPreset(kind).defaultBaseUrl;
}

/**
 * Whether Recode can try the OpenAI-compatible `/models` endpoint for this provider.
 */
export function providerSupportsModelListing(kind: ProviderKind): boolean {
  return getProviderPreset(kind).supportsModelListing;
}

function normalizeProviderKindInput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replaceAll("_", "-").replaceAll("/", "-").replaceAll(/\s+/g, "-");
  return normalized === "" ? undefined : normalized;
}
