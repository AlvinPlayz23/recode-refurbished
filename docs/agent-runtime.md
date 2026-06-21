# Agent Runtime

The agent runtime is the core of Recode. The TUI, one-shot CLI, ACP server, and desktop app all eventually call the same loop.

## Loop Overview

```text
user prompt
  -> append user message to transcript
  -> stream one assistant step
  -> collect assistant text, reasoning, and tool calls
  -> append assistant message
  -> execute requested tools
  -> append tool result messages
  -> repeat until there are no tool calls
```

The public entrypoint is `runAgentLoop()` in `src/agent/run-agent-loop.ts`.

## Step Processing

One assistant step is handled by `processAgentSessionStep()` in `src/agent/session-processor.ts`:

- sends the system prompt, transcript, tools, and model config to the active provider;
- streams text deltas;
- streams reasoning deltas separately when providers support them;
- collects tool calls;
- records finish reason, duration, token usage, and cost metadata when available;
- emits session events for frontends and ACP clients.

## Tool Execution

Tool execution is handled by `executeAgentSessionToolCalls()`:

- `Bash` and `AskUserQuestion` are sequential.
- File mutation tools (`Write`, `Edit`, `ApplyPatch`) use a file mutation queue keyed by path where possible.
- Other tools can run in parallel, with a default parallel limit.
- When `Task` is present, the task-specific concurrency limit is used.

Tool results are appended to the transcript and then sent back to the model on the next loop iteration.

## AskUserQuestion Follow-up

`AskUserQuestion` is special. A successful question result is converted into a synthetic user message summarizing the user's selected answers. This lets the model continue as if the user had answered directly in the conversation.

## Doom-loop Guard

The runtime tracks repeated identical tool-call batches. If the same batch repeats too many times, Recode throws a doom-loop error instead of letting the model keep calling the same tools indefinitely.

## Aborts

Abort signals are checked before and after model/tool phases. Ctrl+C and ACP cancellation both flow through abort/cancel handling so the runtime can stop active work and return an aborted state where possible.

## Session Events

The runtime emits session events such as:

- user submitted
- assistant step started/finished
- assistant text delta
- assistant reasoning delta
- provider retry
- tool started/completed/errored
- tool metadata updated

These events are mapped by different surfaces:

- TUI: transcript entries, spinners, tool rows, approval popups.
- ACP: `session/update` notifications and client requests.
- Desktop: `DesktopMessage` and thread status updates.

## Transcript Model

The transcript stores user, assistant, tool, and summary messages. Assistant messages can carry tool calls, provider reasoning metadata, and per-step stats. Tool messages carry tool call IDs, result text, error state, and structured metadata for richer UI rendering.
