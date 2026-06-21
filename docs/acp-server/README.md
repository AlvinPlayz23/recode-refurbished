# Recode ACP Server

The Recode ACP server is a local JSON-RPC broker that lets external clients drive Recode sessions without embedding the TUI. It is intended for desktop apps, editors, IDE integrations, and automation clients that need multiple Recode sessions across multiple workspace folders.

The server speaks ACP-style messages over stdio, WebSocket, and streamable HTTP/SSE. Remote transports are local-first and protected with a bearer token.

## Starting The Server

```bash
recode acp-server
```

For editor subprocess clients that expect ACP stdio:

```bash
recode acp-server --stdio
```

Useful options:

```bash
recode acp-server --host 127.0.0.1 --port 8765 --token dev-token
```

Defaults:

| Option | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface to bind. Keep localhost for normal desktop usage. |
| `--port` | `0` | Use an available random port. |
| `--token` | generated UUID | Bearer token required by clients. |
| `--provider` | config default | Optional provider override for sessions. |
| `--model` | provider default | Optional model override for sessions. |
| `--approval-mode` | config default | Optional approval mode override for sessions. |
| `--stdio` | disabled | Use newline-delimited JSON-RPC over stdin/stdout instead of starting HTTP/WebSocket. |

On startup the server writes connection metadata to stderr:

```json
{
  "event": "recode.acp_server.started",
  "url": "ws://127.0.0.1:8765/acp",
  "token": "dev-token",
  "protocolVersion": 2
}
```

## Transport

### stdio

With `--stdio`, the client launches Recode as a subprocess. Recode reads newline-delimited UTF-8 JSON-RPC messages from stdin and writes newline-delimited JSON-RPC messages to stdout. Messages must be one JSON-RPC object per line and must not contain embedded newlines. Logs and diagnostics may go to stderr; stdout is reserved for ACP messages.

Stdio does not use bearer auth, host, port, `Acp-Connection-Id`, or `Acp-Session-Id`. The client must still send `initialize` first.

### HTTP/WebSocket

Endpoint:

```text
/acp
```

Every request must include:

```text
Authorization: Bearer <token>
```

Supported transports:

| Route | Purpose |
| --- | --- |
| `stdio` with `--stdio` | Newline-delimited JSON-RPC over stdin/stdout. |
| `GET /acp` with `Upgrade: websocket` | Bidirectional JSON-RPC text frames. |
| `POST /acp` | Streamable HTTP client-to-server JSON-RPC requests and client responses. |
| `GET /acp` with `Accept: text/event-stream` | SSE server-to-client JSON-RPC messages. |
| `DELETE /acp` | Close a streamable HTTP connection. |

Streamable HTTP uses `Acp-Connection-Id`. The first `POST /acp` must be `initialize`; the response includes the connection id header. Later `POST`, `GET` SSE, and `DELETE` requests must send that same header.

Session-scoped HTTP requests, such as `session/prompt`, `session/cancel`, `session/set_config_option`, and client responses to session-scoped server requests, must include `Acp-Session-Id` matching `params.sessionId`. A connection-level SSE stream receives connection-level messages, such as `session/new` responses. A session-level SSE stream receives that session's updates, server-to-client requests, and request responses.

## Connection Flow

1. Client starts `recode acp-server --stdio`, connects with WebSocket, or sends HTTP `initialize`.
2. Client sends `initialize`.
3. Client creates or loads sessions with `session/new`, `session/load`, or `session/resume`.
4. Client sends prompts with `session/prompt`.
5. Server streams `session/update` notifications.
6. Client answers server-to-client requests such as tool approvals and Recode questions.

Minimal initialize request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 2,
    "clientCapabilities": {},
    "clientInfo": {
      "name": "my-client",
      "title": "My Client",
      "version": "0.1.0"
    }
  }
}
```

Initialize response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 2,
    "agentInfo": {
      "name": "recode",
      "title": "Recode",
      "version": "0.1.0"
    },
    "authMethods": [],
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "embeddedContext": true
      },
      "sessionCapabilities": {
        "list": {},
        "resume": {},
        "close": {}
      }
    }
  }
}
```

