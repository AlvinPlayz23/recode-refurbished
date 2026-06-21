# TUI Refactor History

This file tracks responsibility extractions from [app.tsx](./app.tsx) so future refactors can build on them instead of re-discovering the same seams.

## Current Size

- Current [app.tsx](./app.tsx): `1754` lines
- Starting point for this refactor effort: `4632` lines
- Net reduction so far: `2878` lines

| Pass | What Was Refactored Out of `app.tsx` | New File |
| --- | --- | --- |
| 1 | Conversation/session persistence helpers, draft conversation creation, model-selection persistence, runtime restore helpers | [conversation-session.ts](./session/conversation-session.ts) |
| 1 | Workspace `@file` suggestion parsing, async file indexing, cache invalidation, draft suggestion application | [file-suggestions.ts](./file-suggestions.ts) |
| 2 | Built-in command body generation for `/help`, `/status`, `/config`, plus context-window snapshot helpers | [builtin-command-content.ts](./builtin-command-content.ts) |
| 3 | History picker loading/filtering/restore flow, close-state reset helpers, timestamp formatting | [history-picker.ts](./pickers/history-picker.ts) |
| 4 | Shared overlay-facing TUI types for picker rows, interactive requests, and transient UI state | [tui-app-types.ts](./tui-app-types.ts) |
| 4 | Selector windowing, scroll sync, model-picker line shaping, and popup sizing math | [selector-navigation.ts](./pickers/selector-navigation.ts) |
| 4 | Model picker overlay JSX | [model-picker-overlay.tsx](./overlays/model-picker-overlay.tsx) |
| 4 | History picker overlay JSX | [history-picker-overlay.tsx](./overlays/history-picker-overlay.tsx) |
| 4 | Theme picker overlay JSX | [theme-picker-overlay.tsx](./overlays/theme-picker-overlay.tsx) |
| 4 | Customize overlay JSX | [customize-overlay.tsx](./overlays/customize-overlay.tsx) |
| 4 | Approval mode overlay JSX | [approval-mode-overlay.tsx](./overlays/approval-mode-overlay.tsx) |
| 4 | Layout picker overlay JSX | [layout-picker-overlay.tsx](./overlays/layout-picker-overlay.tsx) |
| 4 | Question overlays, including the context-window prompt UI | [question-overlay.tsx](./overlays/question-overlay.tsx) |
| 4 | Tool-approval overlay JSX | [tool-approval-overlay.tsx](./overlays/tool-approval-overlay.tsx) |
| 4 | Toast overlay JSX | [toast-overlay.tsx](./overlays/toast-overlay.tsx) |
| 5 | Keyboard routing helpers for question prompts, tool approval, pickers, `@file` suggestions, and slash-command suggestions | [keyboard-router.ts](./keyboard-router.ts) |
| 5 | Single-turn agent runner and compact paste expansion helpers used during prompt submission | [prompt-submission-controller.ts](./composer/prompt-submission-controller.ts) |
| 5 | Slash-command textarea caret stabilization after visible-draft sync and prompt remounts | [app.tsx](./app.tsx) |
| 6 | Transcript entry state, mutation helpers, tool-call formatting, transcript rehydration, and collapsed-tool grouping | [transcript-entry-state.ts](./transcript/transcript-entry-state.ts) |
| 6 | Transcript entry JSX rendering for user, assistant, tool, preview, grouped-tool, error, and status rows | [transcript-entry.tsx](./transcript/transcript-entry.tsx) |
| 6 | Tool approval and question prompt workflow helpers, including context-window fallback submission | [interactive-prompts.ts](./interactive-prompts.ts) |
| 6 | Prompt-run transcript persistence and assistant/tool streaming-entry transitions | [submission-session.ts](./session/submission-session.ts) |
| 7 | Built-in slash-command parsing and dispatch for `/help`, `/config`, `/models`, `/compact`, `/plan`, `/build`, `/layout`, `/minimal`, `/export`, and session reset flows | [builtin-command-controller.ts](./builtin-command-controller.ts) |
| 8 | Prompt docking, header, composer, transcript-entry, badge, and wrapped-text measurement helpers | [layout-metrics.ts](./layout-metrics.ts) |
| 8 | Slash-command draft visibility and textarea draft normalization helpers used by composer/layout code | [prompt-draft.ts](./composer/prompt-draft.ts) |
| 9 | Provider picker row shaping and default-model helpers for the `/provider` manager | [provider-picker.ts](./pickers/provider-picker.ts) |
| 9 | Provider manager overlay JSX for selecting and enabling/disabling providers | [provider-picker-overlay.tsx](./overlays/provider-picker-overlay.tsx) |
| 10 | Composer JSX/chrome, subagent composer, subagent breadcrumb, busy row display helpers, and todo dropup height helper | [composer.tsx](./composer/composer.tsx) |
| 11 | Prompt paste placeholder handling, global paste registration, global keyboard routing order, and shared picker/suggestion key dispatch wiring | [input-router.ts](./input-router.ts) |
| 12 | Provider/model picker action helpers, appearance/customize/status/layout helpers, and shared TUI helper output formatting | [provider-picker.ts](./pickers/provider-picker.ts), [model-picker.ts](./pickers/model-picker.ts), [appearance-settings.ts](./appearance/appearance-settings.ts), [tui-helper-output.ts](./tui-helper-output.ts) |
| 13 | Folder organization for appearance, composer, overlays, pickers, session, and transcript modules | [src/tui](./) |
| 13 | Prompt renderable synchronization, cursor styling, command draft application, and OSC 52 clipboard copy | [prompt-renderable.ts](./composer/prompt-renderable.ts) |
| 13 | Context-window prompting, model context persistence, microcompaction, and auto-compaction preparation | [context-window-flow.ts](./session/context-window-flow.ts) |
| 13 | Slash-command command-panel state and session-mode tool-registry selection | [command-panel.ts](./composer/command-panel.ts), [tool-registry-mode.ts](./session/tool-registry-mode.ts) |
| 13 | Live subagent restore and task execution wiring | [tui-subagent-controller.ts](./session/tui-subagent-controller.ts) |
| 13 | Plain-text paste fallback summarization for terminals without bracketed paste events | [plain-text-paste-fallback.ts](./composer/plain-text-paste-fallback.ts) |
| 13 | Shared unknown-error formatting for TUI status/error rows | [error-message.ts](./error-message.ts) |
| 14 | Per-turn prompt session event projection, busy-phase updates, todo updates, and partial transcript snapshots | [prompt-turn-session.ts](./session/prompt-turn-session.ts) |
| 14 | Prompt paste expansion and plan-mode model prompt shaping | [prompt-run-input.ts](./session/prompt-run-input.ts) |
| 14 | Selection-to-clipboard OSC 52 behavior | [selection-copy.ts](./selection-copy.ts) |
| 14 | Transient toast timing controller | [toast-controller.ts](./toast-controller.ts) |
| 15 | Status/footer timers, splash-detail timer, header refresh, file-suggestion loading, cursor syncing, and picker scroll syncing | [lifecycle/](./lifecycle/) |
| 16 | Initial session reset and runtime approval-setting synchronization | [tui-startup.ts](./session/tui-startup.ts), [approval-runtime-state.ts](./session/approval-runtime-state.ts) |
| 16 | Two-step Ctrl+C exit handling and cleanup | [exit-controller.ts](./exit-controller.ts) |
| 17 | Tool-approval and plan-review request resolution | [approval-request-controller.ts](./session/approval-request-controller.ts), [plan-review-controller.ts](./session/plan-review-controller.ts) |

