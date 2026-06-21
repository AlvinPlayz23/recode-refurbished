/**
 * Tests for plan-review helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  PLAN_MODE_TURN_REMINDER,
  PLAN_REVISION_REMINDER,
  PLAN_TAG_FORMAT_REMINDER,
  buildPlanModeModelPrompt,
  buildPlanImplementationPrompt,
  detectPlanReview,
  extractLatestPlanBlock
} from "./plan-review.ts";

describe("plan review helpers", () => {
  it("extracts the latest plan block", () => {
    expect(extractLatestPlanBlock("notes\n<plan>\nfirst\n</plan>\n<plan>second</plan>")).toBe("second");
  });

  it("ignores empty or missing plan blocks", () => {
    expect(extractLatestPlanBlock("no plan here")).toBeUndefined();
    expect(extractLatestPlanBlock("<plan>   </plan>")).toBeUndefined();
  });

  it("accepts markdown implementation plan output as a fallback", () => {
    expect(extractLatestPlanBlock([
      "-----",
      "Implementation Plan",
      "- Update the prompt",
      "- Verify the popup"
    ].join("\n"))).toContain("Implementation Plan");
  });

  it("reports whether the plan came from tags or markdown fallback", () => {
    expect(detectPlanReview("<plan>Use tags</plan>")).toEqual({
      plan: "Use tags",
      format: "tagged"
    });
    expect(detectPlanReview("Implementation Plan\n- Do it")?.format).toBe("markdown-fallback");
  });

  it("provides a reminder to use plan tags after markdown fallback", () => {
    expect(PLAN_TAG_FORMAT_REMINDER).toContain("<plan>");
    expect(PLAN_TAG_FORMAT_REMINDER).toContain("</plan>");
    expect(PLAN_TAG_FORMAT_REMINDER).toContain("markdown heading");
  });

  it("builds a synthetic plan-mode model prompt", () => {
    const prompt = buildPlanModeModelPrompt("create a dashboard", {
      remindAboutPlanTags: false,
      remindAboutPlanRevision: false
    });

    expect(prompt).toContain(PLAN_MODE_TURN_REMINDER);
    expect(prompt).toContain("Plan mode is active");
    expect(prompt).toContain("do not call Bash, Write, Edit, ApplyPatch, or Task");
    expect(prompt.endsWith("create a dashboard")).toBe(true);
  });

  it("includes the tag reminder in the synthetic prompt when needed", () => {
    const prompt = buildPlanModeModelPrompt("revise that", {
      remindAboutPlanTags: true,
      remindAboutPlanRevision: false
    });

    expect(prompt).toContain(PLAN_TAG_FORMAT_REMINDER);
    expect(prompt).toContain("revise that");
  });

  it("includes a full-plan revision reminder after declined implementation", () => {
    const prompt = buildPlanModeModelPrompt("make sure it is blue", {
      remindAboutPlanTags: false,
      remindAboutPlanRevision: true
    });

    expect(prompt).toContain(PLAN_REVISION_REMINDER);
    expect(prompt).toContain("whole existing plan");
    expect(prompt).toContain("Rewrite the complete <plan> block");
  });

  it("builds an implementation prompt that preserves context", () => {
    const prompt = buildPlanImplementationPrompt();

    expect(prompt).toContain("previous assistant message");
    expect(prompt).toContain("existing conversation context");
    expect(prompt).toContain("start making the changes");
  });
});
