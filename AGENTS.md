# Recode Agent Guide

## What This Repository Is

**Recode** is a local coding-agent CLI built with TypeScript and Bun.

It has two user-facing modes:
- **Interactive TUI mode** powered by OpenTUI + SolidJS
- **One-shot CLI mode** for a single prompt and final answer

The core product is not “just a chat UI.” It is an iterative agent runtime:

```text
user prompt
  -> build model request
  -> stream assistant output
  -> collect tool calls
  -> execute tools
  -> append tool results to transcript
  -> continue until the model stops calling tools
```

Streaming, multi-turn conversation, persistent history, provider/model config, approval modes, and HTML export are all part of the current app surface.

## Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **TUI**: OpenTUI + SolidJS
- **Package manager**: bun
- **Build output**: native Bun-compiled binaries

## First Things To Know

- Reply in **English**
- Search before editing
- Verify before claiming behavior
- Do only the requested scope unless a small support change is clearly necessary
- Prefer small, local, reversible edits over big rewrites
- If the user is talking about **TUI behavior**, assume their live terminal feedback is more authoritative than static code inspection

## Current Product Surface

### CLI

```text
recode               Start the interactive TUI
recode setup         Open the provider/model setup wizard
recode <prompt>      Run one-shot mode
recode -h --help     Show help
recode -v --version  Show version
```

### TUI Commands

- `/help`
- `/clear`
- `/status`
- `/config`
- `/models`
- `/provider`
- `/theme`
- `/customize`
- `/approval-mode`
- `/export`
- `/history`
- `/new`
- `/exit`
- `/quit`

### Persistent State

- Global config: `~/.recode/config.json`
- Global history: `~/.recode/history/`

The config currently stores:
- providers
- active provider
- provider enabled/disabled state
- selected model
- theme
- tool marker
- approval mode
- approval allowlist
- layout mode
- minimal mode

The history layer currently stores:
- conversation metadata
- transcript
- current/last active conversation

### Current Approval Modes

- `approval`
  - reads run directly
  - edits and bash require approval
- `auto-edits`
  - reads and edits run directly
  - bash requires approval
- `yolo`
  - everything runs directly

## Architecture

## Core Runtime Flow

```text
src/index.ts
  -> loadRuntimeConfig()
  -> createLanguageModel()
  -> createTools()
  -> ToolRegistry
  -> either:
     - runTui()
     - runAgentLoop()
```

```text
runAgentLoop()
  -> streamAssistantResponse()
  -> collect text/tool calls
  -> executeToolCall()
  -> append tool results
  -> repeat
```

## Main Modules

| Module | Responsibility | Key Files |
| --- | --- | --- |
| `src/agent/` | main iterative agent loop | `run-agent-loop.ts` |
| `src/ai/` | internal AI transport layer | `stream-assistant-response.ts`, `providers/*` |
| `src/cli/` | setup wizard and non-TUI terminal flows | `setup.ts` |
| `src/config/` | persistent config load/save/update helpers | `recode-config.ts` |
| `src/errors/` | custom error types | `recode-error.ts` |
| `src/history/` | saved conversations and HTML export | `recode-history.ts`, `export-html.ts` |
| `src/messages/` | internal transcript types | `message.ts` |
| `src/models/` | model factory and provider model listing | `create-model-client.ts`, `list-models.ts` |
| `src/prompt/` | system prompt loading | `system-prompt.ts`, `system-prompt.md` |
| `src/runtime/` | runtime config assembly from config + env | `runtime-config.ts` |
| `src/shared/` | small reusable helpers | `is-record.ts` |
| `src/tools/` | tool definitions, registry, execution, safety guardrails | see below |
| `src/tui/` | interactive UI, selectors, prompt, history/model/theme flow | `app.tsx`, `run-tui.tsx`, `theme.ts`, `message-format.ts` |

## Model Layer

Recode no longer depends on the Vercel AI SDK.

The internal model layer currently supports:
- `openai` -> OpenAI Responses API
- `openai-chat` -> OpenAI Chat Completions API
- `anthropic` -> Anthropic Messages API

`RECODE_BASE_URL` allows OpenAI-compatible backends.

