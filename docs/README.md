# Recode Documentation

This directory contains Recode's current user and technical documentation. Start with the root [`README.md`](../README.md) for a quick overview, then use the guides below for specific surfaces.

## User Guides

| Guide | Use it for |
| --- | --- |
| [`cli.md`](./cli.md) | Running setup, one-shot prompts, doctor checks, workspace selection, and exit codes. |
| [`tui.md`](./tui.md) | Interactive terminal usage, slash commands, modes, history, export, and customization. |
| [`configuration.md`](./configuration.md) | Config file fields, provider setup, environment overrides, models, and permissions. |
| [`tools-and-permissions.md`](./tools-and-permissions.md) | Built-in tools, approval modes, allowlists, permission rules, and safety expectations. |
| [`history-and-export.md`](./history-and-export.md) | Conversation persistence, restore behavior, compaction, and HTML export. |
| [`desktop-app.md`](./desktop-app.md) | How the desktop app relates to the CLI and where to find desktop-specific docs. |

## Technical Docs

| Document | Use it for |
| --- | --- |
| [`architecture.md`](./architecture.md) | Runtime architecture, module map, and how the surfaces share the same loop. |
| [`agent-runtime.md`](./agent-runtime.md) | Agent loop behavior, streaming, tool execution scheduling, doom-loop detection, and events. |
| [`providers.md`](./providers.md) | Provider kinds, runtime selection, request options, model listing, and transport behavior. |
| [`acp-server/README.md`](./acp-server/README.md) | ACP JSON-RPC transports, methods, session updates, approvals, and client examples. |
| [`provider/reasoning-thinking-support.md`](./provider/reasoning-thinking-support.md) | Provider reasoning/thinking stream support and request mapping. |

## Runtime Surfaces

Recode has four user-facing surfaces:

1. **Interactive TUI** — `recode` or `bun run start`.
2. **One-shot CLI** — `recode <prompt>` or `bun run src/index.ts "..."`.
3. **ACP server** — `recode acp-server` or `recode acp-server --stdio`.
4. **Desktop app** — `desktop-app/`, an Electrobun + React frontend that uses ACP stdio sessions.

All four surfaces share the same provider configuration, model runtime, transcript model, and tool execution layer.

## Common Verification

From the repository root:

```bash
bun run check
bun run test
```

For desktop-specific work, run checks from `desktop-app/` as well:

```bash
bun run check
bun run smoke:spawn
bun run smoke:acp
```

Docs-only edits do not require typechecking unless they describe behavior changed in code at the same time.
