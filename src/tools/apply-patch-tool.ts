/**
 * ApplyPatch tool implementation.
 */

import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { ToolExecutionError } from "../errors/recode-error.ts";
import { resolveSafePath } from "./safe-path.ts";
import type { ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "./tool.ts";
import { readRequiredNonEmptyString } from "./tool-input.ts";

interface ApplyPatchInput {
  readonly patch: string;
}

type PatchOperation =
  | { readonly type: "add"; readonly path: string; readonly content: string }
  | { readonly type: "delete"; readonly path: string }
  | {
      readonly type: "update";
      readonly path: string;
      readonly moveTo?: string;
      readonly hunks: readonly PatchHunk[];
    };

interface PatchHunk {
  readonly oldText: string;
  readonly newText: string;
}

/**
 * Create the ApplyPatch tool definition.
 */
export function createApplyPatchTool(): ToolDefinition {
  return {
    name: "ApplyPatch",
    description: [
      "Apply a structured patch to files in the current workspace.",
      "Use the Begin Patch/End Patch envelope with *** Add File:, *** Delete File:, or *** Update File: sections.",
      "For Update File hunks, prefix context lines with a space, removed lines with '-', and added lines with '+'.",
      "Example: *** Begin Patch\n*** Update File: path.txt\n@@\n-old\n+new\n*** End Patch"
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "Patch text using Begin Patch/End Patch with Add File, Delete File, and Update File sections."
        },
        patchText: {
          type: "string",
          description: "Alias for patch, accepted for OpenCode-compatible callers."
        }
      },
      required: ["patch"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseApplyPatchInput(arguments_);
      const operations = parsePatch(input.patch);
      const summaries: string[] = [];

      for (const operation of operations) {
        switch (operation.type) {
          case "add":
            await applyAddOperation(operation, context);
            summaries.push(`added ${operation.path}`);
            break;
          case "delete":
            await applyDeleteOperation(operation, context);
            summaries.push(`deleted ${operation.path}`);
            break;
          case "update":
            await applyUpdateOperation(operation, context);
            summaries.push(operation.moveTo === undefined
              ? `updated ${operation.path}`
              : `moved ${operation.path} -> ${operation.moveTo}`);
            break;
        }
      }

      return {
        content: `Applied patch: ${summaries.join(", ")}`,
        isError: false
      };
    }
  };
}

function parseApplyPatchInput(arguments_: ToolArguments): ApplyPatchInput {
  const patch = readPatchText(arguments_);

  if (patch !== undefined) {
    return { patch };
  }

  return {
    patch: readRequiredNonEmptyString(
      arguments_,
      "patch",
      "ApplyPatch tool requires a non-empty 'patch' string."
    )
  };
}

function readPatchText(arguments_: ToolArguments): string | undefined {
  const patch = arguments_["patch"];
  if (typeof patch === "string" && patch.trim() !== "") {
    return patch;
  }

  const patchText = arguments_["patchText"];
  if (typeof patchText === "string" && patchText.trim() !== "") {
    return patchText;
  }

  return undefined;
}

async function applyAddOperation(operation: Extract<PatchOperation, { type: "add" }>, context: ToolExecutionContext): Promise<void> {
  const absolutePath = resolveSafePath(context.workspaceRoot, operation.path);
  const file = Bun.file(absolutePath);

  if (await file.exists()) {
    throw new ToolExecutionError(`Cannot add file because it already exists: ${operation.path}`);
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, operation.content);
}

async function applyDeleteOperation(
  operation: Extract<PatchOperation, { type: "delete" }>,
  context: ToolExecutionContext
): Promise<void> {
  const absolutePath = resolveSafePath(context.workspaceRoot, operation.path);
  const file = Bun.file(absolutePath);

  if (!(await file.exists())) {
    throw new ToolExecutionError(`Cannot delete missing file: ${operation.path}`);
  }

  await unlink(absolutePath);
}

