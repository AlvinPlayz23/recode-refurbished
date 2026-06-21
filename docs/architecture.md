# Architecture

Recode is a local coding-agent runtime with multiple frontends over one core loop.

```text
CLI / TUI / ACP / Desktop
          |
          v
runtime config + model client + tool registry
          |
          v
runAgentLoop()
          |
          v
provider stream <-> transcript <-> tool execution
```

## Runtime Surfaces

| Surface | Entrypoint | Notes |
| --- | --- | --- |
| TUI | `recode`, `bun run start` | OpenTUI + SolidJS interactive terminal UI. |
| One-shot CLI | `recode <prompt>` | Streams text to stdout and optionally saves history. |
| ACP server | `recode acp-server` | JSON-RPC broker for editors, automation, and desktop clients. |
| Desktop app | `desktop-app/` | Electrobun host + React renderer that uses ACP stdio. |

## Main Source Modules

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | CLI entrypoint and surface selection. |
| `src/agent/` | Main loop, session processing, compaction, subagents. |
| `src/ai/` | Provider transport, HTTP/SSE helpers, stream normalization. |
| `src/ai/providers/` | Provider-specific request/stream adapters. |
| `src/acp/` | ACP server, JSON-RPC types, session manager, event mapper. |
| `src/cli/` | Argument parsing, setup wizard, doctor, workspace resolution. |
| `src/config/` | Persistent config parsing, saving, patching. |
| `src/history/` | Conversation storage, schema, HTML export. |
| `src/models/` | Model client creation and model listing. |
| `src/prompt/` | System prompt, plan prompt, init prompt, AGENTS.md loading. |
| `src/providers/` | Provider kind metadata and OpenAI OAuth helper. |
| `src/runtime/` | Runtime config assembly from config and env. |
| `src/session/` | Session event and state model. |
| `src/tools/` | Tool definitions, registry, approval policy, execution. |
| `src/transcript/` | Conversation message types. |
| `src/tui/` | OpenTUI UI, overlays, composer, session controllers. |

## Shared Runtime Assembly

The CLI entrypoint builds shared runtime dependencies:

1. Resolve workspace and parse CLI args.
2. Load runtime config from config/env/CLI overrides.
3. Create the language model client.
4. Create the built-in tools and `ToolRegistry`.
5. Select the surface: TUI, one-shot loop, ACP server, setup, or doctor.

Because surfaces share this assembly, provider behavior and tool behavior should stay consistent across CLI, TUI, ACP, and desktop.

## Frontend Responsibilities

Frontends should not reimplement the agent loop. They are responsible for:

- presenting prompts and streamed assistant output,
- rendering tool progress/results,
- collecting approvals and question answers,
- mapping session events into UI state,
- saving/restoring surface-specific UI state.

The agent loop remains in `src/agent/`.
