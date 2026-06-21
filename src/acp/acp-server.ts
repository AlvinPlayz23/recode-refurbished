/**
 * Local HTTP/WebSocket ACP broker.
 */

import type { Server } from "bun";
import { AcpSessionManager, type AcpRuntimeOverrides } from "./acp-session-manager.ts";
import {
  isJsonRpcResponse,
  jsonRpcError,
  jsonRpcResult,
  parseJsonRpcRequest,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  unknownErrorMessage
} from "./json-rpc.ts";

declare const RECODE_VERSION: string;

const ACP_PROTOCOL_VERSION = 2;

/** ACP server startup options. */
export interface AcpServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly overrides?: AcpRuntimeOverrides;
}

/** ACP stdio startup options. */
export interface AcpStdioServerOptions {
  readonly overrides?: AcpRuntimeOverrides;
}

/** ACP NDJSON transport options. */
export interface AcpNdjsonTransportOptions {
  readonly input: AsyncIterable<string | Buffer | Uint8Array>;
  readonly write: (chunk: string) => void | Promise<void>;
  readonly overrides?: AcpRuntimeOverrides;
}

/** Started ACP server metadata. */
export interface StartedAcpServer {
  readonly server: Server<AcpSocketData>;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly url: string;
}

interface AcpSocketData {
  connection: AcpConnection | undefined;
}

interface PendingClientRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/** Start the ACP broker and keep the process alive. */
export async function runAcpServer(options: AcpServerOptions): Promise<never> {
  const started = startAcpServer(options);
  console.error(JSON.stringify({
    event: "recode.acp_server.started",
    url: started.url,
    token: started.token,
    protocolVersion: ACP_PROTOCOL_VERSION
  }));

  return await new Promise<never>(() => {});
}

/** Run ACP over stdio using newline-delimited JSON-RPC messages. */
export async function runAcpStdioServer(options: AcpStdioServerOptions): Promise<void> {
  await runAcpNdjsonTransport({
    input: process.stdin,
    write(chunk) {
      process.stdout.write(chunk);
    },
    ...(options.overrides === undefined ? {} : { overrides: options.overrides })
  });
}

/** Run one ACP connection over an NDJSON stream. Exported for transport tests. */
export async function runAcpNdjsonTransport(options: AcpNdjsonTransportOptions): Promise<void> {
  const connection = new AcpConnection(async (message) => {
    await options.write(`${message}\n`);
  }, options.overrides ?? {});
  let buffer = "";

  try {
    for await (const chunk of options.input) {
      buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") {
          await connection.handleTextMessage(line);
        }
      }
    }

    if (buffer.trim() !== "") {
      await connection.handleTextMessage(buffer);
    }
  } finally {
    connection.close();
  }
}

/** Start the ACP broker. Exported for integration tests. */
export function startAcpServer(options: AcpServerOptions): StartedAcpServer {
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? crypto.randomUUID();
  const overrides = options.overrides ?? {};
  const httpConnections = new Map<string, HttpAcpConnection>();

  const server = Bun.serve<AcpSocketData>({
    hostname: host,
    port: options.port ?? 0,
    fetch(request, bunServer) {
      const url = new URL(request.url);
      if (url.pathname !== "/acp") {
        return new Response("Not found", { status: 404 });
      }

      if (!isAuthorized(request, token)) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET" && request.headers.get("upgrade") !== "websocket") {
        return openSseStream(request, httpConnections);
      }

      if (request.method === "POST") {
        return handleHttpPost(request, httpConnections, overrides);
      }

      if (request.method === "DELETE") {
        return handleHttpDelete(request, httpConnections);
      }

      if (bunServer.upgrade(request, { data: { connection: undefined } })) {
        return undefined;
      }

      return new Response(JSON.stringify({
        name: "recode-acp-server",
        protocolVersion: ACP_PROTOCOL_VERSION
      }), {
        headers: { "content-type": "application/json" }
      });
    },
    websocket: {
      open(ws) {
        ws.data.connection = new AcpConnection((message) => ws.send(message), overrides);
      },
      message(ws, message) {
        ws.data.connection?.handleMessage(message);
      },
      close(ws) {
        ws.data.connection?.close();
        ws.data.connection = undefined;
      }
    }
  });

  return {
    server,
    host,
    port: server.port ?? 0,
    token,
    url: `ws://${host}:${server.port ?? 0}/acp`
  };
}

