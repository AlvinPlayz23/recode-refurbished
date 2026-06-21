/**
 * Interactive user-question tool.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import { isRecord } from "../shared/is-record.ts";
import type {
  JsonSchemaObject,
  QuestionAnswer,
  QuestionOption,
  QuestionPrompt,
  QuestionToolDecision,
  QuestionToolRequest,
  ToolArguments,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult
} from "./tool.ts";
import {
  readRequiredArray,
  readRequiredBoolean,
  readRequiredNonEmptyString,
  readToolInputRecord
} from "./tool-input.ts";

const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";

type QuestionToolResultPayload = (
  | { readonly dismissed: true }
  | { readonly dismissed: false; readonly answers: readonly QuestionAnswer[] }
) & {
  readonly questions: readonly QuestionPrompt[];
};

/**
 * Create the interactive question tool.
 */
export function createAskUserQuestionTool(): ToolDefinition {
  return {
    name: ASK_USER_QUESTION_TOOL_NAME,
    description: "Ask the user up to 4 structured questions during execution to clarify requirements or preferences.",
    inputSchema: QUESTION_TOOL_INPUT_SCHEMA,
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const request = parseQuestionToolRequest(arguments_);

      if (context.requestQuestionAnswers === undefined) {
        throw new ToolExecutionError("AskUserQuestion requires an interactive question handler.");
      }

      const decision = await context.requestQuestionAnswers(request);
      return {
        content: serializeQuestionToolResult({
          ...decision,
          questions: request.questions
        }),
        isError: false
      };
    }
  };
}

/**
 * Parse AskUserQuestion arguments into a validated request payload.
 */
export function parseQuestionToolRequest(arguments_: ToolArguments): QuestionToolRequest {
  const questionsValue = readRequiredArray(
    arguments_,
    "questions",
    "AskUserQuestion requires a 'questions' array."
  );

  if (questionsValue.length === 0) {
    throw new ToolExecutionError("AskUserQuestion requires at least one question.");
  }

  if (questionsValue.length > 4) {
    throw new ToolExecutionError("AskUserQuestion supports at most 4 questions per request.");
  }

  const questions = questionsValue.map((question, index) => parseQuestionPrompt(question, index));
  return { questions };
}

/**
 * Serialize one AskUserQuestion result for transcript storage.
 */
export function serializeQuestionToolResult(payload: QuestionToolResultPayload): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse serialized AskUserQuestion result content.
 */
export function parseQuestionToolResult(content: string): QuestionToolResultPayload | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return parseQuestionToolResultPayload(value);
  } catch {
    return undefined;
  }
}

/**
 * Build a readable user transcript summary from a question-tool result payload.
 */
export function formatQuestionAnswerSummary(payload: QuestionToolResultPayload): string {
  if (payload.dismissed) {
    return "Dismissed a question prompt.";
  }

  const lines = ["Question answers:"];

  for (const question of payload.questions) {
    const answer = payload.answers.find((item) => item.questionId === question.id);
    const selectedLabels = answer?.selectedOptionLabels.join(", ") ?? "";
    const customText = answer?.customText.trim() ?? "";
    const parts = [selectedLabels, customText].filter((part) => part !== "");
    lines.push(`- ${question.header}: ${parts.length === 0 ? "(no answer)" : parts.join(" | ")}`);
  }

  return lines.join("\n");
}

const QUESTION_TOOL_INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "One to four questions to present to the user.",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable identifier for the question." },
          header: { type: "string", description: "Short heading shown above the question." },
          question: { type: "string", description: "Main question text." },
          multiSelect: { type: "boolean", description: "Whether multiple options can be selected." },
          allowCustomText: { type: "boolean", description: "Whether the user can provide custom text." },
          options: {
            type: "array",
            description: "Selectable answer options for the question.",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Option label shown to the user." },
                description: { type: "string", description: "Short option explanation." }
              },
              required: ["label", "description"],
              additionalProperties: false
            }
          }
        },
        required: ["id", "header", "question", "multiSelect", "allowCustomText", "options"],
        additionalProperties: false
      }
    }
  },
  required: ["questions"],
  additionalProperties: false
};

