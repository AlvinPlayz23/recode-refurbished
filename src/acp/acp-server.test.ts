/**
 * Tests for the ACP HTTP/WebSocket broker.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { runAcpNdjsonTransport, startAcpServer, type StartedAcpServer } from "./acp-server.ts";
import type { JsonRpcResponse } from "./json-rpc.ts";

let startedServer: StartedAcpServer | undefined;

afterEach(() => {
  startedServer?.server.stop(true);
  startedServer = undefined;
});

describe("startAcpServer", () => {
  test("rejects unauthenticated HTTP requests", async () => {
    startedServer = startAcpServer({ token: "secret" });

    const response = await fetch(`http://${startedServer.host}:${startedServer.port}/acp`);

    expect(response.status).toBe(401);
  });

  test("serves initialize over an authorized WebSocket", async () => {
    startedServer = startAcpServer({ token: "secret" });
    const socket = new WebSocket(startedServer.url, {
      headers: {
        authorization: "Bearer secret"
      }
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 2,
        clientCapabilities: {}
      }
    }));

    const message = await waitForMessage(socket);
    socket.close();
    const response = JSON.parse(message) as JsonRpcResponse;

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 2,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            embeddedContext: true
          },
          sessionCapabilities: {
            list: {},
            resume: {},
            close: {}
          }
        }
      }
    });
  });

  test("serves initialize over streamable HTTP", async () => {
    startedServer = startAcpServer({ token: "secret" });

    const response = await fetch(`http://${startedServer.host}:${startedServer.port}/acp`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          clientCapabilities: {}
        }
      })
    });

    const payload = await response.json() as JsonRpcResponse;

    expect(response.status).toBe(200);
    expect(typeof response.headers.get("Acp-Connection-Id")).toBe("string");
    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 2
      }
    });
  });

  test("streams HTTP JSON-RPC responses over SSE", async () => {
    startedServer = startAcpServer({ token: "secret" });
    const baseUrl = `http://${startedServer.host}:${startedServer.port}/acp`;
    const initResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          clientCapabilities: {}
        }
      })
    });
    const connectionId = initResponse.headers.get("Acp-Connection-Id");
    expect(typeof connectionId).toBe("string");

    const streamAbort = new AbortController();
    const streamResponse = await fetch(baseUrl, {
      headers: {
        authorization: "Bearer secret",
        accept: "text/event-stream",
        "Acp-Connection-Id": connectionId ?? ""
      },
      signal: streamAbort.signal
    });
    expect(streamResponse.status).toBe(200);

    const postResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
        "Acp-Connection-Id": connectionId ?? ""
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "authenticate",
        params: {}
      })
    });
    expect(postResponse.status).toBe(202);

    const message = await readSseJson(streamResponse, 2, streamAbort);
    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {}
    });
  });

  test("routes session-scoped HTTP responses to the session SSE stream", async () => {
    startedServer = startAcpServer({ token: "secret" });
    const baseUrl = `http://${startedServer.host}:${startedServer.port}/acp`;
    const connectionId = await withTimeout(initializeHttpConnection(baseUrl), "initialize HTTP connection");
    const sessionId = "session-for-routing";

    const missingSessionHeader = await withTimeout(postRpc(baseUrl, connectionId, undefined, {
      jsonrpc: "2.0",
      id: 3,
      method: "session/set_config_option",
      params: {
        sessionId,
        configId: "mode",
        value: "plan"
      }
    }), "missing session header POST");
    expect(missingSessionHeader.status).toBe(400);

    const sessionAbort = new AbortController();
    const sessionStream = await withTimeout(fetch(baseUrl, {
      headers: {
        authorization: "Bearer secret",
        accept: "text/event-stream",
        "Acp-Connection-Id": connectionId,
        "Acp-Session-Id": sessionId
      },
      signal: sessionAbort.signal
    }), "session SSE open");
    expect(sessionStream.status).toBe(200);
    const sessionMessage = readSseJson(sessionStream, 4, sessionAbort);

    const accepted = await withTimeout(postRpc(baseUrl, connectionId, sessionId, {
      jsonrpc: "2.0",
      id: 4,
      method: "session/set_config_option",
      params: {
        sessionId,
        configId: "mode",
        value: "plan"
      }
    }), "session-scoped POST");
    expect(accepted.status).toBe(202);

    const sessionResponse = await sessionMessage;
    expect(sessionResponse).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      error: {
        message: "Unsupported ACP session: session-for-routing"
      }
    });
  });
});

describe("runAcpNdjsonTransport", () => {
  test("serves initialize over newline-delimited stdio messages", async () => {
    const written: string[] = [];

    await runAcpNdjsonTransport({
      input: lines([
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 2,
            clientCapabilities: {}
          }
        }) + "\n"
      ]),
      write(chunk) {
        written.push(chunk);
      }
    });

    expect(written).toHaveLength(1);
    expect(written[0]?.endsWith("\n")).toBe(true);
    expect(JSON.parse(written[0] ?? "")).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 2
      }
    });
  });

  test("emits JSON-RPC parse errors over newline-delimited stdio", async () => {
    const written: string[] = [];

    await runAcpNdjsonTransport({
      input: lines(["not-json\n"]),
      write(chunk) {
        written.push(chunk);
      }
    });

    expect(JSON.parse(written[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error"
      }
    });
  });
});

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open.")), { once: true });
  });
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      resolve(String(event.data));
    }, { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed while waiting for a message.")), { once: true });
  });
}

async function readSseJson(response: Response, id: number, abort: AbortController): Promise<JsonRpcResponse> {
  const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
  if (body === null) {
    throw new Error("SSE response did not include a body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const line = event.split("\n").find((item) => item.startsWith("data: "));
        if (line === undefined) {
          continue;
        }

        const parsed = JSON.parse(line.slice("data: ".length)) as JsonRpcResponse;
        if (parsed.id === id) {
          return parsed;
        }
      }
    }

    throw new Error("SSE stream closed before the expected message arrived.");
  } finally {
    abort.abort();
  }
}

async function initializeHttpConnection(baseUrl: string): Promise<string> {
  const initResponse = await fetch(baseUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 2,
        clientCapabilities: {}
      }
    })
  });
  const connectionId = initResponse.headers.get("Acp-Connection-Id");
  if (connectionId === null) {
    throw new Error("Initialize did not return Acp-Connection-Id.");
  }

  return connectionId;
}

async function postRpc(
  baseUrl: string,
  connectionId: string,
  sessionId: string | undefined,
  message: unknown
): Promise<Response> {
  return await fetch(baseUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json",
      "Acp-Connection-Id": connectionId,
      ...(sessionId === undefined ? {} : { "Acp-Session-Id": sessionId })
    },
    body: JSON.stringify(message)
  });
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), 1_000);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function* lines(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