async function applyUpdateOperation(
  operation: Extract<PatchOperation, { type: "update" }>,
  context: ToolExecutionContext
): Promise<void> {
  const sourcePath = resolveSafePath(context.workspaceRoot, operation.path);
  const destinationPath = operation.moveTo === undefined
    ? sourcePath
    : resolveSafePath(context.workspaceRoot, operation.moveTo);
  const sourceFile = Bun.file(sourcePath);

  if (!(await sourceFile.exists())) {
    throw new ToolExecutionError(`Cannot update missing file: ${operation.path}`);
  }

  let nextContent = await sourceFile.text();
  for (const hunk of operation.hunks) {
    nextContent = applyHunk(nextContent, hunk, operation.path);
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await Bun.write(destinationPath, nextContent);

  if (operation.moveTo !== undefined && sourcePath !== destinationPath) {
    await unlink(sourcePath);
  }
}

function applyHunk(content: string, hunk: PatchHunk, path: string): string {
  if (hunk.oldText === hunk.newText) {
    return content;
  }

  if (hunk.oldText === "") {
    return appendContent(content, hunk.newText);
  }

  const matchCount = countOccurrences(content, hunk.oldText);
  if (matchCount === 0) {
    const fuzzyMatch = findFuzzyLineBlock(content, hunk.oldText);
    if (fuzzyMatch !== undefined) {
      return `${content.slice(0, fuzzyMatch.start)}${hunk.newText}${content.slice(fuzzyMatch.end)}`;
    }

    throw new ToolExecutionError(
      `Patch hunk target was not found in: ${path}. Make sure every unchanged context line starts with a space and matches the file.`
    );
  }

  if (matchCount > 1) {
    throw new ToolExecutionError(`Patch hunk target must appear exactly once in: ${path}`);
  }

  return content.replace(hunk.oldText, () => hunk.newText);
}

function parsePatch(patch: string): readonly PatchOperation[] {
  const lines = normalizePatchLines(patch);
  if (lines[0] !== "*** Begin Patch") {
    throw new ToolExecutionError("Patch must start with '*** Begin Patch'.");
  }

  if (lines[lines.length - 1] !== "*** End Patch") {
    throw new ToolExecutionError("Patch must end with '*** End Patch'.");
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length - 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const parsed = parseAddOperation(lines, index);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: readPatchHeaderPath(line, "*** Delete File: ")
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const parsed = parseUpdateOperation(lines, index);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    throw new ToolExecutionError(`Unknown patch section header: ${line}. ${PATCH_FORMAT_HINT}`);
  }

  if (operations.length === 0) {
    throw new ToolExecutionError("Patch did not include any file operations.");
  }

  return operations;
}

function parseAddOperation(
  lines: readonly string[],
  startIndex: number
): { readonly operation: PatchOperation; readonly nextIndex: number } {
  const path = readPatchHeaderPath(lines[startIndex] ?? "", "*** Add File: ");
  const contentLines: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length - 1 && !isOperationHeader(lines[index] ?? "")) {
    const line = lines[index] ?? "";
    if (!line.startsWith("+")) {
      throw new ToolExecutionError(`Add File lines must start with '+': ${line}`);
    }
    contentLines.push(line.slice(1));
    index += 1;
  }

  return {
    operation: {
      type: "add",
      path,
      content: contentLines.length === 0 ? "" : `${contentLines.join("\n")}\n`
    },
    nextIndex: index
  };
}

function parseUpdateOperation(
  lines: readonly string[],
  startIndex: number
): { readonly operation: PatchOperation; readonly nextIndex: number } {
  const path = readPatchHeaderPath(lines[startIndex] ?? "", "*** Update File: ");
  let moveTo: string | undefined;
  const hunks: PatchHunk[] = [];
  let index = startIndex + 1;

  if ((lines[index] ?? "").startsWith("*** Move to: ")) {
    moveTo = readPatchHeaderPath(lines[index] ?? "", "*** Move to: ");
    index += 1;
  }

  while (index < lines.length - 1 && !isOperationHeader(lines[index] ?? "")) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      index += 1;
      continue;
    }

    const parsed = parseUpdateHunk(lines, index);
    hunks.push(parsed.hunk);
    index = parsed.nextIndex;
  }

  if (hunks.length === 0 && moveTo === undefined) {
    throw new ToolExecutionError(`Update File section has no hunks: ${path}`);
  }

  return {
    operation: {
      type: "update",
      path,
      ...(moveTo === undefined ? {} : { moveTo }),
      hunks
    },
    nextIndex: index
  };
}

function parseUpdateHunk(
  lines: readonly string[],
  startIndex: number
): { readonly hunk: PatchHunk; readonly nextIndex: number } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let index = startIndex;

  while (index < lines.length - 1) {
    const line = lines[index] ?? "";
    if (isOperationHeader(line) || line.startsWith("@@")) {
      break;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const prefix = line[0];
    const text = line.slice(1);
    switch (prefix) {
      case " ":
        oldLines.push(text);
        newLines.push(text);
        break;
      case "-":
        oldLines.push(text);
        break;
      case "+":
        newLines.push(text);
        break;
      default:
        throw new ToolExecutionError(`Update hunk lines must start with ' ', '+', or '-': ${line}`);
    }
    index += 1;
  }

  return {
    hunk: {
      oldText: oldLines.length === 0 ? "" : `${oldLines.join("\n")}\n`,
      newText: newLines.length === 0 ? "" : `${newLines.join("\n")}\n`
    },
    nextIndex: index
  };
}

