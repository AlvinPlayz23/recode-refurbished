# Recode

Recode is a local coding-agent CLI built with TypeScript and Bun. It provides an interactive terminal UI, a one-shot CLI mode, persistent conversation history, configurable model providers, an ACP server for external clients, and a desktop app prototype.

The core runtime is an iterative agent loop:

```text
user prompt
  -> build model request
  -> stream assistant output
  -> collect tool calls
  -> execute tools
  -> append tool results
  -> continue until the model stops calling tools
```

## Current Capabilities

- Interactive OpenTUI + SolidJS terminal UI.
- One-shot CLI prompts with streaming stdout.
- Global provider/model configuration in `~/.recode/config.json`.
- Conversation history in `~/.recode/history/`.
- HTML export for terminal conversations.
- Build and plan modes in the TUI and ACP sessions.
- Local ACP server over stdio, WebSocket, and streamable HTTP/SSE.
- Built-in tools for shell, file editing, search, web lookup, task delegation, todo tracking, and user questions.
- Native Bun binary builds.
- Experimental Electrobun desktop app in `desktop-app/`.

## Requirements

- [Bun](https://bun.sh/) for the CLI/runtime.
- TypeScript is installed from project dependencies.
- Provider API credentials for whichever model backend you configure.

## Quick Start

```bash
# Install dependencies
bun install

# Configure providers and models in ~/.recode/config.json
bun run src/index.ts setup

# Start the interactive TUI
bun run start

# Run one prompt and print the final answer
bun run src/index.ts "summarize this repository"
```

If you build or install the binary, the equivalent commands are `recode`, `recode setup`, and `recode "..."`.

## CLI Usage

```text
recode                         Start the interactive TUI
recode setup                   Open the provider/model setup wizard
recode doctor                  Check config, provider, model, history, and model listing
recode acp-server              Start the local ACP HTTP/WebSocket broker
recode acp-server --stdio      Run ACP over stdio for editor subprocess clients
recode <prompt>                Run one-shot mode
recode -h, --help              Show help
recode -v, --version           Show version
```

Common options:

```text
--workspace <dir>              Set the workspace root
--cwd <dir>                    Alias for --workspace
--provider <id>                Use a configured provider ID for this run
--model <id>                   Use a model ID for this run
--approval-mode <mode>         Use approval, auto-edits, or yolo
--no-history                   Do not save one-shot runs to history
```

ACP server options:

```text
--host <host>                  ACP host, default 127.0.0.1
--port <port>                  ACP port, default 0 (random available port)
--token <token>                ACP bearer token, default generated
--stdio                        Use stdin/stdout instead of HTTP/WebSocket
```

## TUI Commands

| Command | Description |
| --- | --- |
| `/help` | Show command help. |
| `/clear` | Clear the current session. |
| `/status` | Show current session status. |
| `/config` | Show runtime, provider, model, theme, and approval settings. |
| `/models` | Open the model selector. |
| `/provider` | Select or enable/disable configured providers. |
| `/theme` | Open the theme selector. |
| `/customize` | Change theme and tool marker. |
| `/approval-mode` | Open the approval-mode selector. |
| `/export` | Export the current conversation to HTML. |
| `/history` | Open saved conversation history. |
| `/new` | Start a new conversation. |
| `/compact` | Compact older conversation context into a continuation summary. |
| `/plan` | Switch to read-only planning mode. |
| `/build` | Switch back to normal implementation mode. |
| `/layout` | Switch between compact and comfortable layout. |
| `/minimal` | Toggle minimal mode. |
| `/exit`, `/quit` | Exit Recode. |

## Configuration

Recode stores persistent config at:

```text
~/.recode/config.json
```

Use `recode setup` to create or update providers. A provider entry can contain:

- `id`, `name`, `kind`, and `baseUrl`
- optional `apiKey`
- optional HTTP `headers`
- optional provider request `options`
- optional `disabled`
- `models` and optional `defaultModelId`
- optional model request defaults: `maxOutputTokens`, `temperature`, and `toolChoice`

The global config can also store the active provider, theme, tool marker, approval mode, approval allowlist, permission rules, layout mode, minimal mode, todo panel setting, and subagent definitions.

Supported provider kinds:

- `openai` — OpenAI Responses API
- `openai-chat` — OpenAI-compatible Chat Completions API
- `openai-oauth` — ChatGPT/Codex backend authenticated with OpenAI OAuth
- `anthropic` — Anthropic Messages API
- `gemini` — Gemini through Google AI Studio's OpenAI-compatible endpoint
- `groq` — Groq OpenAI-compatible endpoint
- `aihubmix` — AIHubMix OpenAI-compatible gateway
- `deepseek` — DeepSeek OpenAI-compatible endpoint
- `z-ai` — Z.AI / GLM general endpoint
- `z-ai-coding` — Z.AI / GLM Coding Plan endpoint
- `huggingface` — Hugging Face Inference Providers router

## Environment Variables

Recode uses Bun's built-in `.env` loading. Environment variables are optional overrides on top of the config file.

```bash
RECODE_CONFIG_PATH=~/.recode/config.json
RECODE_ACTIVE_PROVIDER=my-provider
RECODE_PROVIDER=openai-chat
RECODE_API_KEY=...
RECODE_BASE_URL=http://127.0.0.1:11434/v1
RECODE_MODEL=qwen3:8b
```

Provider request options and timing controls are also supported by the runtime; see the docs in [`docs/`](./docs/README.md) for details.

## Approval And Permissions

Approval modes are guardrails, not a sandbox:

- `approval`: read-scoped tools run directly; edit, shell, and web tools require approval unless allowed by rules/allowlists.
- `auto-edits`: read and edit tools run directly; shell and web tools still require approval unless allowed by rules/allowlists.
- `yolo`: everything runs directly.

Permission rules and allowlists are persisted in the config file. Shell execution is intentionally local and can affect your machine with your user permissions.

## Built-in Tools

| Tool | Purpose |
| --- | --- |
| `Bash` | Run shell commands. |
| `Read` | Read text files. |
| `Write` | Write files. |
| `Edit` | Replace one unique text fragment in a file. |
| `ApplyPatch` | Apply structured multi-file patches. |
| `Glob` | Find files by glob pattern. |
| `Grep` | Search file contents by regex. |
| `WebFetch` | Fetch and convert web page content. |
| `WebSearch` | Search the web through the configured search helper. |
| `Task` | Run a bounded subagent task. |
| `TodoWrite` | Maintain a task plan in the session. |
| `AskUserQuestion` | Ask structured clarification questions. |

File tools are constrained through Recode's safe path handling. `Bash` is different: it runs as a child process and should be treated as unsandboxed local execution.

## ACP Server

`recode acp-server` starts a local JSON-RPC broker for clients such as desktop apps, editors, or automation. It supports:

- stdio: `recode acp-server --stdio`
- WebSocket: `GET /acp` with upgrade
- streamable HTTP/SSE: `POST /acp`, `GET /acp` with `Accept: text/event-stream`, and `DELETE /acp`

HTTP/WebSocket transports require `Authorization: Bearer <token>`. See [`docs/acp-server/README.md`](./docs/acp-server/README.md) for protocol details and examples.

## History And Export

Conversation history is stored globally in:

```text
~/.recode/history/
```

The TUI can restore saved conversations, start new conversations, compact older context, and export the current conversation as a standalone HTML file.

## Desktop App

The desktop app lives in [`desktop-app/`](./desktop-app/README.md). It is an experimental Electrobun host plus Vite/React renderer that talks to Recode through ACP stdio sessions. It is not a separate agent runtime.

## Project Layout

```text
recode/
├── src/
│   ├── acp/          # ACP JSON-RPC server and session bridge
│   ├── agent/        # Agent loop, compaction, subagents
│   ├── ai/           # Provider transport and streaming adapters
│   ├── cli/          # CLI parsing, setup, doctor, workspace resolution
│   ├── config/       # Persistent config load/save/update helpers
│   ├── history/      # Conversation history and HTML export
│   ├── models/       # Runtime model factory and model listing
│   ├── prompt/       # System, plan, init, and AGENTS.md prompt loading
│   ├── providers/    # Provider kind metadata and OAuth helpers
│   ├── runtime/      # Runtime config assembly
│   ├── session/      # Session event/state model
│   ├── tools/        # Tool definitions, policies, and execution
│   ├── transcript/   # Transcript message types
│   ├── tui/          # OpenTUI + SolidJS interface
│   └── index.ts      # CLI entrypoint
├── desktop-app/      # Experimental Electrobun desktop app
├── docs/             # User/developer docs
├── scripts/          # Build scripts
├── package.json
└── README.md
```

## Scripts

```bash
bun run start      # Start the TUI
bun run check      # Type-check the CLI/runtime
bun run test       # Run the project test suite
bun run build      # Build a native binary for the current platform
bun run build:all  # Build native binaries for all supported platforms
```

## Documentation

- [`docs/README.md`](./docs/README.md) — docs index.
- [`docs/acp-server/README.md`](./docs/acp-server/README.md) — ACP server protocol.
- [`docs/provider/reasoning-thinking-support.md`](./docs/provider/reasoning-thinking-support.md) — provider reasoning/thinking support.
- [`desktop-app/README.md`](./desktop-app/README.md) — desktop app architecture and workflow.

## License

[GPLv3](LICENSE)
