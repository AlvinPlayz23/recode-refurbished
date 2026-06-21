# Plan: Migrate recode TUI from @opentui/solid → pi-tui

## Context

Recode's TUI is built on `@opentui/core` + `@opentui/solid` (SolidJS reactive JSX, alternate-screen, fixed layout with a scrollbox).  
The goal is to replace the entire TUI layer with **pi-tui** — a simpler imperative framework that uses a **print model**: messages are appended top-to-bottom as plain terminal output, and the user scrolls up natively. Only the interactive bottom (Editor + status) is managed by the TUI at any given moment.

This is a full architectural rewrite of `src/tui/` (92 files) and `src/cli/setup-tui.tsx`. Business logic outside of `src/tui/` is unchanged.

---

## Approach

### Rendering model shift

| Old (OpenTUI)                         | New (pi-tui)                              |
|---------------------------------------|-------------------------------------------|
| Alternate-screen, fixed layout        | Normal terminal mode, print-and-append    |
| SolidJS reactive JSX components       | Plain TypeScript classes with `render(width): string[]` |
| `<scrollbox>` for message history     | Messages are `tui.addChild(new Text/Markdown(...))` — stack up naturally |
| `createSignal` / `createMemo`         | Plain class fields + `tui.requestRender()` |
| 30 FPS render loop                    | Differential rendering on demand          |

### Print model layout

```
User: hello
─────────────────────────────────────────
Assistant: Hi! How can I help?           ← Markdown or Text child
─────────────────────────────────────────
[⠸ Thinking...]                          ← Loader child (added when busy, removed when done)
▸ _                                      ← Editor child (always last)
```

---

## Step-by-step Implementation

### Step 1 — Copy pi-tui source files

Copy all files from `pi-tui/components/` into `src/tui/pi-tui/`:
- `box.ts`, `cancellable-loader.ts`, `editor.ts`, `image.ts`, `input.ts`
- `loader.ts`, `markdown.ts`, `select-list.ts`, `settings-list.ts`
- `spacer.ts`, `text.ts`, `truncated-text.ts`

Create `src/tui/pi-tui/index.ts` re-exporting all of them plus the core `TUI`, `ProcessTerminal`, `Container`, `matchesKey`, `Key`, `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `CURSOR_MARKER` — whichever of these live in the root of `@earendil-works/pi-tui` (check the actual component files to find where TUI/ProcessTerminal are defined).

### Step 2 — Update package.json and tsconfig

**`package.json`** — remove:
```
@opentui/core, @opentui/solid, solid-js
```
Add `chalk` if not already present (pi-tui uses it for ANSI styling).

**`tsconfig.json`** — remove the SolidJS JSX preset:
```json
// Remove these if present:
"jsx": "preserve",
"jsxImportSource": "solid-js"
```

### Step 3 — Rewrite `src/tui/run-tui.ts` (was `.tsx`)

Replace the `render()` from `@opentui/solid` with:

```typescript
import { ProcessTerminal, TUI } from "./pi-tui/index.ts";
import { TuiApp } from "./app.ts";

export async function runTui(options: TuiRunOptions): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const app = new TuiApp(tui, options);
  app.start();
  await app.waitForExit();
}
```

### Step 4 — Rewrite `src/tui/app.ts` (was `.tsx`, ~2000 lines)

`TuiApp` becomes a plain TypeScript class (no JSX, no signals). Key responsibilities:

- **State as plain fields**: `busy`, `draft`, `entries`, `themeName`, etc. — mutable fields, not signals
- **Rendering**: Call `tui.requestRender()` whenever state changes
- **Message display**: Each new transcript entry → `tui.addChild(new Markdown(...))` or `tui.addChild(new Text(...))`
- **Input**: `editor = new Editor(tui, theme)`, always the last child via `tui.addChild(editor)` at startup
- **Busy indicator**: `loader = new CancellableLoader(tui, ...)`, call `tui.addChild(loader)` when busy starts, `tui.removeChild(loader)` when done
- **Keyboard**: `tui.addInputListener((data) => { ... matchesKey(data, ...) ... })`
- **Exit**: `tui.stop()` then `process.exit(0)` on Ctrl+C

All of the business logic from the original `app.tsx` is preserved — only the reactive wiring and JSX rendering are replaced.

### Step 5 — Rewrite `src/tui/appearance/` components

- **`logo.ts`** (was `.tsx`): Return ANSI-styled string lines for the header, rendered once on startup via `tui.addChild(new Text(logoLines.join('\n')))`.
- **`spinner.tsx` → removed**: Use pi-tui's `Loader` / `CancellableLoader` directly.
- **`markdown-style.ts`**: Keep as-is — it already returns a `MarkdownTheme` interface compatible with pi-tui's `Markdown` component.
- **`theme.ts`**, **`appearance-settings.ts`**: Keep as-is (pure logic, no JSX).

### Step 6 — Rewrite `src/tui/composer/composer.ts` (was `.tsx`)

Wrap pi-tui's `Editor`:

```typescript
export class Composer {
  private editor: Editor;

  constructor(tui: TUI, theme: ThemeColors) {
    this.editor = new Editor(tui, buildEditorTheme(theme));
    this.editor.onSubmit = (text) => this.onSubmit?.(text);
  }

  onSubmit?: (text: string) => void;

