/**
 * Shared provider HTTP transport with retries, timeouts, and timing.
 */

import type { AiModel } from "./types.ts";
import { readErrorMessage } from "./http.ts";
import {
  buildProviderTransportSettings,
  type ProviderTransportSettings
} from "./provider-request-options.ts";
import { createProviderTimingSpan, type ProviderTimingSpan } from "./provider-timing.ts";

/**
 * Successful provider response plus timing context for downstream streaming.
 */
export interface ProviderFetchResult {
  readonly response: Response;
  readonly timing: ProviderTimingSpan;
}

interface AttemptSignal {
  readonly signal: AbortSignal | undefined;
  cleanup(): void;
}

interface StreamReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}

/**
 * Fetch one provider request with pre-stream retry handling.
 */
export async function fetchProviderJson(
  options: {
    readonly model: AiModel;
    readonly url: string;
    readonly operation: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Record<string, unknown>;
    readonly abortSignal?: AbortSignal;
    readonly requestAffinityKey?: string;
  }
): Promise<ProviderFetchResult> {
  const timing = createProviderTimingSpan({
    model: options.model,
    operation: options.operation,
    ...(options.requestAffinityKey === undefined ? {} : { requestAffinityKey: options.requestAffinityKey })
  });
  const settings = buildProviderTransportSettings(options.model);
  const maxAttempts = Math.max(1, settings.maxRetries + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.abortSignal);
    const attemptStartedAt = performance.now();
    const attemptSignal = buildAttemptSignal(options.abortSignal, settings.timeoutMs);
    timing.mark("request-start", { attempt });

    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(options.body),
        ...(attemptSignal.signal === undefined ? {} : { signal: attemptSignal.signal })
      });
      attemptSignal.cleanup();

      timing.mark("response-headers", {
        attempt,
        status: response.status,
        durationMs: elapsedSince(attemptStartedAt)
      });

      if (response.ok) {
        return {
          response: wrapStreamChunkTimeout(response, settings, timing),
          timing
        };
      }

      const message = await readErrorMessage(response);
      lastError = new Error(message);
      if (!isRetryableStatus(response.status) || attempt >= maxAttempts) {
        timing.mark("request-error", { attempt, status: response.status, message });
        throw lastError;
      }

      await waitBeforeRetry(settings, attempt, timing, options.abortSignal, response.status, message);
    } catch (error) {
      attemptSignal.cleanup();
      if (options.abortSignal?.aborted ?? false) {
        timing.mark("request-abort", { attempt });
        throw error;
      }

      lastError = error;
      if (!isRetryableFetchError(error) || attempt >= maxAttempts) {
        timing.mark("request-error", { attempt, message: describeError(error) });
        throw error;
      }

      await waitBeforeRetry(settings, attempt, timing, options.abortSignal, undefined, describeError(error));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildAttemptSignal(
  abortSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): AttemptSignal {
  if (abortSignal === undefined && timeoutMs === undefined) {
    return {
      signal: undefined,
      cleanup() {
        return;
      }
    };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    controller.abort();
  };

  if (abortSignal?.aborted ?? false) {
    controller.abort();
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      controller.abort(new DOMException("Provider request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      abortSignal?.removeEventListener("abort", onAbort);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };
}

function wrapStreamChunkTimeout(
  response: Response,
  settings: ProviderTransportSettings,
  timing: ProviderTimingSpan
): Response {
  if (settings.chunkTimeoutMs === undefined || response.body === null) {
    return response;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return response;
  }

  const reader = (response.body as unknown as { getReader(): StreamReader }).getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await readChunkWithTimeout(reader, settings.chunkTimeoutMs ?? 0, timing);
      if (chunk.done) {
        controller.close();
        return;
      }

      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText
  });
}

async function readChunkWithTimeout(
  reader: StreamReader,
  timeoutMs: number,
  timing: ProviderTimingSpan
): Promise<{ readonly done: boolean; readonly value?: Uint8Array }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<{ readonly done: boolean; readonly value?: Uint8Array }>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Provider SSE chunk timed out");
          timing.mark("stream-chunk-timeout", { timeoutMs });
          void reader.cancel(error);
          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function waitBeforeRetry(
  settings: ProviderTransportSettings,
  attempt: number,
  timing: ProviderTimingSpan,
  abortSignal: AbortSignal | undefined,
  status: number | undefined,
  message: string
): Promise<void> {
  const delayMs = Math.min(
    settings.retryInitialDelayMs * (2 ** (attempt - 1)),
    settings.retryMaxDelayMs,
    settings.maxRetryDelayMs
  );
  timing.mark("request-retry", {
    attempt,
    nextAttempt: attempt + 1,
    delayMs,
    ...(status === undefined ? {} : { status }),
    message
  });

  await abortableDelay(delayMs, abortSignal);
}

async function abortableDelay(delayMs: number, abortSignal: AbortSignal | undefined): Promise<void> {
  if (abortSignal?.aborted ?? false) {
    throw new DOMException("Aborted", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      abortSignal?.removeEventListener("abort", onAbort);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted ?? false) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && error.name === "TimeoutError");
}

function elapsedSince(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