class AcpConnection {
  readonly #sendRaw: (message: string, sessionId?: string) => void;
  readonly #pendingClientRequests = new Map<string, PendingClientRequest>();
  readonly #sessionManager: AcpSessionManager;
  #initialized = false;

  constructor(sendRaw: (message: string, sessionId?: string) => void, overrides: AcpRuntimeOverrides) {
    this.#sendRaw = sendRaw;
    this.#sessionManager = new AcpSessionManager({
      overrides,
      transport: {
        sendSessionUpdate: (notification) => {
          this.#send({
            jsonrpc: "2.0",
            method: "session/update",
            params: notification
          }, notification.sessionId);
        },
        requestClient: async (request) => await this.#requestClient(request)
      }
    });
  }

  handleMessage(message: string | Buffer): void {
    void this.handleTextMessage(message);
  }

  async handleTextMessage(message: string | Buffer): Promise<void> {
    const text = typeof message === "string" ? message : message.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.#send(jsonRpcError(null, -32700, "Parse error"));
      return;
    }

    await this.handleParsedMessage(parsed);
  }

  async handleParsedMessage(parsed: unknown): Promise<JsonRpcResponse | undefined> {
    if (isJsonRpcResponse(parsed)) {
      this.#handleClientResponse(parsed);
      return undefined;
    }

    try {
      return await this.handleRequest(parseJsonRpcRequest(parsed));
    } catch (error) {
      const response = jsonRpcError(null, -32600, unknownErrorMessage(error));
      this.#send(response);
      return response;
    }
  }

  close(): void {
    for (const pending of this.#pendingClientRequests.values()) {
      pending.reject(new Error("ACP client disconnected."));
    }
    this.#pendingClientRequests.clear();
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const requestSessionId = readSessionIdFromRpcMessage(request);
    try {
      if (!this.#initialized && request.method !== "initialize") {
        throw new Error("ACP connection must be initialized first.");
      }

      const result = await this.#dispatch(request);
      if (request.id !== undefined) {
        const response = jsonRpcResult(request.id, result);
        this.#send(response, requestSessionId);
        return response;
      }
    } catch (error) {
      if (request.id !== undefined) {
        const response = jsonRpcError(request.id, -32000, unknownErrorMessage(error));
        this.#send(response, requestSessionId);
        return response;
      }
    }

    return undefined;
  }

  async #dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize":
        this.#initialized = true;
        return {
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: {
            name: "recode",
            title: "Recode",
            version: typeof RECODE_VERSION === "undefined" ? "0.1.0" : RECODE_VERSION
          },
          authMethods: [],
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
        };
      case "authenticate":
        return {};
      case "session/new":
        return this.#sessionManager.newSession(request.params);
      case "session/load":
        return this.#sessionManager.loadSession(request.params);
      case "session/resume":
        return this.#sessionManager.resumeSession(request.params);
      case "session/list":
        return this.#sessionManager.listSessions(request.params);
      case "session/prompt":
        return this.#sessionManager.prompt(request.params);
      case "session/cancel":
        this.#sessionManager.cancel(request.params);
        return {};
      case "session/close":
        return this.#sessionManager.closeSession(request.params);
      case "session/set_mode":
        return this.#sessionManager.setMode(request.params);
      case "session/set_config_option":
        return this.#sessionManager.setConfigOption(request.params);
      case "session/set_model":
        return this.#sessionManager.setModel(request.params);
      default:
        throw new Error(`Unsupported ACP method: ${request.method}`);
    }
  }

  #requestClient(request: JsonRpcRequest): Promise<unknown> {
    const id = request.id ?? crypto.randomUUID();
    const outbound: JsonRpcRequest = {
      ...request,
      id
    };
    const key = idToKey(id);
    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pendingClientRequests.set(key, { resolve, reject });
    });
    this.#send(outbound, readSessionIdFromRpcMessage(outbound));
    return promise;
  }

  #handleClientResponse(response: JsonRpcResponse): void {
    const pending = this.#pendingClientRequests.get(idToKey(response.id));
    if (pending === undefined) {
      return;
    }

    this.#pendingClientRequests.delete(idToKey(response.id));
    if ("error" in response) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  #send(message: JsonRpcRequest | JsonRpcResponse, sessionId?: string): void {
    this.#sendRaw(JSON.stringify(message), sessionId);
  }
}

