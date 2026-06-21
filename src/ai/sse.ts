/**
 * Shared SSE decoding helpers.
 */

/**
 * A single parsed SSE event.
 */
export interface ServerSentEvent {
  readonly event: string | undefined;
  readonly data: string;
}

/**
 * Optional hooks for stream diagnostics.
 */
export interface SseIterationOptions {
  readonly onChunk?: () => void;
}

interface SseState {
  event: string | undefined;
  data: string[];
}

/**
 * Iterate over parsed SSE events from a response body.
 */
export async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
  options: SseIterationOptions = {}
): AsyncGenerator<ServerSentEvent> {
  const chunks = body as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";
  const state: SseState = { event: undefined, data: [] };

  try {
    for await (const chunk of chunks) {
      if (abortSignal?.aborted ?? false) {
        return;
      }

      options.onChunk?.();
      buffer += decoder.decode(chunk, { stream: true });
      const consumed = consumeBuffer(buffer, state, false);

      buffer = consumed.rest;
      for (const event of consumed.events) {
        yield event;
      }
    }

    if (buffer !== "") {
      const consumed = consumeBuffer(buffer, state, true);
      for (const event of consumed.events) {
        yield event;
      }
    } else {
      const finalEvent = flushEvent(state);
      if (finalEvent !== undefined) {
        yield finalEvent;
      }
    }
  } finally {
    buffer = "";
  }
}

interface ConsumedBuffer {
  readonly events: readonly ServerSentEvent[];
  readonly rest: string;
}

function consumeBuffer(buffer: string, state: SseState, flushRemainder: boolean): ConsumedBuffer {
  const events: ServerSentEvent[] = [];
  let rest = buffer;

  while (true) {
    const lineBreakIndex = findLineBreakIndex(rest);

    if (lineBreakIndex === -1) {
      if (flushRemainder && rest !== "") {
        handleLine(rest, state, events);
        rest = "";
      }
      break;
    }

    const line = rest.slice(0, lineBreakIndex);
    const separatorLength = rest[lineBreakIndex] === "\r" && rest[lineBreakIndex + 1] === "\n" ? 2 : 1;
    rest = rest.slice(lineBreakIndex + separatorLength);
    handleLine(line, state, events);
  }

  if (flushRemainder) {
    const finalEvent = flushEvent(state);
    if (finalEvent !== undefined) {
      events.push(finalEvent);
    }
  }

  return { events, rest };
}

function findLineBreakIndex(text: string): number {
  const carriageReturnIndex = text.indexOf("\r");
  const newlineIndex = text.indexOf("\n");

  if (carriageReturnIndex === -1) {
    return newlineIndex;
  }

  if (newlineIndex === -1) {
    return carriageReturnIndex;
  }

  return Math.min(carriageReturnIndex, newlineIndex);
}

function handleLine(line: string, state: SseState, events: ServerSentEvent[]): void {
  if (line === "") {
    const event = flushEvent(state);
    if (event !== undefined) {
      events.push(event);
    }
    return;
  }

  if (line.startsWith(":")) {
    return;
  }

  const separatorIndex = line.indexOf(":");
  const fieldName = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
  let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);

  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  switch (fieldName) {
    case "event":
      state.event = value;
      break;
    case "data":
      state.data.push(value);
      break;
  }
}

function flushEvent(state: SseState): ServerSentEvent | undefined {
  if (state.event === undefined && state.data.length === 0) {
    return undefined;
  }

  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join("\n")
  };

  state.event = undefined;
  state.data = [];
  return event;
}
