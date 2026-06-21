/**
 * Tool set builder for the MVP tool collection.
 *
 * @author dev
 */

import { createBashTool } from "./bash-tool.ts";
import { createApplyPatchTool } from "./apply-patch-tool.ts";
import { createAskUserQuestionTool } from "./ask-user-question-tool.ts";
import { createEditFileTool, createReadFileTool, createWriteFileTool } from "./file-tools.ts";
import { createGlobTool } from "./glob-tool.ts";
import { createGrepTool } from "./grep-tool.ts";
import type { ToolDefinition } from "./tool.ts";
import { createTaskTool } from "./task-tool.ts";
import { createTodoWriteTool } from "./todo-write-tool.ts";
import { createWebFetchTool } from "./web-fetch-tool.ts";
import { createWebSearchTool } from "./web-search-tool.ts";

/**
 * Create the initial core tool set for Recode.
 */
export function createTools(): readonly ToolDefinition[] {
  return [
    createBashTool(),
    createAskUserQuestionTool(),
    createTodoWriteTool(),
    createTaskTool(),
    createReadFileTool(),
    createWriteFileTool(),
    createEditFileTool(),
    createApplyPatchTool(),
    createGlobTool(),
    createGrepTool(),
    createWebFetchTool(),
    createWebSearchTool()
  ];
}
