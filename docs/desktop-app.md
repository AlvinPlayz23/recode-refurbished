# Desktop App Documentation

The desktop app lives outside `docs/` in [`../desktop-app/`](../desktop-app/README.md), but it is part of the Recode product surface.

## What It Is

Recode Desktop is an experimental Electrobun desktop host with a Vite + React renderer. It manages workspaces, threads, settings, permission dialogs, and transcript rendering while using Recode's ACP stdio server for actual agent sessions.

```text
React renderer
  <-> Electrobun RPC
  <-> Bun desktop session manager
  <-> recode acp-server --stdio
  <-> shared Recode runtime
```

## Where To Read More

- [`../desktop-app/README.md`](../desktop-app/README.md) — primary desktop app guide.
- [`acp-server/README.md`](./acp-server/README.md) — ACP protocol the desktop host uses.
- [`agent-runtime.md`](./agent-runtime.md) — shared runtime that desktop sessions call into.

## Development Commands

From `desktop-app/`:

```bash
bun run dev
bun run check
bun run smoke:spawn
bun run smoke:acp
bun run build
```

From `desktop-app/web/`:

```bash
bun run dev
bun run build
bun run lint
bun run preview
```

## Runtime Modes

| Mode | Behavior |
| --- | --- |
| `dev` | Starts Recode from a selected/detected local repo with Bun and `desktop-app/bunfig.acp.toml`. |
| `prod` | Starts `recode acp-server --stdio` from the installed `recode` command. |

Dev mode is currently the default during local development.
