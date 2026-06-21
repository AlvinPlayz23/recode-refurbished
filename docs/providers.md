# Providers

Providers connect Recode's internal model interface to a hosted or local model backend. Provider configuration is stored in `~/.recode/config.json` and can be temporarily overridden with environment variables or CLI flags.

## Supported Provider Kinds

| Kind | Backend |
| --- | --- |
| `openai` | OpenAI Responses API. |
| `openai-chat` | Generic OpenAI-compatible Chat Completions API. |
| `openai-oauth` | ChatGPT/Codex backend through OpenAI OAuth. |
| `anthropic` | Anthropic Messages API. |
| `gemini` | Gemini through Google AI Studio's OpenAI-compatible endpoint. |
| `groq` | Groq OpenAI-compatible endpoint. |
| `aihubmix` | AIHubMix OpenAI-compatible gateway. |
| `deepseek` | DeepSeek OpenAI-compatible endpoint. |
| `z-ai` | Z.AI / GLM general endpoint. |
| `z-ai-coding` | Z.AI / GLM Coding Plan endpoint. |
| `huggingface` | Hugging Face Inference Providers router. |

## Default Base URLs

| Kind | Default base URL |
| --- | --- |
| `openai` | `https://api.openai.com/v1` |
| `openai-chat` | `https://api.openai.com/v1` |
| `openai-oauth` | `https://chatgpt.com/backend-api` |
| `anthropic` | `https://api.anthropic.com/v1` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `groq` | `https://api.groq.com/openai/v1` |
| `aihubmix` | `https://aihubmix.com/v1` |
| `deepseek` | `https://api.deepseek.com` |
| `z-ai` | `https://api.z.ai/api/paas/v4` |
| `z-ai-coding` | `https://api.z.ai/api/coding/paas/v4` |
| `huggingface` | `https://router.huggingface.co/v1` |

## Provider Selection

At runtime, Recode resolves the active provider from:

1. CLI overrides: `--provider` and `--model`.
2. Environment variables: `RECODE_ACTIVE_PROVIDER`, `RECODE_PROVIDER`, `RECODE_MODEL`, and related values.
3. `activeProviderId` in config.
4. The first non-disabled configured provider.

If no model can be resolved, Recode exits with a configuration error and asks you to run `recode setup` or set `RECODE_MODEL`.

## OpenAI-compatible Backends

Use `openai-chat` for OpenAI-compatible Chat Completions services such as local Ollama-compatible endpoints, OpenRouter-like routers, or other gateways:

```json
{
  "id": "local",
  "name": "Local Model",
  "kind": "openai-chat",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "models": [{ "id": "qwen3:8b" }],
  "defaultModelId": "qwen3:8b"
}
```

## Request Options

Provider `options` are JSON values merged into the provider request path. Recode also recognizes transport controls such as:

- `maxRetries`
- `timeoutMs`
- `chunkTimeoutMs`

Transport-only controls are consumed by Recode and not sent as raw model-provider body fields.

## Model Listing

Most OpenAI-compatible providers support listing models through `/models`. Anthropic is configured as not supporting model listing in the preset metadata.

Use `recode doctor` to check whether model listing works for your active provider.

## Reasoning And Thinking

Some providers stream reasoning separately from normal assistant text or require provider-specific thinking options. See [`provider/reasoning-thinking-support.md`](./provider/reasoning-thinking-support.md) for details.

## Timing Diagnostics

Provider timing diagnostics can be enabled with environment variables handled by the AI transport layer:

```bash
RECODE_AI_TIMING=1
RECODE_AI_TIMING=stderr
RECODE_AI_TIMING_PATH=/path/to/ai-timing.jsonl
```

Use timing logs when debugging slow streams, retries, or provider timeouts.
