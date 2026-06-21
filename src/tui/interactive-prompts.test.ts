/**
 * Tests for interactive prompt workflow helpers.
 */

import { describe, expect, it } from "bun:test";
import type { QuestionToolRequest } from "../tools/tool.ts";
import {
  buildQuestionSubmission,
  createActiveQuestionRequest,
  getNextApprovalAllowlist,
  selectHighlightedOptionIfUnanswered,
  toggleQuestionOption,
  updateQuestionCustomText
} from "./interactive-prompts.ts";

describe("interactive prompt helpers", () => {
  it("does not persist read scopes for always-allow approvals", () => {
    expect(getNextApprovalAllowlist("allow-always", "read", [])).toEqual([]);
  });

  it("persists non-read scopes once", () => {
    expect(getNextApprovalAllowlist("allow-always", "edit", [])).toEqual(["edit"]);
    expect(getNextApprovalAllowlist("allow-always", "edit", ["edit"])).toEqual(["edit"]);
  });

  it("toggles a selected question option and submits answers", () => {
    const request = createActiveQuestionRequest(questionRequest(), () => {});
    const toggled = toggleQuestionOption(request);

    expect(toggled?.answers["scope"]?.selectedOptionLabels).toEqual(["Workspace"]);
    expect(toggled === undefined ? undefined : buildQuestionSubmission(toggled)).toEqual({
      kind: "submit",
      decision: {
        dismissed: false,
        answers: [
          {
            questionId: "scope",
            selectedOptionLabels: ["Workspace"],
            customText: ""
          }
        ]
      }
    });
  });

  it("reports the first unanswered non-context question", () => {
    const request = createActiveQuestionRequest(questionRequest(), () => {});

    expect(buildQuestionSubmission(request)).toEqual({
      kind: "missing-answer",
      header: "Scope"
    });
  });

  it("stores custom question text", () => {
    const request = updateQuestionCustomText(createActiveQuestionRequest(questionRequest(), () => {}), "Only src/");

    expect(request?.answers["scope"]?.customText).toBe("Only src/");
  });

  it("selects the highlighted option before submitting an unanswered question", () => {
    const request = createActiveQuestionRequest(questionRequest(), () => {});
    const selected = selectHighlightedOptionIfUnanswered(request);

    expect(selected.answers["scope"]?.selectedOptionLabels).toEqual(["Workspace"]);
  });
});

function questionRequest(): QuestionToolRequest {
  return {
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Where should I look?",
        multiSelect: false,
        allowCustomText: true,
        options: [
          {
            label: "Workspace",
            description: "Use the current workspace."
          }
        ]
      }
    ]
  };
}
