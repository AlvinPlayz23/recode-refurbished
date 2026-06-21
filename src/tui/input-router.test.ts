/**
 * Tests for TUI paste and input routing helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  createPromptPasteHandler,
  getPastedTextFromKeySequence,
  isLikelyPlainTextPasteChunk,
  type PromptPasteEvent
} from "./input-router.ts";

describe("input router paste helpers", () => {
  it("extracts raw multiline key sequences as paste fallback text", () => {
    expect(getPastedTextFromKeySequence({ sequence: "one\r\ntwo\r\n" })).toBe("one\ntwo\n");
    expect(getPastedTextFromKeySequence({ sequence: "just one line" })).toBeUndefined();
  });

  it("extracts bracketed paste sequences when they reach key handling", () => {
    expect(getPastedTextFromKeySequence({ sequence: "\x1b[200~alpha\nbeta\x1b[201~" })).toBe("alpha\nbeta");
  });

  it("recognizes long raw text chunks as likely plain-text paste pieces", () => {
    expect(isLikelyPlainTextPasteChunk({
      ctrl: false,
      meta: false,
      sequence: "first pasted paragraph"
    })).toBe(true);
    expect(isLikelyPlainTextPasteChunk({
      ctrl: false,
      meta: false,
      sequence: "typed"
    })).toBe(false);
    expect(isLikelyPlainTextPasteChunk({
      ctrl: true,
      meta: false,
      sequence: "first pasted paragraph"
    })).toBe(false);
  });

  it("summarizes multiline paste and stops default textarea handling", () => {
    let prevented = false;
    let stopped = false;
    let draft = "";
    let pendingPaste: { readonly token: string; readonly text: string } | undefined;
    const input = {
      plainText: "",
      focused: false,
      insertText(text: string) {
        this.plainText += text;
      },
      focus() {
        this.focused = true;
      }
    };
    const event: PromptPasteEvent = {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      }
    };

    const handlePaste = createPromptPasteHandler({
      isBusy: () => false,
      isModalOpen: () => false,
      isCommandDraft: () => false,
      getInput: () => input,
      getDraft: () => draft,
      addPendingPaste(paste) {
        pendingPaste = paste;
      },
      syncDraftValue(value) {
        draft = value;
      },
      resetCommandSelection() {}
    });

    expect(handlePaste(event, "one\ntwo")).toBe(true);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(input.plainText).toBe("{Paste 2 lines #1} ");
    expect(draft).toBe("{Paste 2 lines #1} ");
    expect(pendingPaste).toEqual({
      token: "{Paste 2 lines #1}",
      text: "one\ntwo"
    });
    expect(input.focused).toBe(true);
  });
});
