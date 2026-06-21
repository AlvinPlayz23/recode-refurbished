/**
 * Tests for the AskUserQuestion tool.
 */

import { describe, expect, it } from "bun:test";
import { ToolExecutionError } from "../../errors/recode-error.ts";
import {
  createAskUserQuestionTool,
  formatQuestionAnswerSummary,
  parseQuestionToolRequest,
  parseQuestionToolResult
} from "../ask-user-question-tool.ts";

describe("AskUserQuestion tool", () => {
  it("rejects an empty question list", () => {
    expect(() => parseQuestionToolRequest({ questions: [] })).toThrow(ToolExecutionError);
  });

  it("rejects more than four questions", () => {
    expect(() => parseQuestionToolRequest({
      questions: Array.from({ length: 5 }, (_, index) => createQuestion(`q${index + 1}`))
    })).toThrow(ToolExecutionError);
  });

  it("rejects questions without options", () => {
    expect(() => parseQuestionToolRequest({
      questions: [{ ...createQuestion("q1"), options: [] }]
    })).toThrow(ToolExecutionError);
  });

  it("rejects malformed booleans", () => {
    expect(() => parseQuestionToolRequest({
      questions: [{
        ...createQuestion("q1"),
        multiSelect: "yes"
      }]
    })).toThrow(ToolExecutionError);
  });

  it("returns normalized answers from the interactive handler", async () => {
    const tool = createAskUserQuestionTool();
    const result = await tool.execute(
      {
        questions: [createQuestion("approach")]
      },
      {
        workspaceRoot: "/workspace",
        requestQuestionAnswers: async () => ({
          dismissed: false,
          answers: [{
            questionId: "approach",
            selectedOptionLabels: ["Option A"],
            customText: "Need careful rollout"
          }]
        })
      }
    );

    expect(result.isError).toBe(false);
    const parsed = parseQuestionToolResult(result.content);
    expect(parsed).toEqual({
      dismissed: false,
      questions: [createQuestion("approach")],
      answers: [{
        questionId: "approach",
        selectedOptionLabels: ["Option A"],
        customText: "Need careful rollout"
      }]
    });
  });

  it("returns a dismissal result when canceled", async () => {
    const tool = createAskUserQuestionTool();
    const result = await tool.execute(
      {
        questions: [createQuestion("approach")]
      },
      {
        workspaceRoot: "/workspace",
        requestQuestionAnswers: async () => ({
          dismissed: true
        })
      }
    );

    expect(parseQuestionToolResult(result.content)).toEqual({
      dismissed: true,
      questions: [createQuestion("approach")]
    });
  });

  it("errors clearly when no interactive handler exists", async () => {
    const tool = createAskUserQuestionTool();

    await expect(tool.execute(
      {
        questions: [createQuestion("approach")]
      },
      {
        workspaceRoot: "/workspace"
      }
    )).rejects.toThrow("interactive question handler");
  });

  it("formats a readable user summary", () => {
    const summary = formatQuestionAnswerSummary({
      dismissed: false,
      questions: [createQuestion("approach")],
      answers: [{
        questionId: "approach",
        selectedOptionLabels: ["Option A"],
        customText: "Need careful rollout"
      }]
    });

    expect(summary).toContain("Question answers:");
    expect(summary).toContain("Need careful rollout");
  });
});

function createQuestion(id: string) {
  return {
    id,
    header: "Approach",
    question: "Which approach should we use?",
    multiSelect: false,
    allowCustomText: true,
    options: [
      { label: "Option A", description: "Use the first approach." },
      { label: "Option B", description: "Use the second approach." }
    ]
  };
}
