/**
 * Minimal newline-delimited JSON-RPC client for Recode ACP stdio servers.
 */

import { spawnRecodeAcpServer } from "./child-process.ts";

export interface JsonRpcObject {
  readonly [key: string]: unknown;
}

export interface JsonRpcRequest extends JsonRpcObject {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse extends JsonRpcObject {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface AcpJsonRpcClientOptions {
  cwd: string;
  runtimeMode?: "dev" | "prod";
  recodeRepoRoot?: string;
  onNotification: (request: JsonRpcRequest) => void;
  onClientRequest: (request: JsonRpcRequest, respond: (result: unknown) => void) => void;
  onExit: (exitCode: number | null) => void;
  onError: (message: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class AcpJsonRpcClient {
  readonly #process: Bun.Subprocess;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #options: AcpJsonRpcClientOptions;
  #nextId = 1;
  #closed = false;

  constructor(options: AcpJsonRpcClientOptions) {
    this.#options = options;
    this.#process = spawnRecodeAcpServer({
      cwd: options.cwd,
      runtimeMode: options.runtimeMode ?? "dev",
      recodeRepoRoot: options.recodeRepoRoot,
    });
    void this.#readStdout();
    void this.#readStderr();
    void this.#watchExit();
  }

  async initialize(): Promise<unknown> {
    return await this.request("initialize", {
      protocolVersion: 2,
      clientCapabilities: {},
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.#closed) {
      throw new Error("ACP client is closed.");
    }

    const id = this.#nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(String(id), { resolve, reject });
    });

    this.#write(message);
    return await promise;
  }

  notify(method: string, params?: unknown): void {
    if (this.#closed) {
      throw new Error("ACP client is closed.");
    }

    this.#write({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    } satisfies JsonRpcRequest);
  }

  respond(id: string | number, result: unknown): void {
    this.#write({
      jsonrpc: "2.0",
      id,
      result,
    } satisfies JsonRpcResponse);
  }

  close(): void {
    this.#closed = true;
    this.#process.kill();
  }

  async #readStdout(): Promise<void> {
    const stdout = this.#process.stdout;
    if (!(stdout instanceof ReadableStream)) return;

    const reader = stdout.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    while (!this.#closed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          this.#handleLine(line);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  }

  async #readStderr(): Promise<void> {
    const stderr = this.#process.stderr;
    if (!(stderr instanceof ReadableStream)) return;

    const reader = stderr.pipeThrough(new TextDecoderStream()).getReader();
    while (!this.#closed) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = value.trim();
      if (text.length > 0) {
        this.#options.onError(text);
      }
    }
  }

  async #watchExit(): Promise<void> {
    const exitCode = await this.#process.exited;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error(`ACP server exited with code ${exitCode}.`));
    }
    this.#pending.clear();
    this.#options.onExit(exitCode);
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#options.onError(`Invalid ACP JSON: ${line}`);
      return;
    }

    if (!isRecord(parsed)) {
      this.#options.onError(`Invalid ACP message: ${line}`);
      return;
    }

    if ("method" in parsed && typeof parsed.method === "string") {
      const request = parsed as JsonRpcRequest;
      if (request.id === undefined) {
        this.#options.onNotification(request);
        return;
      }
      this.#options.onClientRequest(request, (result) => this.respond(request.id as string | number, result));
      return;
    }

    if ("id" in parsed) {
      this.#handleResponse(parsed as JsonRpcResponse);
      return;
    }

    this.#options.onError(`Unhandled ACP message: ${line}`);
  }

  #handleResponse(response: JsonRpcResponse): void {
    const key = String(response.id);
    const pending = this.#pending.get(key);
    if (pending === undefined) return;
    this.#pending.delete(key);

    if (response.error !== undefined) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  #write(message: JsonRpcObject): void {
    const stdin = this.#process.stdin;
    if (stdin === undefined || typeof stdin === "number") {
      throw new Error("ACP process stdin is unavailable.");
    }
    stdin.write(`${JSON.stringify(message)}\n`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
