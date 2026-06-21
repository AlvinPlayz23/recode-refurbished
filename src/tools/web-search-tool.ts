/**
 * WebSearch tool powered by Exa's hosted MCP web_search_exa tool.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import type { ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "./tool.ts";
import {
  readOptionalNonEmptyString,
  readRequiredNonEmptyString
} from "./tool-input.ts";
import { callExaWebSearch, type ExaWebSearchArguments } from "./exa-mcp.ts";

const DEFAULT_NUM_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 25_000;
const VALID_LIVECRAWL_VALUES = new Set(["fallback", "preferred"]);
const VALID_SEARCH_TYPES = new Set(["auto", "fast", "deep"]);

interface WebSearchInput extends ExaWebSearchArguments {}

/**
 * Create the WebSearch tool definition.
 */
export function createWebSearchTool(): ToolDefinition {
  const currentYear = new Date().getFullYear();

  return {
    name: "WebSearch",
    description: [
      "Search the web for up-to-date information through Exa's hosted MCP web_search_exa tool.",
      `Use this when current or post-${currentYear - 1} information may matter, or when a web source would improve confidence.`,
      "This is read-only network access and does not expose API keys in tool output."
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query."
        },
        numResults: {
          type: "number",
          description: "Number of search results to return. Defaults to 8."
        },
        livecrawl: {
          type: "string",
          description: "Exa livecrawl mode. Use fallback or preferred. Defaults to fallback."
        },
        type: {
          type: "string",
          description: "Exa search type. Use auto, fast, or deep. Defaults to auto."
        },
        contextMaxCharacters: {
          type: "number",
          description: "Optional maximum context characters returned by Exa."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseWebSearchInput(arguments_);
      const content = await callExaWebSearch(input, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal })
      });

      return {
        content: content ?? "No search results found. Try a more specific query.",
        isError: false
      };
    }
  };
}

function parseWebSearchInput(arguments_: ToolArguments): WebSearchInput {
  const query = readRequiredNonEmptyString(
    arguments_,
    "query",
    "WebSearch requires a non-empty 'query' string."
  );
  const livecrawl = readEnumString(
    arguments_,
    "livecrawl",
    "fallback",
    VALID_LIVECRAWL_VALUES,
    "WebSearch 'livecrawl' must be 'fallback' or 'preferred'."
  );
  const type = readEnumString(
    arguments_,
    "type",
    "auto",
    VALID_SEARCH_TYPES,
    "WebSearch 'type' must be 'auto', 'fast', or 'deep'."
  );
  const numResults = readPositiveInteger(arguments_, "numResults", DEFAULT_NUM_RESULTS, "WebSearch 'numResults' must be a positive integer.");
  const contextMaxCharacters = readOptionalPositiveInteger(arguments_, "contextMaxCharacters", "WebSearch 'contextMaxCharacters' must be a positive integer.");

  return {
    query: query.trim(),
    numResults,
    livecrawl,
    type,
    ...(contextMaxCharacters === undefined ? {} : { contextMaxCharacters })
  };
}

function readEnumString(
  record: Record<string, unknown>,
  key: string,
  defaultValue: string,
  validValues: ReadonlySet<string>,
  message: string
): string {
  const value = readOptionalNonEmptyString(record, key, message);
  if (value === undefined) {
    return defaultValue;
  }

  if (!validValues.has(value)) {
    throw new ToolExecutionError(message);
  }

  return value;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  defaultValue: number,
  message: string
): number {
  const value = record[key];
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ToolExecutionError(message);
  }

  return value;
}

function readOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  message: string
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ToolExecutionError(message);
  }

  return value;
}
