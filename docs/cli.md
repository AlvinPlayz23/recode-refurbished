# CLI Guide

Recode's CLI has three main jobs: configure providers, run the interactive TUI, and run one prompt in one-shot mode. It also exposes diagnostics and the ACP server used by external clients.

## Commands

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

During local development, replace `recode` with `bun run src/index.ts`:

```bash
bun run src/index.ts setup
bun run src/index.ts doctor
bun run src/index.ts "summarize this project"
```

## Workspace Selection

Recode uses the current working directory as the workspace root by default. Use either workspace flag to override it:

```bash
recode --workspace /path/to/project
recode --cwd /path/to/project "inspect the tests"
```

The workspace root matters because file tools resolve paths relative to it and history records store workspace metadata.

## One-shot Mode

Any non-command argument is treated as a prompt:

```bash
recode "explain the project layout"
```

One-shot mode streams assistant text to stdout as it arrives. Tool calls still execute through the same runtime and approval policy as the TUI. If the run completes and history is enabled, the transcript is saved to the global history store.

Useful one-shot options:

```bash
recode --provider openai-main --model gpt-4.1 "review src/index.ts"
recode --approval-mode auto-edits "fix the typo in README.md"
recode --no-history "answer without saving this run"
```

## Setup Wizard

Use setup to create or update providers in `~/.recode/config.json`:

```bash
recode setup
```

The setup flow asks for provider kind, base URL, API key, model IDs, and active provider selection. See [`configuration.md`](./configuration.md) and [`providers.md`](./providers.md) for the underlying config fields.

## Doctor

`recode doctor` checks the current runtime configuration and reports issues such as missing providers, missing models, API key presence, history writability, and model-listing status:

```bash
recode doctor
```

Use this after editing config by hand, changing env vars, or installing Recode on a new machine.

## ACP Server

The ACP server lets other apps drive Recode sessions:

```bash
recode acp-server
recode acp-server --host 127.0.0.1 --port 8765 --token dev-token
recode acp-server --stdio
```

See [`acp-server/README.md`](./acp-server/README.md) for protocol details.

## Ctrl+C Behavior

Recode uses a two-step Ctrl+C behavior in user-facing runs. The first Ctrl+C aborts the current operation where possible and arms exit; pressing Ctrl+C again exits.

## Exit Codes

The CLI uses distinct non-zero exit codes where it can classify the failure:

| Code | Meaning |
| --- | --- |
| `64` | Usage error, such as an unknown option or invalid approval mode. |
| `70` | Model/provider response error. |
| `73` | Tool execution or approval-denied error. |
| `78` | Configuration error. |
| `130` | Aborted by Ctrl+C. |
| `1` | Unclassified error. |
