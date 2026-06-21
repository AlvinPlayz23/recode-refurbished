/**
 * Minimal Exa remote MCP client used by WebSearch.
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import { isRecord } from "../shared/is-record.ts";

export const DEFAULT_EXA_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa";

export interface ExaWebSearchArguments {
  readonly query: string;
  readonly numResults: number;
  readonly livecrawl: string;
  readonly type: string;
  readonly contextMaxCharacters?: number;
}

export interface ExaMcpEnvironment {
  readonly RECODE_EXA_MCP_URL?: string;
  readonly RECODE_EXA_API_KEY?: string;
  readonly EXA_API_KEY?: string;
}

export interface ExaWebSearchOptions {
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly env?: ExaMcpEnvironment;
}

interface JsonRpcToolTextContent {
  readonly type: "text";
  readonly text: string;
}

/**
 * Build the remote MCP URL, adding an Exa key only when the user configured one.
 */
export function buildExaMcpUrl(env: ExaMcpEnvironment = readExaMcpEnvironment()): string {
  const configuredUrl = env.RECODE_EXA_MCP_URL?.trim();
  const url = new URL(configuredUrl === undefined || configuredUrl === "" ? DEFAULT_EXA_MCP_URL : configuredUrl);
  const apiKey = env.RECODE_EXA_API_KEY?.trim() || env.EXA_API_KEY?.trim();

  if (!url.searchParams.has("tools")) {
    url.searchParams.set("tools", "web_search_exa");
  }

  if (apiKey !== undefined && apiKey !== "") {
    url.searchParams.set("exaApiKey", apiKey);
  }

  return url.toString();
}

function readExaMcpEnvironment(): ExaMcpEnvironment {
  return {
    ...(Bun.env.RECODE_EXA_MCP_URL === undefined ? {} : { RECODE_EXA_MCP_URL: Bun.env.RECODE_EXA_MCP_URL }),
    ...(Bun.env.RECODE_EXA_API_KEY === undefined ? {} : { RECODE_EXA_API_KEY: Bun.env.RECODE_EXA_API_KEY }),
    ...(Bun.env.EXA_API_KEY === undefined ? {} : { EXA_API_KEY: Bun.env.EXA_API_KEY })
  };
}

/**
 * Build the JSON-RPC body expected by Exa's hosted MCP endpoint.
 */
export function buildExaWebSearchRequestBody(arguments_: ExaWebSearchArguments): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: arguments_
    }
  };
}

/**
 * Call Exa's hosted MCP web search tool and return the first text content payload.
 */
export async function callExaWebSearch(
  arguments_: ExaWebSearchArguments,
  options: ExaWebSearchOptions = {}
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const controller = createLinkedAbortController(options.abortSignal, timeoutMs);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(buildExaMcpUrl(options.env), {
      method: "POST",
      headers: {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify(buildExaWebSearchRequestBody(arguments_)),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new ToolExecutionError(formatExaHttpError(response.status, response.statusText, responseText));
    }

    return parseExaMcpTextResponse(responseText);
  } catch (error) {
    if (isAbortError(error)) {
      throw new ToolExecutionError(`Exa web search timed out after ${Math.ceil(timeoutMs / 1000)}s.`);
    }

    if (error instanceof ToolExecutionError) {
      throw error;
    }

    throw new ToolExecutionError(`Exa web search failed: ${errorToString(error)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Parse either an SSE stream or a plain JSON-RPC response from Exa.
 */
export function parseExaMcpTextResponse(responseText: string): string | undefined {
  const sseLines = responseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));

  if (sseLines.length > 0) {
    for (const line of sseLines) {
      const payload = line.slice("data:".length).trim();
      if (payload === "" || payload === "[DONE]") {
        continue;
      }

      const text = readJsonRpcTextContent(parseJson(payload));
      if (text !== undefined) {
        return text;
      }
    }

    return undefined;
  }

  return readJsonRpcTextContent(parseJson(responseText));
}

function readJsonRpcTextContent(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const error = value["error"];
  if (isRecord(error)) {
    const message = typeof error["message"] === "string" ? error["message"] : JSON.stringify(error);
    throw new ToolExecutionError(`Exa web search failed: ${message}`);
  }

  const result = value["result"];
  if (!isRecord(result)) {
    return undefined;
  }

  const content = result["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const item of content) {
    const textContent = readTextContent(item);
    if (textContent !== undefined && textContent.trim() !== "") {
      return textContent;
    }
  }

  return undefined;
}

function readTextContent(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const content = value as Partial<JsonRpcToolTextContent>;
  return content.type === "text" && typeof content.text === "string" ? content.text : undefined;
}

function createLinkedAbortController(signal: AbortSignal | undefined, timeoutMs: number): AbortController {
  const controller = new AbortController();

  if (signal?.aborted === true) {
    controller.abort();
    return controller;
  }

  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  if (timeoutMs <= 0) {
    controller.abort();
  }

  return controller;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ToolExecutionError("Exa web search returned an invalid JSON-RPC response.");
  }
}

function formatExaHttpError(status: number, statusText: string, responseText: string): string {
  const details = responseText.trim().slice(0, 500);
  const suffix = details === "" ? "" : ` ${details}`;
  return `Exa web search failed with HTTP ${status}${statusText === "" ? "" : ` ${statusText}`}.${suffix}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
