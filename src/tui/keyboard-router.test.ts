/**
 * Tests for TUI keyboard routing helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  handleCommandPanelKey,
  handleFileSuggestionPanelKey,
  handlePlanReviewKey,
  handleQuestionRequestKey,
  handleSessionModeToggleKey,
  handleLinearPickerKey,
  handleProviderPickerKey,
  type TuiKeyEvent
} from "./keyboard-router.ts";

describe("keyboard router helpers", () => {
  it("moves a linear picker and consumes handled navigation keys", () => {
    const key = createKey("down");
    let moved: -1 | 1 | undefined;

    const handled = handleLinearPickerKey({
      key,
      open: true,
      totalCount: 3,
      close() {
        throw new Error("should not close");
      },
      move(direction) {
        moved = direction;
      },
      submit() {
        throw new Error("should not submit");
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(moved).toBe(1);
  });

  it("applies the selected file suggestion back into the draft", () => {
    const key = createKey("tab");
    let draft = "@sr";
    let rendered = "";
    let selectionIndex = 3;
    let focused = false;

    const handled = handleFileSuggestionPanelKey({
      key,
      panel: {
        items: [{
          displayPath: "src/app.tsx",
          directory: false
        }],
        hasMore: false,
        selectedIndex: 0,
        selectedItem: {
          displayPath: "src/app.tsx",
          directory: false
        }
      },
      currentDraft: draft,
      setDraft(value) {
        draft = value;
      },
      setSelectionIndex(value) {
        selectionIndex = value;
      },
      setRenderableDraft(value) {
        rendered = value;
      },
      focusPrompt() {
        focused = true;
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(draft).toBe("@src/app.tsx ");
    expect(rendered).toBe("@src/app.tsx ");
    expect(selectionIndex).toBe(0);
    expect(focused).toBe(true);
  });

  it("toggles a provider picker row with space", () => {
    const key = createKey("space");
    let toggled = false;

    const handled = handleProviderPickerKey({
      key,
      open: true,
      totalCount: 2,
      close() {
        throw new Error("should not close");
      },
      move() {
        throw new Error("should not move");
      },
      submit() {
        throw new Error("should not submit");
      },
      toggle() {
        toggled = true;
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(toggled).toBe(true);
  });

  it("submits the active slash command on enter", () => {
    const key = createKey("enter");
    let submitted = "";

    const handled = handleCommandPanelKey({
      key,
      panel: {
        commands: [{ command: "/history", description: "Open history" }],
        visibleCommands: [{ command: "/history", description: "Open history" }],
        hasMore: false,
        visibleStartIndex: 0,
        selectedIndex: 0,
        visibleSelectedIndex: 0,
        selectedCommand: { command: "/history", description: "Open history" },
        totalCount: 1
      },
      clearDraft() {
        throw new Error("should not clear");
      },
      setSelectionIndex() {
        throw new Error("should not move");
      },
      applyCommand() {
        throw new Error("should not apply");
      },
      submitCommand(command) {
        submitted = command;
      },
      focusPrompt() {
        return;
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(key.stopped).toBe(true);
    expect(submitted).toBe("/history");
  });

  it("consumes enter while submitting an active question prompt", () => {
    const key = createKey("enter");
    let submitted = false;

    const handled = handleQuestionRequestKey({
      key,
      request: {
        questions: [{
          id: "choice",
          header: "Choice",
          question: "Pick one",
          multiSelect: false,
          allowCustomText: false,
          options: [{ label: "Yes", description: "Confirm" }]
        }],
        currentQuestionIndex: 0,
        selectedOptionIndex: 0,
        answers: {
          choice: {
            questionId: "choice",
            selectedOptionLabels: ["Yes"],
            customText: ""
          }
        },
        resolve() {
          throw new Error("should not resolve directly");
        }
      },
      contextWindowRequest: false,
      dismiss() {
        throw new Error("should not dismiss");
      },
      submit() {
        submitted = true;
      },
      moveQuestion() {
        throw new Error("should not move question");
      },
      moveOption() {
        throw new Error("should not move option");
      },
      toggleOption() {
        throw new Error("should not toggle");
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(key.stopped).toBe(true);
    expect(submitted).toBe(true);
  });

  it("submits the selected plan review decision", () => {
    const key = createKey("enter");
    let decision: string | undefined;

    const handled = handlePlanReviewKey({
      key,
      request: {
        plan: "Do the thing",
        selectedIndex: 1
      },
      optionCount: 2,
      resolve(value) {
        decision = value;
      },
      moveSelected() {
        throw new Error("should not move");
      },
      decisionAt(index) {
        return index === 0 ? "implement" : "revise";
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(key.stopped).toBe(true);
    expect(decision).toBe("revise");
  });

  it("toggles session mode with Shift+Tab when enabled", () => {
    const key = createKey("tab", { shift: true });
    let toggled = false;

    const handled = handleSessionModeToggleKey({
      key,
      enabled: true,
      toggle() {
        toggled = true;
      }
    });

    expect(handled).toBe(true);
    expect(key.prevented).toBe(true);
    expect(key.stopped).toBe(true);
    expect(toggled).toBe(true);
  });

  it("ignores plain tab for session mode toggling", () => {
    const key = createKey("tab");
    let toggled = false;

    const handled = handleSessionModeToggleKey({
      key,
      enabled: true,
      toggle() {
        toggled = true;
      }
    });

    expect(handled).toBe(false);
    expect(toggled).toBe(false);
  });
});

function createKey(
  name: string,
  overrides: Partial<Pick<TuiKeyEvent, "ctrl" | "shift">> = {}
): TuiKeyEvent & { prevented: boolean; stopped: boolean } {
  return {
    name,
    ctrl: overrides.ctrl ?? false,
    shift: overrides.shift ?? false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    }
  };
}