## Agent Methods

### `initialize`

Negotiates the ACP connection. This must be the first client request.

### `authenticate`

Currently returns `{}`. HTTP/WebSocket bearer auth happens before JSON-RPC messages are accepted.

### `session/new`

Creates a new Recode session for an absolute workspace path.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "C:\\Users\\bijim\\project"
  }
}
```

Response includes:

| Field | Meaning |
| --- | --- |
| `sessionId` | Recode conversation/session ID. |
| `configOptions` | Current mode/model selectors. |
| `modes` | Compatibility mode state for build/plan. |
| `models` | Compatibility model state. |

### `session/list`

Lists saved Recode conversations. Optional `cwd` filters by workspace. Optional `cursor` paginates results.

### `session/load`

Loads a saved session and replays its transcript through `session/update` notifications before returning.

### `session/resume`

Loads a saved session without replaying transcript history.

### `session/prompt`

Accepts one Recode prompt turn and returns immediately.

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/prompt",
  "params": {
    "sessionId": "session-id",
    "prompt": [
      {
        "type": "text",
        "text": "Inspect this project and summarize the architecture."
      }
    ]
  }
}
```

Prompt response:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "messageId": "accepted-user-message-id"
  }
}
```

The actual turn lifecycle is streamed through `session/update`:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "session-id",
    "update": {
      "sessionUpdate": "state_change",
      "state": "idle",
      "stopReason": "end_turn"
    }
  }
}
```

Supported prompt content:

| Type | Support |
| --- | --- |
| `text` | Supported. |
| `resource` | Supported for embedded text resources. Blob resources are accepted as references only. |
| `resource_link` | Supported as a textual reference. |
| `image` | Not advertised. |
| `audio` | Not advertised. |

### `session/cancel`

Cancels an active prompt turn for a session. Completion is reported with `state_change` and `stopReason: "cancelled"`.

### `session/close`

Cancels active work and removes the session from the broker's in-memory session map.

### `session/set_config_option`

Updates session-level configuration. This is the preferred API for mode and model changes.

Switch to plan mode:

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "session-id",
    "configId": "mode",
    "value": "plan"
  }
}
```

Switch model:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "session-id",
    "configId": "model",
    "value": "openai-main/gpt-4.1"
  }
}
```

Model values use:

```text
<providerId>/<modelId>
```

### `session/set_mode`

Compatibility method for mode changes. Supported values are `build` and `plan`.

### `session/set_model`

Compatibility method for model changes. Prefer `session/set_config_option` with `configId: "model"`.

## Session Config Options

Every new, loaded, or resumed session returns config options:

```json
[
  {
    "id": "mode",
    "name": "Mode",
    "category": "mode",
    "type": "select",
    "currentValue": "build",
    "options": [
      { "value": "build", "name": "Build" },
      { "value": "plan", "name": "Plan" }
    ]
  },
  {
    "id": "model",
    "name": "Model",
    "category": "model",
    "type": "select",
    "currentValue": "openai-main/gpt-4.1",
    "options": []
  }
]
```

Mode behavior:

| Mode | Behavior |
| --- | --- |
| `build` | Uses the normal Recode system prompt and all configured tools. |
| `plan` | Uses Recode plan-mode prompt and filters tools to read-only/planning-safe tools. |

## Session Updates

