/**
 * Tests for the WebSearch tool and Exa MCP helper.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  buildExaMcpUrl,
  buildExaWebSearchRequestBody,
  callExaWebSearch,
  parseExaMcpTextResponse
} from "../exa-mcp.ts";
import { createWebSearchTool } from "../web-search-tool.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Exa MCP helper", () => {
  it("builds the default URL and appends an API key when configured", () => {
    const url = new URL(buildExaMcpUrl({
      RECODE_EXA_API_KEY: "secret-key"
    }));

    expect(url.origin).toBe("https://mcp.exa.ai");
    expect(url.pathname).toBe("/mcp");
    expect(url.searchParams.get("tools")).toBe("web_search_exa");
    expect(url.searchParams.get("exaApiKey")).toBe("secret-key");
  });

  it("builds the JSON-RPC tools/call body", () => {
    expect(buildExaWebSearchRequestBody({
      query: "latest TypeScript",
      numResults: 3,
      livecrawl: "fallback",
      type: "auto"
    })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: "latest TypeScript",
          numResults: 3,
          livecrawl: "fallback",
          type: "auto"
        }
      }
    });
  });

  it("parses SSE text content", () => {
    expect(parseExaMcpTextResponse([
      "event: message",
      "data: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Result text\"}]}}",
      ""
    ].join("\n"))).toBe("Result text");
  });

  it("calls Exa with the expected request shape", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    const fetchImpl = (async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body));
      return new Response("data: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Search result\"}]}}\n\n", {
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    const result = await callExaWebSearch({
      query: "Recode",
      numResults: 8,
      livecrawl: "fallback",
      type: "auto"
    }, {
      fetchImpl,
      env: { RECODE_EXA_MCP_URL: "https://exa.test/mcp" },
      timeoutMs: 25
    });

    const body = capturedBody as {
      readonly method: string;
      readonly params: {
        readonly name: string;
        readonly arguments: {
          readonly query: string;
          readonly numResults: number;
          readonly livecrawl: string;
          readonly type: string;
        };
      };
    };

    expect(capturedUrl).toBe("https://exa.test/mcp?tools=web_search_exa");
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("web_search_exa");
    expect(body.params.arguments).toEqual({
      query: "Recode",
      numResults: 8,
      livecrawl: "fallback",
      type: "auto"
    });
    expect(result).toBe("Search result");
  });

  it("times out slow Exa responses", async () => {
    const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })) as typeof fetch;

    await expect(callExaWebSearch({
      query: "slow",
      numResults: 8,
      livecrawl: "fallback",
      type: "auto"
    }, {
      fetchImpl,
      env: { RECODE_EXA_MCP_URL: "https://exa.test/mcp" },
      timeoutMs: 1
    })).rejects.toThrow("timed out");
  });
});

describe("WebSearch tool", () => {
  it("uses Exa defaults and returns the first text result", async () => {
    let capturedBody: unknown;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response("data: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Default result\"}]}}\n\n", {
        headers: { "content-type": "text/event-stream" }
      });
    }) as unknown as typeof fetch;

    const tool = createWebSearchTool();
    const result = await tool.execute({
      query: "new ai model"
    }, {
      workspaceRoot: "/workspace"
    });

    const body = capturedBody as {
      readonly params: {
        readonly arguments: {
          readonly query: string;
          readonly numResults: number;
          readonly livecrawl: string;
          readonly type: string;
        };
      };
    };

    expect(body.params.arguments).toEqual({
      query: "new ai model",
      numResults: 8,
      livecrawl: "fallback",
      type: "auto"
    });
    expect(result.content).toBe("Default result");
  });

  it("returns a clear fallback for empty results", async () => {
    globalThis.fetch = (async () => new Response("data: {\"result\":{\"content\":[]}}\n\n", {
      headers: { "content-type": "text/event-stream" }
    })) as unknown as typeof fetch;

    const tool = createWebSearchTool();
    const result = await tool.execute({
      query: "unlikely result"
    }, {
      workspaceRoot: "/workspace"
    });

    expect(result.content).toContain("No search results");
  });

  it("surfaces readable Exa errors", async () => {
    globalThis.fetch = (async () => new Response("{\"error\":{\"message\":\"bad key\"}}", {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;

    const tool = createWebSearchTool();

    await expect(tool.execute({
      query: "anything"
    }, {
      workspaceRoot: "/workspace"
    })).rejects.toThrow("HTTP 401 Unauthorized");
  });
});
