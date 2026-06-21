/**
 * Tests for prompt-run input shaping.
 */

import { describe, expect, test } from "bun:test";
import { buildPromptRunInput } from "./prompt-run-input.ts";

describe("prompt run input", () => {
  test("expands paste placeholders in build mode", () => {
    const input = buildPromptRunInput({
      prompt: "review {Paste 2 lines #1}",
      pendingPastes: [{ token: "{Paste 2 lines #1}", text: "a\nb\n" }],
      sessionMode: "build",
      remindAboutPlanTags: false,
      remindAboutPlanRevision: false
    });

    expect(input.expandedPrompt).toBe("review a\nb\n");
    expect(input.modelPrompt).toBe(input.expandedPrompt);
  });

  test("wraps expanded prompts for plan mode", () => {
    const input = buildPromptRunInput({
      prompt: "make a plan",
      pendingPastes: [],
      sessionMode: "plan",
      remindAboutPlanTags: true,
      remindAboutPlanRevision: true
    });

    expect(input.expandedPrompt).toBe("make a plan");
    expect(input.modelPrompt).toContain("make a plan");
    expect(input.modelPrompt).not.toBe(input.expandedPrompt);
  });
});