## Stabilization After Pass 5

- Overlay components now render as absolute modal surfaces instead of participating in normal transcript/composer layout flow.
- The history picker now uses compact two-line rows, a short-list non-scroll path, and filtered-list remount keys to reduce scroll-gap regressions.
- Prompt textarea remounts and same-value visible-draft syncs now restore the slash-command caret to the end instead of letting typed letters insert behind the first character.

## Stabilization After Pass 6

- Failed or partial prompt turns continue to use the partial-transcript preservation path added before this pass; persistence now goes through a shared submission/session helper.
- Transcript rendering and transcript state shaping are split so pure state behavior can be tested without importing the OpenTUI JSX runtime.
- Approval/question modal behavior is now expressed through pure workflow helpers instead of being embedded directly in the main app component.

## Stabilization After Pass 7

- Built-in command dispatch is now tested independently from OpenTUI rendering.
- `app.tsx` passes explicit UI callbacks to the controller, so the command layer does not own hidden Solid signal state.
- `/exit` and `/quit` still use the renderer destroy path instead of direct process exit.

## Stabilization After Pass 8

- Prompt docking and composer sizing math is now pure and covered by focused tests.
- Slash-command visible-draft handling is shared between composer input and layout estimates, reducing the chance that `/history`-style drafts are measured differently from what the user sees.
- `app.tsx` still decides when to dock, but no longer owns the height-estimation formulas.

## Notes

- `app.tsx` still owns picker state, draft/input focus, prompt-run orchestration, and overlay wiring.
- The next likely seams are picker keyboard wiring, the remaining prompt-input handlers, and the main JSX/overlay composition.
- When moving logic out of `app.tsx`, prefer modules that are either:
  - pure formatting/data helpers with direct tests, or
  - stateful helpers with a narrow, explicit API and dedicated tests.