The server sends ACP-style notifications:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "session-id",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "..."
      }
    }
  }
}
```

Current update types:

| Update | Meaning |
| --- | --- |
| `user_message` | User prompt was accepted into the session. |
| `user_message_chunk` | Replayed user text from saved history. |
| `agent_message_chunk` | Streaming assistant text. |
| `state_change` | Session is running, idle, or waiting for user action. |
| `tool_call` | Tool call was requested. |
| `tool_call_update` | Tool call progress or result. |
| `plan` | Todo/plan update, usually from `TodoWrite`. |
| `config_option_update` | Mode/model config changed. |
| `current_mode_update` | Compatibility mode update. |
| `session_info_update` | Session title or timestamp changed. |

Tool call updates include ACP tool kinds such as `read`, `edit`, `execute`, `search`, `fetch`, and `think`. Edit metadata is exposed as diff content where available.

## Tool Approval Requests

When Recode approval policy requires user approval, the server sends `state_change` with `requires_action`, then a JSON-RPC request to the client:

```json
{
  "jsonrpc": "2.0",
  "id": "approval-id",
  "method": "session/request_permission",
  "params": {
    "sessionId": "session-id",
    "toolCall": {
      "toolCallId": "tool-call-id",
      "title": "Bash: bun run test",
      "kind": "execute",
      "status": "pending"
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "allow-always", "name": "Allow always", "kind": "allow_always" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
    ]
  }
}
```

Client response:

```json
{
  "jsonrpc": "2.0",
  "id": "approval-id",
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

Supported option IDs:

| Option | Effect |
| --- | --- |
| `allow-once` | Run this tool call once. |
| `allow-always` | Run this tool call and add an in-memory allow rule for the session. |
| `reject-once` | Deny this tool call. |

If the client returns any other shape, Recode treats the request as denied.

## Recode Question Requests

The `AskUserQuestion` tool uses a Recode extension method:

```text
_recode/question
```

The server sends `state_change` with `requires_action`, then:

```json
{
  "jsonrpc": "2.0",
  "id": "question-id",
  "method": "_recode/question",
  "params": {
    "sessionId": "session-id",
    "questions": []
  }
}
```

Client response:

```json
{
  "jsonrpc": "2.0",
  "id": "question-id",
  "result": {
    "dismissed": false,
    "answers": [
      {
        "questionId": "scope",
        "selectedOptionLabels": ["Recommended"],
        "customText": ""
      }
    ]
  }
}
```

Return `{ "dismissed": true }` to cancel/dismiss the question prompt.

## Streamable HTTP Example

```ts
const baseUrl = "http://127.0.0.1:8765/acp";
const headers = {
  authorization: "Bearer dev-token",
  "content-type": "application/json"
};

const initialize = await fetch(baseUrl, {
  method: "POST",
  headers,
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

const connectionId = initialize.headers.get("Acp-Connection-Id");

const events = new EventSourcePolyfill(baseUrl, {
  headers: {
    authorization: "Bearer dev-token",
    "Acp-Connection-Id": connectionId
  }
});

await fetch(baseUrl, {
  method: "POST",
  headers: {
    ...headers,
    "Acp-Connection-Id": connectionId
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "session/new",
    params: {
      cwd: "C:\\Users\\bijim\\project"
    }
  })
});

const sessionId = "session-id-from-the-session-new-response";

const sessionEvents = new EventSourcePolyfill(baseUrl, {
  headers: {
    authorization: "Bearer dev-token",
    "Acp-Connection-Id": connectionId,
    "Acp-Session-Id": sessionId
  }
});

await fetch(baseUrl, {
  method: "POST",
  headers: {
    ...headers,
    "Acp-Connection-Id": connectionId,
    "Acp-Session-Id": sessionId
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [{ type: "text", text: "Summarize this workspace." }]
    }
  })
});
```

## WebSocket Client Skeleton

```ts
const ws = new WebSocket("ws://127.0.0.1:8765/acp", {
  headers: {
    authorization: "Bearer dev-token"
  }
});

const pending = new Map<number | string, (message: unknown) => void>();

ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));

  if ("id" in message && ("result" in message || "error" in message)) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }

  if (message.method === "session/update") {
    console.log("session update", message.params);
    return;
  }

  if (message.method === "session/request_permission") {
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "allow-once"
        }
      }
    }));
  }
});

let nextId = 1;

function request(method: string, params: unknown): Promise<unknown> {
  const id = nextId++;
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
```

## MCP Note

Recode does not currently implement MCP server integration. ACP schemas and some clients may include an `mcpServers` field in session parameters, but the Recode ACP server does not advertise MCP capability, does not connect to MCP servers, and does not require clients to send that field.

## Current Limits

- Client filesystem and terminal methods are not used by Recode tools yet; Recode tools execute through Recode's own local tool layer.
- Image and audio prompt content are not advertised.
- The server is local-first. Do not bind it to a LAN address without adding stronger auth and origin policy.