## Tool Layer

Current tools:
- `Bash`
- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`

Structure:

```text
ToolDefinition
  -> ToolRegistry
  -> executeToolCall()
  -> createTools()
```

Safety:
- file access is constrained through safe path resolution
- bash is intentionally unsandboxed
- bash approval prompts and app-layer validation are UX guardrails, not a security boundary

## TUI Layout Model

The TUI is not a separate agent implementation. It is a stateful frontend around the same loop.

Current TUI responsibilities:
- render transcript entries
- manage draft input
- handle slash commands
- show selectors/popups
- persist/restore conversations
- stream assistant output incrementally
- request tool approvals interactively

Important files:
- `src/tui/app.tsx`
- `src/tui/run-tui.tsx`
- `src/tui/appearance/theme.ts`
- `src/tui/message-format.ts`

## Current TUI Behaviors To Preserve

- Header stays left-aligned with a small left inset
- Prompt starts below the header when the chat is short
- As content grows, the prompt is pushed downward
- Once the screen fills, the prompt behaves like a docked composer
- Slash mode changes the prompt marker from `◈` to `/`
- `/models`, `/provider`, `/theme`, `/customize`, `/history`, `/approval-mode` use picker-style overlays or popups
- `Ctrl+C` is a two-step exit in TUI and one-shot CLI

Current appearance customization:
- theme is persistent and can be changed from `/theme` or `/customize`
- tool marker is persistent and can be changed from `/customize`
- spinner/loading animation is tied to the active theme and is not separately user-configurable

If a task touches the TUI, be careful not to accidentally regress:
- prompt docking
- transcript order above the prompt
- overlay/modal positioning
- slash-mode input rewriting
- live focus behavior

## Skills And References

If a task involves TUI work, use the local **`opentui`** skill:
- `.agents/skills/opentui/SKILL.md`

Useful local references:
- `.agents/skills/opentui/references/`
- `refs/opencode/`
- `refs/pi-packages/`

When using references:
- use them to understand patterns
- do not copy large chunks blindly
- adapt to Recode’s current architecture and style

## Known Reality About TUI Debugging

The user can see the live TUI. You usually cannot.

Treat the user’s report as the source of truth for:
- rendering glitches
- focus bugs
- paste behavior
- prompt docking issues
- selector collisions

If code looks correct but the user says the live terminal is wrong, believe the runtime report first.

## Project Conventions

## TypeScript

- `strict` mode
- no `any`
- no `@ts-ignore`
- no `@ts-expect-error`
- prefer `interface` over `type` except when `type` is clearly the right fit
- exported APIs should have JSDoc

Header comment format:

```ts
/**
 * {module description}
 */
```

## Naming

- files: `kebab-case`
- functions/variables: `camelCase`
- classes/interfaces: `PascalCase`
- constants: `UPPER_SNAKE_CASE`
- tool names: `PascalCase`

## Comments

- explain **why**
- avoid low-value narration
- keep TODOs contextual

## Dependency Policy

- prefer what is already in the repo
- avoid new dependencies unless clearly justified
- check if Bun or OpenTUI already provides the capability

## Build And Verification

Primary verification commands:

```bash
bun run check
bun run test
```

Build commands:

```bash
bun run build
bun run build:all
```

For docs-only changes, you do not need to run typecheck/tests unless the user asks or the docs depend on verified behavior you changed elsewhere.

### Guidelines:

If behavior is TUI-specific:
- say what you verified statically
- say what still needs live user confirmation

## Hard Constraints

- Do not claim you verified something you did not verify
- Do not expand scope just because a nearby improvement is tempting
- Do not make confident claims about code you did not inspect
- Do not add extra product behavior unless needed for the requested task

## Current Gaps Worth Knowing

These are not automatic todo items. They are just context:
- paste mode is still an active area and may need more refinement
- some popup/overlay layout behavior in docked prompt mode may still need cleanup
- `src/tui/app.tsx` carries a lot of UI state and is the most likely place for regressions

## Definition Of Done

A task is done when:
- the requested scope is covered
- the change matches repo style
- verification is complete for the kind of change made
- risks or remaining live-runtime unknowns are stated clearly