  getComponent() { return this.editor; }
}
```

Other composer files (`prompt-draft.ts`, `prompt-submission-controller.ts`, `prompt-run-input.ts`, etc.) contain pure logic — keep them, just remove any `@opentui` imports.

### Step 7 — Rewrite `src/tui/overlays/` (11 files)

Each overlay becomes a pi-tui `SelectList` (or `SettingsList` for customize) displayed via `tui.showOverlay(component, opts)`.

Pattern:
```typescript
// model-picker-overlay.ts
export function showModelPickerOverlay(tui: TUI, items: ..., onSelect: ...) {
  const list = new SelectList(items, 10, theme);
  const handle = tui.showOverlay(list, { anchor: 'center', maxHeight: 20 });
  list.onSelect = (item) => { handle.hide(); onSelect(item); };
  list.onCancel = () => handle.hide();
  tui.setFocus(list);
}
```

Apply this pattern to all 11 overlay files.

### Step 8 — Rewrite `src/tui/transcript/transcript-entry.ts` (was `.tsx`)

Replace JSX renderers with functions that return pi-tui component instances:

```typescript
export function createTranscriptComponent(entry: UiEntry, theme: ThemeColors): Component {
  switch (entry.kind) {
    case "assistant":
      return new Markdown(entry.text, 1, 0, buildMarkdownTheme(theme));
    case "user":
      return new Text(`▸ ${entry.text}`, 1, 0);
    case "error":
      return new Text(chalk.red(entry.text), 1, 0);
    // etc.
  }
}
```

### Step 9 — Rewrite `src/tui/pickers/` (4 files)

Picker logic files (`model-picker.ts`, `provider-picker.ts`, `history-picker.ts`, `selector-navigation.ts`) are mostly pure logic. Keep them, remove any @opentui type imports (`ScrollBoxRenderable`, `InputRenderable`, etc.).

### Step 10 — Rewrite `src/cli/setup-tui.tsx` → `setup-tui.ts`

The multi-step setup wizard also uses `@opentui/solid`. Rewrite as a sequence of pi-tui `SelectList` overlays / `Input` prompts, stepping through each wizard stage imperatively.

### Step 11 — Remove remaining .tsx files and @opentui imports

- `src/tui/lifecycle/` — files like `picker-sync-effects.ts` use `ScrollBoxRenderable`; remove those refs since scrollboxes are gone.
- `src/tui/overlays/*.tsx` → converted to `.ts` in step 7.
- Delete `src/tui/appearance/spinner.tsx` (replaced by pi-tui Loader).
- Global search for `from "@opentui` and `from "solid-js"` to catch any remaining imports.

---

## Critical Files to Modify

| File | Action |
|------|--------|
| `src/tui/run-tui.tsx` | Full rewrite → `run-tui.ts` |
| `src/tui/app.tsx` | Full rewrite → `app.ts` (largest file, ~2000 lines) |
| `src/tui/composer/composer.tsx` | Rewrite → wraps pi-tui Editor |
| `src/tui/appearance/logo.tsx` | Rewrite → returns ANSI string |
| `src/tui/appearance/spinner.tsx` | Delete — use pi-tui Loader |
| `src/tui/transcript/transcript-entry.tsx` | Rewrite → returns Components |
| `src/tui/overlays/*.tsx` (11 files) | Rewrite each → SelectList + showOverlay |
| `src/cli/setup-tui.tsx` | Rewrite → imperative wizard |
| `package.json` | Remove opentui/solid-js, add chalk |
| `tsconfig.json` | Remove JSX preset |
| `src/tui/pi-tui/*.ts` | New — copied from pi-tui/components/ |

Pure-logic files to keep (just remove stale opentui type refs):
- `src/tui/appearance/theme.ts`, `appearance-settings.ts`, `markdown-style.ts`
- `src/tui/composer/prompt-draft.ts`, `prompt-submission-controller.ts`, `prompt-run-input.ts`, `command-panel.ts`, `todo-summary.ts`
- `src/tui/session/*.ts` (all)
- `src/tui/pickers/*.ts` (remove ScrollBoxRenderable refs)
- `src/tui/lifecycle/*.ts` (remove picker-sync-effects or strip opentui refs)
- `src/tui/keyboard-router.ts`, `input-router.ts`, `interactive-prompts.ts`, etc.

---

## Utilities to Reuse

- **`src/tui/appearance/markdown-style.ts`** — already returns pi-tui-compatible `MarkdownTheme`
- **`src/tui/session/`** — all session management (approval, plan review, etc.) is pure logic, keep intact
- **`src/tui/message-format.ts`**, **`builtin-command-controller.ts`**, **`builtin-command-content.ts`** — keep as-is
- pi-tui utilities: `visibleWidth()`, `truncateToWidth()`, `wrapTextWithAnsi()`, `matchesKey()`, `Key`

---

## Verification

1. `bun run src/index.ts` — TUI starts, prints logo, Editor appears at bottom
2. Type a prompt and press Enter — user message prints, Loader appears, agent runs, response prints as Markdown
3. Press Ctrl+C — exits cleanly
4. Type `/model` — SelectList overlay appears, can select a model, overlay dismisses
5. Type `/history` — history picker overlay works
6. Type `/theme` — theme picker overlay works
7. `recode setup` — setup wizard steps through correctly
8. `bun run check` — no TypeScript errors
