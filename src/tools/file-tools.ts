/**
 * File tool implementations.
 *
 * @author dev
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ToolExecutionError } from "../errors/recode-error.ts";
import { resolveSafePath } from "./safe-path.ts";
import type { ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "./tool.ts";
import {
  readRequiredNonEmptyString,
  readRequiredString
} from "./tool-input.ts";

const MAX_READ_FILE_BYTES = 1_000_000;

interface ReadFileInput {
  readonly path: string;
}

interface WriteFileInput {
  readonly path: string;
  readonly content: string;
}

interface EditFileInput {
  readonly path: string;
  readonly edits: readonly EditFileReplacement[];
}

interface EditFileReplacement {
  readonly oldText: string;
  readonly newText: string;
  readonly replaceAll: boolean;
}

interface PlannedReplacement {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/**
 * Create the Read tool definition.
 */
export function createReadFileTool(): ToolDefinition {
  return {
    name: "Read",
    description: "Read a text file from the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the workspace root."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseReadFileInput(arguments_);
      const absolutePath = resolveSafePath(context.workspaceRoot, input.path);
      const file = Bun.file(absolutePath);

      if (!(await file.exists())) {
        throw new ToolExecutionError(`File does not exist: ${input.path}`);
      }

      if (file.size > MAX_READ_FILE_BYTES) {
        throw new ToolExecutionError(
          `File is too large to read safely: ${input.path} (${file.size} bytes).`
        );
      }

      return {
        content: await file.text(),
        isError: false
      };
    }
  };
}

/**
 * Create the Write tool definition.
 */
export function createWriteFileTool(): ToolDefinition {
  return {
    name: "Write",
    description: "Create or overwrite a text file in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the workspace root."
        },
        content: {
          type: "string",
          description: "Full text content to write."
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseWriteFileInput(arguments_);
      const absolutePath = resolveSafePath(context.workspaceRoot, input.path);

      await mkdir(dirname(absolutePath), { recursive: true });
      await Bun.write(absolutePath, input.content);

      return {
        content: `Wrote file: ${input.path}`,
        isError: false
      };
    }
  };
}

/**
 * Create the Edit tool definition.
 */
export function createEditFileTool(): ToolDefinition {
  return {
    name: "Edit",
    description: [
      "Edit one file using exact text replacements.",
      "Prefer edits: [{ oldText, newText }] for one or more non-overlapping replacements.",
      "All edits are matched against the original file, not incrementally.",
      "Use replaceAll only when every occurrence should change.",
      "Legacy oldText/newText input is still accepted for a single replacement."
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the workspace root."
        },
        oldText: {
          type: "string",
          description: "Existing text that must appear exactly once."
        },
        newText: {
          type: "string",
          description: "Legacy replacement text for a single targeted edit."
        },
        edits: {
          type: "array",
          description: "One or more exact replacements. Each oldText must be unique unless replaceAll is true.",
          items: {
            type: "object",
            properties: {
              oldText: {
                type: "string",
                description: "Exact text to replace. Must be unique unless replaceAll is true."
              },
              newText: {
                type: "string",
                description: "Replacement text."
              },
              replaceAll: {
                type: "boolean",
                description: "Replace every occurrence of oldText. Defaults to false."
              }
            },
            required: ["oldText", "newText"],
            additionalProperties: false
          },
          minItems: 1,
          maxItems: 50
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseEditFileInput(arguments_);
      const absolutePath = resolveSafePath(context.workspaceRoot, input.path);
      const file = Bun.file(absolutePath);

      if (!(await file.exists())) {
        throw new ToolExecutionError(`File does not exist: ${input.path}`);
      }

      const currentContent = await file.text();
      const plannedReplacements = planReplacements(currentContent, input.edits, input.path);
      const nextContent = applyPlannedReplacements(currentContent, plannedReplacements);

      if (nextContent === currentContent) {
        throw new ToolExecutionError(`No changes made to ${input.path}. The replacements produced identical content.`);
      }

      await Bun.write(absolutePath, nextContent);

      return {
        content: `Edited file: ${input.path} (${plannedReplacements.length} replacement${plannedReplacements.length === 1 ? "" : "s"})`,
        isError: false,
        metadata: {
          kind: "edit-preview",
          path: input.path,
          oldText: currentContent,
          newText: nextContent,
          replacementCount: plannedReplacements.length
        }
      };
    }
  };
}

