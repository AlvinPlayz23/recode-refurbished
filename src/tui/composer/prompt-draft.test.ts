/**
 * Tests for prompt draft helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  isCommandDraft,
  normalizeDraftInput,
  toVisibleDraft
} from "./prompt-draft.ts";

describe("prompt draft helpers", () => {
  it("detects and displays slash-command drafts", () => {
    expect(isCommandDraft("/history")).toBe(true);
    expect(toVisibleDraft("/history")).toBe("history");
    expect(toVisibleDraft("hello")).toBe("hello");
  });

  it("normalizes visible command input back into slash drafts", () => {
    expect(normalizeDraftInput("/", "")).toBe("/");
    expect(normalizeDraftInput("/h", "hi")).toBe("/hi");
    expect(normalizeDraftInput("hello", "hello!")).toBe("hello!");
  });
});
