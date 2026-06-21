/**
 * Minimal JSON-RPC 2.0 helpers for the ACP broker.
 */

import { isRecord } from "../shared/is-record.ts";

/** JSON-RPC request identifier. */
export type JsonRpcId = string | number | null;

/** JSON object used for JSON-RPC params and results. */
export interface JsonRpcObject {
  readonly [key: string]: unknown;
}

/** JSON-RPC request or notification. */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** JSON-RPC response. */
export type JsonRpcResponse =
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly result: unknown;
    }
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly error: JsonRpcError;
    };

/** JSON-RPC error object. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Return true when a parsed JSON value is a JSON-RPC response. */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value)
    && value["jsonrpc"] === "2.0"
    && ("id" in value)
    && (("result" in value) || ("error" in value));
}

/** Parse one JSON-RPC request object. */
export function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!isRecord(value) || value["jsonrpc"] !== "2.0" || typeof value["method"] !== "string") {
    throw new Error("Invalid JSON-RPC request.");
  }

  const id = value["id"];
  if (id !== undefined && typeof id !== "string" && typeof id !== "number" && id !== null) {
    throw new Error("Invalid JSON-RPC request id.");
  }

  return {
    jsonrpc: "2.0",
    method: value["method"],
    ...(id === undefined ? {} : { id }),
    ...(!("params" in value) ? {} : { params: value["params"] })
  };
}

/** Build a successful JSON-RPC response. */
export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

/** Build a JSON-RPC error response. */
export function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

/** Convert an unknown thrown value into a message. */
export function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
