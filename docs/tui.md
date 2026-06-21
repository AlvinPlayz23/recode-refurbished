# TUI Guide

The TUI is Recode's interactive terminal interface. It is built with OpenTUI + SolidJS and wraps the same agent loop used by one-shot mode and ACP sessions.

Start it with:

```bash
recode
# or during development
bun run start
```

## Basic Flow

1. Type a prompt in the composer.
2. Recode streams assistant output into the transcript.
3. If the model requests tools, tool rows appear in the transcript.
4. If approval is required, choose allow/deny in the approval popup.
5. The loop continues until the model stops calling tools.

## Slash Commands

| Command | Description |
| --- | --- |
| `/help` | Show command help. |
| `/clear` | Clear the current visible session. |
| `/status` | Show provider/model, token/context estimates, tool call counts, and latest step stats. |
| `/config` | Show config path, theme, provider, model, approval settings, and saved providers. |
| `/models` | Open the model selector. |
| `/provider` | Select or enable/disable configured providers. |
| `/theme` | Open the theme selector. |
| `/customize` | Change theme and tool marker. |
| `/approval-mode` | Open the approval-mode selector. |
| `/export` | Export the current conversation to HTML. |
| `/history` | Open saved conversation history. |
| `/new` | Start a new conversation. |
| `/compact` | Compact older context into a continuation summary. |
| `/plan` | Switch to planning mode. |
| `/build` | Switch back to implementation mode. |
| `/layout` | Switch between compact and comfortable layout. |
| `/minimal` | Toggle minimal header mode. |
| `/exit`, `/quit` | Exit Recode. |

## Modes

### Build Mode

Build mode is the normal implementation mode. It uses the standard system prompt and the full configured tool set.

### Plan Mode

Plan mode is for investigation and planning. It uses the plan-mode system prompt and filters tools to planning-safe/read-oriented behavior.

Switch modes with `/plan`, `/build`, or the mode controls exposed by ACP/desktop clients.

## Provider And Model Selection

Use `/provider` to choose among configured providers or enable/disable them. Use `/models` to switch the active model for the current provider.

Provider and model choices are persisted through the config helpers so unrelated settings are preserved.

## Appearance

Use `/theme` for theme selection and `/customize` for quick theme/tool-marker changes. Appearance settings are persisted in `~/.recode/config.json`.

Layout-related commands:

- `/layout`: switches compact/comfortable layout.
- `/minimal`: hides or restores the header.

## History And Export

The TUI persists conversations to `~/.recode/history/`. Use `/history` to open saved sessions and `/new` to start fresh.

Use `/export` to write a standalone HTML transcript for the current conversation. See [`history-and-export.md`](./history-and-export.md).

## Context Compaction

Recode estimates context usage and can compact older conversation content into summaries. `/compact` manually creates a continuation summary when you want to shrink older context before continuing.

The `/status` command shows context-window source, reserved compaction buffer, latest estimate, and summary count.

## Paste Behavior

The composer can compact multi-line pasted content into visible placeholders while preserving the full pasted text for the model request. This keeps the terminal UI readable during large pastes.

## TUI Implementation Notes

Important files:

- `src/tui/app.tsx` — main app composition and state wiring.
- `src/tui/run-tui.tsx` — OpenTUI startup.
- `src/tui/builtin-command-content.ts` — `/help`, `/status`, and `/config` content.
- `src/tui/overlays/` — pickers and popups.
- `src/tui/session/` — conversation and prompt-run orchestration.
- `src/tui/composer/` — composer state, submission, todo dropup, paste handling.
