/**
 * Tests for plain-text paste fallback handling.
 */

import { describe, expect, test } from "bun:test";
import { createPlainTextPasteFallback } from "./plain-text-paste-fallback.ts";
import type { PendingPaste } from "./prompt-submission-controller.ts";

describe("plain text paste fallback", () => {
  test("summarizes multiline raw paste into a placeholder", () => {
    const input = createFakeTextarea("hello\nworld\n");
    const pastes: PendingPaste[] = [];
    let draft = "";
    let resetCount = 0;
    const fallback = createPlainTextPasteFallback({
      getInput: () => input,
      getDraft: () => draft,
      isBusy: () => false,
      isModalOpen: () => false,
      isCommandDraft: () => false,
      addPendingPaste(paste) {
        pastes.push(paste);
      },
      createPasteToken(lineCount) {
        return `{Paste ${lineCount} lines #1}`;
      },
      syncDraftValue(value) {
        draft = value;
      },
      resetCommandSelection() {
        resetCount += 1;
      }
    });

    fallback.noteChunk();
    fallback.summarize();

    expect(pastes).toEqual([
      {
        token: "{Paste 2 lines #1}",
        text: "hello\nworld\n"
      }
    ]);
    expect(draft).toBe("{Paste 2 lines #1} ");
    expect(input.plainText).toBe("{Paste 2 lines #1} ");
    expect(input.focused).toBe(true);
    expect(resetCount).toBe(1);
    fallback.dispose();
  });

  test("ignores single-line paste text", () => {
    const input = createFakeTextarea("hello");
    const pastes: PendingPaste[] = [];
    const fallback = createPlainTextPasteFallback({
      getInput: () => input,
      getDraft: () => "",
      isBusy: () => false,
      isModalOpen: () => false,
      isCommandDraft: () => false,
      addPendingPaste(paste) {
        pastes.push(paste);
      },
      createPasteToken(lineCount) {
        return `{Paste ${lineCount} lines #1}`;
      },
      syncDraftValue() {},
      resetCommandSelection() {}
    });

    fallback.noteChunk();
    fallback.summarize();

    expect(pastes).toEqual([]);
    fallback.dispose();
  });
});

interface FakeTextarea {
  plainText: string;
  focused: boolean;
  editBuffer: {
    setText(value: string): void;
  };
  cursorOffset: number;
  focus(): void;
}

function createFakeTextarea(initialText: string): FakeTextarea {
  const fake: FakeTextarea = {
    plainText: initialText,
    focused: false,
    cursorOffset: 0,
    editBuffer: {
      setText(value: string) {
        fake.plainText = value;
      }
    },
    focus() {
      fake.focused = true;
    }
  };

  return fake;
}