function parseQuestionPrompt(value: unknown, index: number): QuestionPrompt {
  const questionRecord = readToolInputRecord(value, `AskUserQuestion question #${index + 1} must be an object.`);

  const id = readRequiredNonEmptyString(questionRecord, "id", `AskUserQuestion question #${index + 1} requires a non-empty 'id'.`).trim();
  const header = readRequiredNonEmptyString(questionRecord, "header", `AskUserQuestion question '${id}' requires a non-empty 'header'.`).trim();
  const question = readRequiredNonEmptyString(questionRecord, "question", `AskUserQuestion question '${id}' requires a non-empty 'question'.`).trim();
  const multiSelect = readRequiredBoolean(questionRecord, "multiSelect", `AskUserQuestion question '${id}' requires a boolean 'multiSelect'.`);
  const allowCustomText = readRequiredBoolean(questionRecord, "allowCustomText", `AskUserQuestion question '${id}' requires a boolean 'allowCustomText'.`);
  const optionsValue = readRequiredArray(questionRecord, "options", `AskUserQuestion question '${id}' requires a non-empty 'options' array.`);

  if (optionsValue.length === 0) {
    throw new ToolExecutionError(`AskUserQuestion question '${id}' requires a non-empty 'options' array.`);
  }

  const options = optionsValue.map((option, optionIndex) => parseQuestionOption(option, id, optionIndex));
  return {
    id,
    header,
    question,
    multiSelect,
    allowCustomText,
    options
  };
}

function parseQuestionOption(value: unknown, questionId: string, index: number): QuestionOption {
  const optionRecord = readToolInputRecord(value, `AskUserQuestion question '${questionId}' option #${index + 1} must be an object.`);

  return {
    label: readRequiredNonEmptyString(optionRecord, "label", `AskUserQuestion question '${questionId}' option #${index + 1} requires a non-empty 'label'.`).trim(),
    description: readRequiredNonEmptyString(
      optionRecord,
      "description",
      `AskUserQuestion question '${questionId}' option #${index + 1} requires a non-empty 'description'.`
    ).trim()
  };
}

function parseQuestionToolResultPayload(value: unknown): QuestionToolResultPayload | undefined {
  if (!isRecord(value) || !Array.isArray(value["questions"])) {
    return undefined;
  }

  const questions = value["questions"].map((question, index) => {
    try {
      return parseQuestionPrompt(question, index);
    } catch {
      return undefined;
    }
  }).filter((question): question is QuestionPrompt => question !== undefined);

  if (questions.length !== value["questions"].length || typeof value["dismissed"] !== "boolean") {
    return undefined;
  }

  if (value["dismissed"]) {
    return {
      dismissed: true,
      questions
    };
  }

  if (!Array.isArray(value["answers"])) {
    return undefined;
  }

  const answers = value["answers"].map(parseQuestionAnswer).filter((answer): answer is QuestionAnswer => answer !== undefined);
  if (answers.length !== value["answers"].length) {
    return undefined;
  }

  return {
    dismissed: false,
    questions,
    answers
  };
}

function parseQuestionAnswer(value: unknown): QuestionAnswer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const questionId = typeof value["questionId"] === "string" ? value["questionId"].trim() : "";
  const customText = typeof value["customText"] === "string" ? value["customText"] : "";
  const selectedOptionLabelsValue = value["selectedOptionLabels"];

  if (questionId === "" || !Array.isArray(selectedOptionLabelsValue)) {
    return undefined;
  }

  const selectedOptionLabels = selectedOptionLabelsValue.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  if (selectedOptionLabels.length !== selectedOptionLabelsValue.length) {
    return undefined;
  }

  return {
    questionId,
    selectedOptionLabels,
    customText
  };
}
