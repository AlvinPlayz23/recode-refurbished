# Recode Desktop

Recode Desktop is the experimental desktop frontend for Recode. It uses an Electrobun native host, a Vite + React renderer, and Recode's ACP stdio server to run real agent sessions against local workspace folders.

It is not a separate agent runtime. The desktop app manages windows, workspaces, threads, and UI state; Recode still provides the model/provider runtime, tools, history, and session execution.

```text
desktop renderer (React)
  <-> Electrobun RPC bridge
  <-> Bun host session manager
  <-> recode acp-server --stdio
  <-> Recode agent runtime
```

## Status

The desktop app is in active early development. Current implemented pieces include:

- Electrobun host in `src/bun/`.
- Vite + React renderer in `web/`.
- Workspace and thread UI with persisted desktop snapshots.
- ACP stdio child-process management through `DesktopSessionManager`.
- Session creation, activation, prompting, cancellation, config-option updates, permission answers, and question answers over ACP.
- Tool/assistant/session updates forwarded into the renderer transcript.
- Browser/Vite mock mode for UI preview when the Electrobun bridge is not available.
- Production renderer build copied into the Electrobun bundle.

Current limitations:

- This is still an experimental app surface.
- The desktop app depends on the local Recode CLI/runtime being available through dev or prod runtime mode.
- Browser preview mode is mock-only; real agent sessions require Electrobun and ACP.

## Requirements

- Bun.
- Desktop app dependencies installed in `desktop-app/`.
- Renderer dependencies installed in `desktop-app/web/`.
- A configured Recode provider in `~/.recode/config.json` or environment overrides.

## Install

From `desktop-app/`:

```bash
bun install
```

From `desktop-app/web/`:

```bash
bun install
```

The repository currently contains both Bun and pnpm lockfiles in some places, but the active scripts are Bun-based.

## Development

Run the full desktop development flow from `desktop-app/`:

```bash
bun run dev
```

This starts the Vite renderer on `http://127.0.0.1:5173`, waits for it to become available, then starts Electrobun with `RECODE_DESKTOP_DEV_URL` pointed at the renderer.

You can also run the renderer alone from `desktop-app/web/`:

```bash
bun run dev
```

Renderer-only mode is useful for visual work, but it uses mock projects/threads/messages because the Electrobun RPC bridge is absent.

## Scripts

From `desktop-app/`:

```bash
bun run dev             # Start Vite + Electrobun together
bun run electrobun:dev  # Start only the Electrobun host
bun run web:build       # Build the Vite renderer
bun run build           # Build renderer, then package with Electrobun
bun run build:canary    # Build with Electrobun canary env
bun run build:stable    # Build with Electrobun stable env
bun run check           # Type-check desktop host code
bun run smoke:spawn     # Smoke-test child process spawning
bun run smoke:acp       # Smoke-test ACP session behavior
```

From `desktop-app/web/`:

```bash
bun run dev       # Vite dev server
bun run build     # Type-check and build renderer
bun run lint      # ESLint renderer code
bun run preview   # Preview built renderer
```

## Runtime Modes

The desktop host can start Recode in two modes:

| Mode | Behavior |
| --- | --- |
| `dev` | Starts Recode from a selected/detected local repo with Bun and `desktop-app/bunfig.acp.toml`. |
| `prod` | Starts `recode acp-server --stdio` from the installed `recode` command. |

Dev mode is the default while Recode Desktop is developed inside this repository. The Settings modal can show or change the Recode repo root used for dev mode.

## Key Files

```text
desktop-app/
├── src/bun/index.ts                    # Electrobun window and RPC host
├── src/bun/desktop-session-manager.ts  # Workspace/thread snapshot and ACP session manager
├── src/bun/acp-json-rpc-client.ts      # JSON-RPC client for ACP stdio
├── src/bun/child-process.ts            # Managed child process helpers
├── scripts/dev.ts                      # Starts renderer + Electrobun for development
├── scripts/build-web.ts                # Builds the renderer from desktop root
├── scripts/smoke-acp-sessions.ts       # ACP smoke test
├── scripts/smoke-child-spawn.ts        # Child process smoke test
├── web/src/App.tsx                     # Main React app and desktop session UI wiring
├── web/src/desktop-rpc.ts              # Typed renderer/host RPC contract
├── web/src/lib/desktop-bridge.ts       # Runtime bridge detection
└── web/src/components/                 # Renderer UI components
```

`desktop-app/ref-src/` is reference material and is not the active desktop app implementation.

## Session Flow

1. The renderer asks the Bun host for a snapshot with `getSnapshot`.
2. The user adds a workspace or creates/selects a thread.
3. `DesktopSessionManager` starts or reuses a `recode acp-server --stdio` child process for that workspace/session.
4. The host sends ACP requests such as `initialize`, `session/new`, `session/resume`, `session/prompt`, and `session/set_config_option`.
5. ACP `session/update` notifications are mapped to desktop messages and thread state.
6. The renderer updates the transcript, thread list, model/mode selectors, permission dialogs, and question dialogs.

## Tool And Transcript Updates

Incoming session updates from the Bun side arrive as `DesktopMessage` objects defined in `web/src/desktop-rpc.ts`. The renderer stores them as `ChatMessage` objects from `web/src/types.ts`.

`toChatMessage` in `web/src/App.tsx` is the adapter that keeps transcript fields such as `toolCallId`, `toolKind`, `toolStatus`, `toolInput`, and `toolContent`. If the host adds a new message field that the transcript must render, add it to this adapter too.

## Settings And Runtime Controls

The desktop settings UI currently covers:

- theme selection,
- runtime mode (`dev` or `prod`),
- Recode repo root selection for dev mode,
- GPU acceleration/animation reduction toggle.

Session controls include:

- workspace selection,
- thread creation/activation/close,
- prompt submission and cancellation,
- model selection from ACP config options,
- build/plan mode selection,
- permission and question responses.

## Build Notes

`bun run build` runs the renderer build first, then packages through Electrobun. The production renderer assets in `web/dist` are bundled into the desktop app.

Windows DPI handling is patched after packaging with:

- `assets/windows-dpi-aware.manifest`
- `scripts/patch-windows-dpi-manifest.ts`
- the `postPackage` hook in `electrobun.config.ts`

This prevents Windows from bitmap-scaling the WebView on high-DPI displays.

## Related Docs

- [`../README.md`](../README.md) — root Recode overview.
- [`../docs/README.md`](../docs/README.md) — docs index.
- [`../docs/acp-server/README.md`](../docs/acp-server/README.md) — ACP protocol used by the desktop host.
