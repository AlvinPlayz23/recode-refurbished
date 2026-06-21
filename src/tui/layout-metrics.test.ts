/**
 * Tests for TUI layout measurement helpers.
 */

import { describe, expect, it } from "bun:test";
import { createEntry } from "./transcript/transcript-entry-state.ts";
import {
  estimateBadgeLineHeight,
  estimateComposerHeight,
  estimateConversationFlowHeight,
  estimateEntryHeight,
  estimateHeaderHeight,
  estimateWrappedTextHeight
} from "./layout-metrics.ts";

describe("layout metrics", () => {
  it("estimates header height for minimal, splash, and compact header states", () => {
    expect(estimateHeaderHeight(true, true, true)).toBe(0);
    expect(estimateHeaderHeight(false, true, true)).toBe(18);
    expect(estimateHeaderHeight(false, true, false)).toBe(10);
    expect(estimateHeaderHeight(false, false, false)).toBe(5);
  });

  it("estimates wrapped text height with empty lines and narrow widths", () => {
    expect(estimateWrappedTextHeight("", 80)).toBe(1);
    expect(estimateWrappedTextHeight("abcd", 2)).toBe(2);
    expect(estimateWrappedTextHeight("a\n\nbc", 2)).toBe(3);
    expect(estimateWrappedTextHeight("abc", 0)).toBe(3);
  });

  it("estimates transcript entry heights by entry kind", () => {
    expect(estimateEntryHeight(createEntry("user", "You", "hello"), 80)).toBe(3);
    expect(estimateEntryHeight(createEntry("assistant", "Recode", "hello"), 80)).toBe(2);
    expect(estimateEntryHeight(createEntry("reasoning", "thinking", "hello"), 80)).toBe(2);
    expect(estimateEntryHeight({ ...createEntry("reasoning", "thinking", "hello"), reasoningStatus: "completed" }, 80)).toBe(1);
    expect(estimateEntryHeight(createEntry("tool", "tool", "Read"), 80)).toBe(2);
    expect(estimateEntryHeight(createEntry("error", "error", "boom"), 80)).toBe(3);
  });

  it("estimates restored edit previews by visible changed lines", () => {
    const entry = {
      ...createEntry("tool-preview", "tool", "Edit · src/app.ts"),
      metadata: {
        kind: "edit-preview" as const,
        path: "src/app.ts",
        oldText: Array.from({ length: 15 }, (_, index) => `old-${index}`).join("\n"),
        newText: Array.from({ length: 15 }, (_, index) => `new-${index}`).join("\n")
      }
    };

    expect(estimateEntryHeight(entry, 80)).toBeGreaterThan(25);
  });

  it("estimates composer panel height including command and file suggestions", () => {
    expect(estimateComposerHeight(80, undefined, undefined, "hello")).toBe(5);
    expect(estimateComposerHeight(80, {
      commands: [{}, {}],
      hasMore: true
    }, {
      items: [{}],
      hasMore: false
    }, "/help")).toBe(11);
  });

  it("uses a two-line badge on narrow terminals", () => {
    expect(estimateBadgeLineHeight(51)).toBe(2);
    expect(estimateBadgeLineHeight(52)).toBe(1);
  });

  it("combines transcript and composer estimates for docking decisions", () => {
    const height = estimateConversationFlowHeight([
      createEntry("user", "You", "hello"),
      createEntry("assistant", "Recode", "world")
    ], 80, undefined, undefined, "next");

    expect(height).toBe(10);
  });
});
