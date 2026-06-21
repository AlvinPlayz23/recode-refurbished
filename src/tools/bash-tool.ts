/**
 * Bash tool implementation.
 *
 * @author dev
 */

import type { ToolArguments, ToolDefinition, ToolExecutionContext, ToolResult } from "./tool.ts";
import { resolveBashExecutionPolicy } from "./bash-execution-policy.ts";
import { readRequiredNonEmptyString } from "./tool-input.ts";

interface BashToolInput {
  readonly command: string;
}

const MAX_MODEL_OUTPUT_LENGTH = 12_000;
const MAX_TUI_OUTPUT_LENGTH = 6_000;
const MAX_CAPTURED_STREAM_LENGTH = MAX_MODEL_OUTPUT_LENGTH * 2;
const DEFAULT_BASH_TIMEOUT_MS = 30_000;

/**
 * Create the Bash tool definition.
 */
export function createBashTool(): ToolDefinition {
  return {
    name: "Bash",
    description: "Execute a shell command inside the current workspace. On Windows, Recode prefers Git Bash when available and falls back to PowerShell.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute. Prefer portable shell commands; if Windows falls back to PowerShell, use PowerShell-compatible syntax."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async execute(arguments_: ToolArguments, context: ToolExecutionContext): Promise<ToolResult> {
      const input = parseBashToolInput(arguments_);
      const executionPolicy = await resolveBashExecutionPolicy();

      const validationError = executionPolicy.validate(input.command, context.workspaceRoot);
      if (validationError !== null) {
        return { content: validationError, isError: true };
      }

      if (context.abortSignal?.aborted ?? false) {
        return { content: "Tool execution aborted by user.", isError: true };
      }

      const processAbortController = new AbortController();
      let timedOut = false;
      let aborted = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        processAbortController.abort();
      }, DEFAULT_BASH_TIMEOUT_MS);
      const abortHandler = () => {
        aborted = true;
        processAbortController.abort();
      };
      context.abortSignal?.addEventListener("abort", abortHandler, { once: true });

      const spawnOptions = {
        stdout: "pipe" as const,
        stderr: "pipe" as const,
        stdin: "ignore" as const,
        signal: processAbortController.signal,
        timeout: DEFAULT_BASH_TIMEOUT_MS,
        killSignal: "SIGKILL" as const
      };
      const proc = executionPolicy.spawn(input.command, context.workspaceRoot, spawnOptions);
      let liveOutput = "";
      const publishOutput = async (chunk: string) => {
        if (chunk === "") {
          return;
        }

        liveOutput = appendBoundedText(liveOutput, chunk, MAX_TUI_OUTPUT_LENGTH);
        await context.updateToolMetadata?.({
          title: input.command,
          content: liveOutput,
          metadata: {
            kind: "bash-output",
            command: input.command,
            output: liveOutput
          }
        });
      };

      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          streamToText(proc.stdout, publishOutput, MAX_CAPTURED_STREAM_LENGTH),
          streamToText(proc.stderr, publishOutput, MAX_CAPTURED_STREAM_LENGTH),
          proc.exited
        ]);

        const content = truncateText(formatProcessResult(stdout, stderr, exitCode, timedOut, aborted), MAX_MODEL_OUTPUT_LENGTH);
        const previewOutput = truncateText(content, MAX_TUI_OUTPUT_LENGTH);
        const finalMetadata = {
          kind: "bash-output" as const,
          command: input.command,
          output: previewOutput,
          ...(exitCode === null ? {} : { exitCode }),
          ...(timedOut ? { timedOut } : {}),
          ...(aborted ? { aborted } : {})
        };
        await context.updateToolMetadata?.({
          title: input.command,
          content,
          metadata: finalMetadata
        });

        return {
          content,
          isError: exitCode !== 0 || timedOut || aborted,
          metadata: finalMetadata
        };
      } finally {
        clearTimeout(timeoutHandle);
        context.abortSignal?.removeEventListener("abort", abortHandler);
        if (!proc.killed && (timedOut || aborted)) {
          proc.kill("SIGKILL");
        }
      }
    }
  };
}

function parseBashToolInput(arguments_: ToolArguments): BashToolInput {
  return {
    command: readRequiredNonEmptyString(
      arguments_,
      "command",
      "Bash tool requires a non-empty 'command' string."
    )
  };
}

async function streamToText(
  stream: ReadableStream<Uint8Array> | number | null,
  onChunk?: (chunk: string) => Promise<void>,
  maxLength = MAX_CAPTURED_STREAM_LENGTH
): Promise<string> {
  if (stream === null || typeof stream === "number") {
    return "";
  }

  const decoder = new TextDecoder();
  let output = "";
  const chunks = stream as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>;

  for await (const value of chunks) {
    const chunk = decoder.decode(value, { stream: true });
    output = appendBoundedText(output, chunk, maxLength);
    await onChunk?.(chunk);
  }

  const tail = decoder.decode();
  output = appendBoundedText(output, tail, maxLength);
  await onChunk?.(tail);
  return output;
}

function appendBoundedText(current: string, chunk: string, maxLength: number): string {
  const next = `${current}${chunk}`;
  if (next.length <= maxLength) {
    return next;
  }

  return `${next.slice(0, maxLength)}\n\n[truncated]`;
}

function formatProcessResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  timedOut: boolean,
  aborted: boolean
): string {
  const parts: string[] = [];

  if (aborted) {
    parts.push("aborted: true");
  }

  if (timedOut) {
    parts.push(`timeout_ms: ${DEFAULT_BASH_TIMEOUT_MS}`);
  }

  parts.push(`exit_code: ${exitCode === null ? "terminated" : String(exitCode)}`);

  if (stdout.trim() !== "") {
    parts.push(`stdout:\n${stdout}`);
  }

  if (stderr.trim() !== "") {
    parts.push(`stderr:\n${stderr}`);
  }

  return parts.join("\n\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[truncated]`;
}