function normalizePatchLines(patch: string): readonly string[] {
  const lines = stripPatchWrappers(patch)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line, index, array) => !(index === array.length - 1 && line === ""))
    .map(normalizePatchHeaderLine);
  const beginIndex = lines.findIndex((line) => line.trim() === "*** Begin Patch");
  const endIndex = lines.findLastIndex((line) => line.trim() === "*** End Patch");

  if (beginIndex === -1) {
    throw new ToolExecutionError(`Patch must include '*** Begin Patch'. ${PATCH_FORMAT_HINT}`);
  }

  if (endIndex === -1 || endIndex <= beginIndex) {
    throw new ToolExecutionError(`Patch must include '*** End Patch' after '*** Begin Patch'. ${PATCH_FORMAT_HINT}`);
  }

  return lines.slice(beginIndex, endIndex + 1);
}

function readPatchHeaderPath(line: string, prefix: string): string {
  const path = line.slice(prefix.length).trim();
  if (path === "") {
    throw new ToolExecutionError(`Patch header is missing a path: ${line}`);
  }
  return path;
}

function isOperationHeader(line: string): boolean {
  return line.startsWith("*** Add File: ")
    || line.startsWith("*** Delete File: ")
    || line.startsWith("*** Update File: ");
}

const PATCH_FORMAT_HINT = "Expected headers like '*** Update File: path', with hunk lines prefixed by ' ', '+', or '-'.";

function stripPatchWrappers(patch: string): string {
  const trimmed = patch.trim();
  const fenceMatch = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  if (fenceMatch?.[1] !== undefined) {
    return stripPatchWrappers(fenceMatch[1]);
  }

  const heredocMatch = trimmed.match(/^(?:\w+\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  if (heredocMatch?.[2] !== undefined) {
    return stripPatchWrappers(heredocMatch[2]);
  }

  return patch;
}

function normalizePatchHeaderLine(line: string): string {
  const trimmed = line.trim();

  if (trimmed.startsWith("Add File: ")) {
    return `*** ${trimmed}`;
  }

  if (trimmed.startsWith("Delete File: ")) {
    return `*** ${trimmed}`;
  }

  if (trimmed.startsWith("Update File: ")) {
    return `*** ${trimmed}`;
  }

  if (trimmed.startsWith("Move to: ")) {
    return `*** ${trimmed}`;
  }

  return line;
}

function appendContent(content: string, newText: string): string {
  if (newText === "") {
    return content;
  }

  return content === "" || content.endsWith("\n")
    ? `${content}${newText}`
    : `${content}\n${newText}`;
}

function findFuzzyLineBlock(
  content: string,
  oldText: string
): { readonly start: number; readonly end: number } | undefined {
  const contentLines = splitLinesWithEndings(content);
  const oldLines = splitLinesWithEndings(oldText);
  const pattern = oldLines.map((line) => line.text);

  if (pattern.length === 0) {
    return undefined;
  }

  const matches: Array<{ readonly start: number; readonly end: number }> = [];
  for (let index = 0; index <= contentLines.length - pattern.length; index++) {
    if (pattern.every((line, offset) => normalizeComparableLine(contentLines[index + offset]?.text ?? "") === normalizeComparableLine(line))) {
      matches.push({
        start: contentLines[index]?.start ?? 0,
        end: contentLines[index + pattern.length - 1]?.end ?? content.length
      });
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

function splitLinesWithEndings(content: string): readonly {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}[] {
  if (content === "") {
    return [];
  }

  const lines: Array<{ readonly text: string; readonly start: number; readonly end: number }> = [];
  let start = 0;

  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") {
      lines.push({
        text: content.slice(start, index + 1),
        start,
        end: index + 1
      });
      start = index + 1;
    }
  }

  if (start < content.length) {
    lines.push({
      text: content.slice(start),
      start,
      end: content.length
    });
  }

  return lines;
}

function normalizeComparableLine(line: string): string {
  return line
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function countOccurrences(content: string, target: string): number {
  if (target === "") {
    return 0;
  }

  let count = 0;
  let searchIndex = 0;

  while (searchIndex < content.length) {
    const matchIndex = content.indexOf(target, searchIndex);

    if (matchIndex === -1) {
      return count;
    }

    count += 1;
    searchIndex = matchIndex + target.length;
  }

  return count;
}