function parseReadFileInput(arguments_: ToolArguments): ReadFileInput {
  return {
    path: readRequiredNonEmptyString(
      arguments_,
      "path",
      "Read tool requires a non-empty 'path' string."
    )
  };
}

function parseWriteFileInput(arguments_: ToolArguments): WriteFileInput {
  return {
    path: readRequiredNonEmptyString(
      arguments_,
      "path",
      "Write tool requires a non-empty 'path' string."
    ),
    content: readRequiredString(
      arguments_,
      "content",
      "Write tool requires a string 'content' field."
    )
  };
}

function parseEditFileInput(arguments_: ToolArguments): EditFileInput {
  const path = readRequiredNonEmptyString(
    arguments_,
    "path",
    "Edit tool requires a non-empty 'path' string."
  );

  return {
    path,
    edits: parseEditReplacements(arguments_)
  };
}

function parseEditReplacements(arguments_: ToolArguments): readonly EditFileReplacement[] {
  const editsValue = arguments_["edits"];
  if (editsValue !== undefined) {
    if (!Array.isArray(editsValue) || editsValue.length === 0) {
      throw new ToolExecutionError("Edit tool 'edits' must be a non-empty array.");
    }

    return editsValue.map(parseEditReplacement);
  }

  return [{
    oldText: readRequiredNonEmptyString(
      arguments_,
      "oldText",
      "Edit tool requires either 'edits' or a non-empty legacy 'oldText' string."
    ),
    newText: readRequiredString(
      arguments_,
      "newText",
      "Edit tool requires either 'edits' or a legacy string 'newText' field."
    ),
    replaceAll: readOptionalReplaceAll(arguments_)
  }];
}

function parseEditReplacement(value: unknown, index: number): EditFileReplacement {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolExecutionError(`Edit edits[${index}] must be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    oldText: readRequiredNonEmptyString(
      record,
      "oldText",
      `Edit edits[${index}].oldText must be a non-empty string.`
    ),
    newText: readRequiredString(
      record,
      "newText",
      `Edit edits[${index}].newText must be a string.`
    ),
    replaceAll: readOptionalReplaceAll(record)
  };
}

function readOptionalReplaceAll(record: Record<string, unknown>): boolean {
  const value = record["replaceAll"];
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new ToolExecutionError("Edit 'replaceAll' must be a boolean when provided.");
  }

  return value;
}

function planReplacements(
  content: string,
  edits: readonly EditFileReplacement[],
  path: string
): readonly PlannedReplacement[] {
  const replacements: PlannedReplacement[] = [];

  for (const [index, edit] of edits.entries()) {
    const matches = findAllOccurrences(content, edit.oldText);

    if (matches.length === 0) {
      throw new ToolExecutionError(`Could not find edits[${index}].oldText in ${path}. The oldText must match exactly including whitespace and newlines.`);
    }

    if (!edit.replaceAll && matches.length > 1) {
      throw new ToolExecutionError(`Found ${matches.length} occurrences of edits[${index}].oldText in ${path}. Provide more context or set replaceAll to true.`);
    }

    for (const match of edit.replaceAll ? matches : matches.slice(0, 1)) {
      replacements.push({
        start: match,
        end: match + edit.oldText.length,
        newText: edit.newText
      });
    }
  }

  return validateNonOverlappingReplacements(replacements, path);
}

function validateNonOverlappingReplacements(
  replacements: readonly PlannedReplacement[],
  path: string
): readonly PlannedReplacement[] {
  const sorted = [...replacements].sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      throw new ToolExecutionError(`Edit replacements overlap in ${path}. Merge nearby changes into one edit item.`);
    }
  }

  return sorted;
}

function applyPlannedReplacements(
  content: string,
  replacements: readonly PlannedReplacement[]
): string {
  let nextContent = content;

  for (const replacement of [...replacements].reverse()) {
    nextContent = `${nextContent.slice(0, replacement.start)}${replacement.newText}${nextContent.slice(replacement.end)}`;
  }

  return nextContent;
}

function findAllOccurrences(content: string, target: string): readonly number[] {
  const indexes: number[] = [];
  let searchIndex = 0;

  while (searchIndex < content.length) {
    const matchIndex = content.indexOf(target, searchIndex);

    if (matchIndex === -1) {
      return indexes;
    }

    indexes.push(matchIndex);
    searchIndex = matchIndex + target.length;
  }

  return indexes;
}