class HttpAcpConnection {
  readonly connectionId = crypto.randomUUID();
  readonly connection: AcpConnection;
  readonly #connectionStreams = new Set<ReadableStreamDefaultController<string>>();
  readonly #sessionStreams = new Map<string, Set<ReadableStreamDefaultController<string>>>();
  readonly #backlog: string[] = [];
  readonly #sessionBacklogs = new Map<string, string[]>();

  constructor(overrides: AcpRuntimeOverrides) {
    this.connection = new AcpConnection((message, sessionId) => this.send(message, sessionId), overrides);
  }

  addStream(sessionId: string | undefined, controller: ReadableStreamDefaultController<string>): void {
    if (sessionId === undefined) {
      this.#connectionStreams.add(controller);
      for (const message of this.#backlog) {
        controller.enqueue(toSseEvent(message));
      }
      return;
    }

    const streams = this.#sessionStreams.get(sessionId) ?? new Set<ReadableStreamDefaultController<string>>();
    streams.add(controller);
    this.#sessionStreams.set(sessionId, streams);
    for (const message of this.#sessionBacklogs.get(sessionId) ?? []) {
      controller.enqueue(toSseEvent(message));
    }
  }

  removeStream(sessionId: string | undefined, controller: ReadableStreamDefaultController<string>): void {
    if (sessionId === undefined) {
      this.#connectionStreams.delete(controller);
      return;
    }

    const streams = this.#sessionStreams.get(sessionId);
    streams?.delete(controller);
    if (streams?.size === 0) {
      this.#sessionStreams.delete(sessionId);
    }
  }

  close(): void {
    this.connection.close();
    for (const controller of this.#connectionStreams) {
      controller.close();
    }
    for (const streams of this.#sessionStreams.values()) {
      for (const controller of streams) {
        controller.close();
      }
    }
    this.#connectionStreams.clear();
    this.#sessionStreams.clear();
    this.#sessionBacklogs.clear();
  }

  clearBacklog(): void {
    this.#backlog.length = 0;
  }

  private send(message: string, routeSessionId?: string): void {
    const sessionId = routeSessionId ?? readSessionIdFromWireMessage(message);
    if (sessionId !== undefined) {
      const streams = this.#sessionStreams.get(sessionId);
      if (streams === undefined || streams.size === 0) {
        const backlog = this.#sessionBacklogs.get(sessionId) ?? [];
        backlog.push(message);
        if (backlog.length > 100) {
          backlog.shift();
        }
        this.#sessionBacklogs.set(sessionId, backlog);
      } else {
        for (const controller of streams) {
          controller.enqueue(toSseEvent(message));
        }
      }
      return;
    }

    if (this.#connectionStreams.size === 0) {
      this.#backlog.push(message);
      if (this.#backlog.length > 100) {
        this.#backlog.shift();
      }
    }

    for (const controller of this.#connectionStreams) {
      controller.enqueue(toSseEvent(message));
    }
  }
}

