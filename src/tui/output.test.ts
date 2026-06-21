/**
 * Tests for TUI output formatting.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import {
  formatAssistantReply,
  formatBanner,
  formatCompletion,
  formatError,
  formatToolCall
} from "./output.ts";

describe("tui output", () => {
  it("formats banner with provider and model", () => {
    const banner = formatBanner("openai", "gpt-4");

    expect(banner).toContain("Recode");
    expect(banner).toContain("Provider: openai | Model: gpt-4");
    expect(banner).toContain("/help");
  });

  it("formats assistant reply", () => {
    expect(formatAssistantReply("hello")).toContain("hello");
  });

  it("formats tool call and error output", () => {
    expect(formatToolCall("Read")).toContain("Read");
    expect(formatError("boom")).toContain("boom");
    expect(formatCompletion(3)).toContain("3 iterations");
  });
});
