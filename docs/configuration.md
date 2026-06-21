# Configuration Guide

Recode's persistent configuration is user-global by default:

```text
~/.recode/config.json
```

Use `recode setup` for normal provider setup. You can edit the JSON manually when you need advanced fields.

## Top-level Fields

| Field | Meaning |
| --- | --- |
| `version` | Config schema version. Current value is `1`. |
| `providers` | Saved provider definitions. |
| `activeProviderId` | Provider selected by default. |
| `themeName` | TUI theme. |
| `toolMarkerName` | TUI tool marker. |
| `approvalMode` | `approval`, `auto-edits`, or `yolo`. |
| `approvalAllowlist` | Persisted approval scopes: `read`, `edit`, `bash`, `web`. |
| `permissionRules` | Pattern-based allow/deny/ask rules. |
| `layoutMode` | TUI layout mode. |
| `minimalMode` | Whether the TUI header is hidden. |
| `todoPanelEnabled` | Whether the composer todo panel is shown. |
| `agents` | Optional named subagent configuration. |

## Provider Fields

| Field | Meaning |
| --- | --- |
| `id` | Stable provider ID used by CLI flags and selectors. |
| `name` | Display name. |
| `kind` | Provider kind. See [`providers.md`](./providers.md). |
| `baseUrl` | API base URL. |
| `apiKey` | Optional API key. |
| `headers` | Optional extra HTTP headers. |
| `options` | Optional provider request options and Recode transport controls. |
| `models` | Saved model IDs and optional labels/context windows. |
| `defaultModelId` | Default model for this provider. |
| `maxOutputTokens` | Optional request default. |
| `temperature` | Optional request default. |
| `toolChoice` | Optional `auto` or `required`. |
| `disabled` | Hide/disable the provider in selector flows. |

## Example Config

```json
{
  "version": 1,
  "activeProviderId": "local-ollama",
  "approvalMode": "approval",
  "themeName": "default",
  "providers": [
    {
      "id": "local-ollama",
      "name": "Local Ollama",
      "kind": "openai-chat",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "models": [
        {
          "id": "qwen3:8b",
          "contextWindowTokens": 32768
        }
      ],
      "defaultModelId": "qwen3:8b"
    }
  ]
}
```

## Environment Overrides

Environment variables are temporary overrides on top of config:

```bash
RECODE_CONFIG_PATH=~/.recode/config.json
RECODE_ACTIVE_PROVIDER=my-provider
RECODE_PROVIDER=openai-chat
RECODE_API_KEY=...
RECODE_BASE_URL=http://127.0.0.1:11434/v1
RECODE_MODEL=qwen3:8b
RECODE_PROVIDER_HEADERS='{"x-custom":"value"}'
RECODE_PROVIDER_OPTIONS='{"maxRetries":2,"timeoutMs":60000}'
RECODE_MAX_OUTPUT_TOKENS=4096
RECODE_TEMPERATURE=0.2
RECODE_TOOL_CHOICE=auto
```

Selection priority is generally:

1. CLI overrides such as `--provider`, `--model`, and `--approval-mode`.
2. Environment overrides.
3. Persisted config.
4. Provider defaults.

## Model Context Windows

Each configured model can store `contextWindowTokens`. The TUI uses that value for context usage status and compaction thresholds. If no explicit value exists, Recode falls back to known/runtime defaults.

## Subagent Config

The optional `agents` object can define named subagent behavior:

```json
{
  "agents": {
    "explore": {
      "description": "Read-only investigation agent",
      "providerId": "openai-main",
      "model": "gpt-4.1",
      "prompt": "Focus on discovery and return concise evidence.",
      "tools": {
        "Read": true,
        "Grep": true,
        "Glob": true
      }
    }
  }
}
```

Subagents still run inside Recode's local runtime and approval policy.
