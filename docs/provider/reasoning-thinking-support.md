# Reasoning And Thinking Provider Support

## Problem

Some providers stream model reasoning separately from normal assistant text.
Recode already had an internal `reasoning-delta` stream part and could store
reasoning metadata, but the OpenAI Chat Completions-compatible path was too
narrow:

- It only read `delta.reasoning_content`.
- It did not read compatible-provider variants such as `delta.reasoning` or
  `delta.reasoning_text`.
- It did not request thinking mode for providers that require an explicit
  provider-specific toggle.

The result was confusing in the TUI and ACP clients: the provider could be
doing reasoning, but Recode had no visible thinking row because no reasoning
delta reached the session event layer. With some Chat Completions-compatible
providers, reasoning could also be disabled at the request layer unless Recode
sent the provider's thinking option.

## Stream Fields

Recode now accepts these streamed reasoning fields from OpenAI-compatible Chat
Completions responses:

- `delta.reasoning_content`
- `delta.reasoning`
- `delta.reasoning_text`

All three are normalized to Recode's internal `reasoning-delta` stream part.
The session layer emits `assistant.reasoning.delta`, and frontends can render it
as thinking UI instead of mixing it into normal assistant text.

For the OpenAI Responses API, Recode also passes through:

- `response.reasoning_text.delta`
- `response.reasoning_summary_text.delta`

## Request Options

Reasoning support is not identical across OpenAI-compatible providers, so
Recode maps the internal `providerOptions.reasoningEffort` setting into the
request shape expected by each provider.

Current Chat Completions-compatible behavior:

- DeepSeek: sends `thinking: { type: "enabled" }` by default for detected
  DeepSeek-compatible models. `reasoningEffort: "none"` sends
  `thinking: { type: "disabled" }`. Other reasoning efforts are sent as
  `reasoning_effort` when supported.
- OpenRouter: maps `reasoningEffort` to `reasoning: { effort: ... }`.
- Qwen and Z.AI: maps `reasoningEffort` to `enable_thinking`; `"none"` disables
  thinking and any other valid effort enables it.
- Native OpenAI Chat Completions: maps valid non-`"none"` reasoning efforts to
  `reasoning_effort`.

`reasoningEffort` is a Recode config option, not a provider body key. It is
filtered out before provider-specific request body options are merged, so it
does not leak into requests as an unsupported raw field.

## DeepSeek Replay Requirement

DeepSeek thinking mode has an additional multi-turn requirement. When an
assistant turn with tool calls includes `reasoning_content`, that reasoning
content must be sent back on later requests with the assistant message. If it is
omitted, DeepSeek can reject the next request with HTTP 400.

Recode handles this by:

- Capturing streamed reasoning deltas.
- Accumulating them during the agent step.
- Storing the accumulated reasoning on the assistant transcript message as
  provider metadata.
- Persisting and restoring that metadata through history.
- Replaying it as `reasoning_content` for detected DeepSeek-compatible chat
  models.

DeepSeek compatibility is detected from provider id, provider name, base URL, or
model id. This covers direct DeepSeek providers and routed OpenAI-compatible
providers using a DeepSeek model id.

## UI Behavior

Reasoning is not appended to normal assistant text. It flows through a separate
session event:

```text
provider stream -> reasoning-delta -> assistant.reasoning.delta -> frontend thinking UI
```

The TUI renders reasoning as a separate dim/italic thinking row. ACP exposes it
as a synthetic `think` tool update so ACP clients can show it separately from
assistant text.

## Verification

The provider tests cover:

- OpenAI Responses reasoning text and reasoning summary deltas.
- Chat Completions `reasoning_content`, `reasoning`, and `reasoning_text`.
- DeepSeek default thinking enablement.
- DeepSeek thinking disablement through `reasoningEffort: "none"`.
- DeepSeek, OpenRouter, Qwen, and native OpenAI Chat request-body mapping.
- Filtering `reasoningEffort` out of raw provider body options.

The change was verified with:

```bash
bun run check
bun run test
```

## Source References

- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat/create
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