function isAuthorized(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${token}`;
}

async function handleHttpPost(
  request: Request,
  connections: Map<string, HttpAcpConnection>,
  overrides: AcpRuntimeOverrides
): Promise<Response> {
  let value: unknown;
  try {
    value = await readJsonRequest(request);
  } catch (error) {
    return new Response(JSON.stringify(jsonRpcError(null, -32600, unknownErrorMessage(error))), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  if (isJsonRpcResponse(value)) {
    const connection = findHttpConnectionResponse(request, connections);
    if (connection instanceof Response) {
      return connection;
    }
    void connection.connection.handleParsedMessage(value);
    return new Response(null, { status: 202 });
  }

  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = parseJsonRpcRequest(value);
  } catch (error) {
    return new Response(JSON.stringify(jsonRpcError(null, -32600, unknownErrorMessage(error))), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  if (rpcRequest.method === "initialize" && request.headers.get("Acp-Connection-Id") === null) {
    const connection = new HttpAcpConnection(overrides);
    connections.set(connection.connectionId, connection);
    const response = await connection.connection.handleRequest(rpcRequest);
    connection.clearBacklog();
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Acp-Connection-Id": connection.connectionId
      }
    });
  }

  const connection = findHttpConnectionResponse(request, connections);
  if (connection instanceof Response) {
    return connection;
  }
  const sessionValidation = validateHttpRequestSessionHeader(request, rpcRequest);
  if (sessionValidation instanceof Response) {
    return sessionValidation;
  }

  void connection.connection.handleParsedMessage(value);
  return new Response(null, { status: 202 });
}

function openSseStream(request: Request, connections: Map<string, HttpAcpConnection>): Response {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    return new Response("ACP HTTP stream requires Accept: text/event-stream", { status: 406 });
  }

  const connection = findHttpConnectionResponse(request, connections);
  if (connection instanceof Response) {
    return connection;
  }

  const sessionId = request.headers.get("Acp-Session-Id") ?? undefined;
  let streamController: ReadableStreamDefaultController<string> | undefined;

  const stream = new ReadableStream<string>({
    start(controller) {
      streamController = controller;
      connection.addStream(sessionId, controller);
      controller.enqueue(": connected\n\n");
    },
    cancel() {
      if (streamController !== undefined) {
        connection.removeStream(sessionId, streamController);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    }
  });
}

function handleHttpDelete(request: Request, connections: Map<string, HttpAcpConnection>): Response {
  const connectionId = request.headers.get("Acp-Connection-Id");
  if (connectionId === null) {
    return new Response("Missing Acp-Connection-Id", { status: 400 });
  }

  connections.get(connectionId)?.close();
  connections.delete(connectionId);
  return new Response(null, { status: 202 });
}

function findHttpConnectionResponse(
  request: Request,
  connections: Map<string, HttpAcpConnection>
): HttpAcpConnection | Response {
  try {
    return findHttpConnection(request, connections);
  } catch (error) {
    return new Response(unknownErrorMessage(error), { status: 400 });
  }
}

function findHttpConnection(request: Request, connections: Map<string, HttpAcpConnection>): HttpAcpConnection {
  const connectionId = request.headers.get("Acp-Connection-Id");
  if (connectionId === null) {
    throw new Error("Missing Acp-Connection-Id");
  }

  const connection = connections.get(connectionId);
  if (connection === undefined) {
    throw new Error(`Unknown Acp-Connection-Id: ${connectionId}`);
  }

  return connection;
}

async function readJsonRequest(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new Error("ACP HTTP POST requires application/json.");
  }

  return await request.json() as unknown;
}

function toSseEvent(message: string): string {
  return `data: ${message}\n\n`;
}

function readSessionIdFromWireMessage(message: string): string | undefined {
  try {
    return readSessionIdFromRpcMessage(JSON.parse(message) as unknown);
  } catch {
    return undefined;
  }
}

function readSessionIdFromRpcMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("params" in value)) {
    return undefined;
  }

  const params = (value as { readonly params?: unknown }).params;
  return typeof params === "object"
    && params !== null
    && "sessionId" in params
    && typeof (params as { readonly sessionId?: unknown }).sessionId === "string"
    ? (params as { readonly sessionId: string }).sessionId
    : undefined;
}

function validateHttpRequestSessionHeader(request: Request, rpcRequest: JsonRpcRequest): Response | undefined {
  const requestSessionId = readSessionIdFromRpcMessage(rpcRequest);
  if (requestSessionId === undefined) {
    return undefined;
  }

  const headerSessionId = request.headers.get("Acp-Session-Id");
  if (headerSessionId === null) {
    return new Response("Missing Acp-Session-Id", { status: 400 });
  }

  return headerSessionId === requestSessionId
    ? undefined
    : new Response("Acp-Session-Id does not match JSON-RPC params.sessionId", { status: 400 });
}

function idToKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}
